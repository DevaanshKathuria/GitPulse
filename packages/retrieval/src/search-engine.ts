import { Embedder } from "./embedder.js";
import { KeywordStore } from "./keyword-store.js";
import { VectorStore } from "./vector-store.js";
import { hashText } from "./hash.js";
import type { SearchResult, StoreFilters } from "./types.js";
import pino from "pino";
import { Counter, Histogram, register } from "prom-client";

const vectorCandidateCount = 20;
const bm25CandidateCount = 20;
const rrfK = 60;
const rerankCandidateCount = 20;
const defaultHybridTopK = 10;
const huggingFaceUrl =
  "https://api-inference.huggingface.co/models/cross-encoder/ms-marco-MiniLM-L-6-v2";
const logger = pino({ name: "gitpulse-retrieval" });
const searchLatencySeconds =
  (register.getSingleMetric("gitpulse_search_latency_seconds") as
    | Histogram<string>
    | undefined) ??
  new Histogram({
    name: "gitpulse_search_latency_seconds",
    help: "Search latency",
    labelNames: ["strategy"],
    buckets: [0.1, 0.25, 0.5, 1, 2, 5]
  });
const searchRequestsTotal =
  (register.getSingleMetric("gitpulse_search_requests_total") as
    | Counter<string>
    | undefined) ??
  new Counter({
    name: "gitpulse_search_requests_total",
    help: "Total search requests",
    labelNames: ["strategy"]
  });

interface RerankScore {
  index: number;
  score: number;
}

const vectorToSearchResult = (
  result: Awaited<ReturnType<VectorStore["search"]>>[number]
): SearchResult => ({
  chunkId: result.id,
  fileId: result.payload.fileId,
  filePath: result.payload.filePath,
  language: result.payload.language,
  functionName: result.payload.functionName,
  content: result.payload.chunkContent,
  score: result.score,
  startLine: result.payload.startLine,
  endLine: result.payload.endLine,
  strategy: "vector"
});

const keywordToSearchResult = (
  result: Awaited<ReturnType<KeywordStore["search"]>>[number]
): SearchResult => ({
  chunkId: result.id,
  fileId: result.chunk.fileId,
  filePath: result.chunk.metadata.filePath,
  language: result.chunk.metadata.language,
  functionName: result.chunk.metadata.functionName,
  content: result.chunk.content,
  score: result.score,
  startLine: result.chunk.metadata.startLine,
  endLine: result.chunk.metadata.endLine,
  strategy: "bm25"
});

const parseRerankScores = (payload: unknown): RerankScore[] | null => {
  if (!Array.isArray(payload)) {
    return null;
  }

  return payload
    .map((item, index): RerankScore | null => {
      if (typeof item === "number") {
        return { index, score: item };
      }

      if (
        typeof item === "object" &&
        item !== null &&
        "score" in item &&
        typeof (item as { score: unknown }).score === "number"
      ) {
        return { index, score: (item as { score: number }).score };
      }

      return null;
    })
    .filter((item): item is RerankScore => item !== null);
};

export class SearchEngine {
  private readonly embedder: Embedder;
  private readonly vectorStore: VectorStore;
  private readonly keywordStore: KeywordStore;

  public constructor(
    embedder = new Embedder(),
    vectorStore = new VectorStore(),
    keywordStore = new KeywordStore()
  ) {
    this.embedder = embedder;
    this.vectorStore = vectorStore;
    this.keywordStore = keywordStore;
  }

  public async search(params: {
    query: string;
    repoId: string;
    strategy: "vector" | "bm25" | "hybrid";
    filters?: { language?: string; filePattern?: string };
    topK?: number;
  }): Promise<SearchResult[]> {
    const startedAt = Date.now();
    const topK = params.topK ?? defaultHybridTopK;
    let results: SearchResult[];

    if (params.strategy === "vector") {
      results = await this.searchVector(params.query, params.repoId, params.filters, topK);
    } else if (params.strategy === "bm25") {
      results = await this.searchKeyword(params.query, params.repoId, params.filters, topK);
    } else {
      results = await this.searchHybrid(params.query, params.repoId, params.filters, topK);
    }

    const latencyMs = Date.now() - startedAt;
    try {
      searchRequestsTotal.inc({ strategy: params.strategy });
      searchLatencySeconds.observe({ strategy: params.strategy }, latencyMs / 1000);
    } catch {
      // Metrics must never break search.
    }
    logger.info(
      {
        query: hashText(params.query),
        strategy: params.strategy,
        latencyMs,
        resultCount: results.length
      },
      "search query completed"
    );
    return results;
  }

  private async searchVector(
    query: string,
    repoId: string,
    filters: { language?: string; filePattern?: string } | undefined,
    topK: number
  ): Promise<SearchResult[]> {
    const queryVector = await this.embedder.embedText(query);
    if (queryVector === null) {
      return [];
    }

    const storeFilters: StoreFilters = { ...filters, repoId };
    const results = await this.vectorStore.search(queryVector, storeFilters, topK);
    return results.map(vectorToSearchResult);
  }

  private async searchKeyword(
    query: string,
    repoId: string,
    filters: { language?: string } | undefined,
    topK: number
  ): Promise<SearchResult[]> {
    const results = await this.keywordStore.search(
      query,
      { repoId, language: filters?.language },
      topK
    );
    return results.map(keywordToSearchResult);
  }

  private async searchHybrid(
    query: string,
    repoId: string,
    filters: { language?: string; filePattern?: string } | undefined,
    topK: number
  ): Promise<SearchResult[]> {
    const [vectorResults, keywordResults] = await Promise.all([
      this.searchVector(query, repoId, filters, vectorCandidateCount),
      this.searchKeyword(query, repoId, filters, bm25CandidateCount)
    ]);
    const fused = this.fuseResults(vectorResults, keywordResults).slice(
      0,
      rerankCandidateCount
    );
    const reranked = await this.rerank(query, fused);

    return reranked.slice(0, topK).map((result) => ({
      ...result,
      strategy: "hybrid"
    }));
  }

  private fuseResults(
    vectorResults: SearchResult[],
    keywordResults: SearchResult[]
  ): SearchResult[] {
    const byChunk = new Map<string, SearchResult>();
    const scores = new Map<string, number>();

    const addScores = (results: SearchResult[]): void => {
      for (const [index, result] of results.entries()) {
        const rank = index + 1;
        byChunk.set(result.chunkId, result);
        scores.set(
          result.chunkId,
          (scores.get(result.chunkId) ?? 0) + 1 / (rrfK + rank)
        );
      }
    };

    addScores(vectorResults);
    addScores(keywordResults);

    return [...byChunk.values()]
      .map((result) => ({
        ...result,
        score: scores.get(result.chunkId) ?? 0
      }))
      .sort((left, right) => right.score - left.score);
  }

  private async rerank(
    query: string,
    results: SearchResult[]
  ): Promise<SearchResult[]> {
    if (results.length === 0) {
      return [];
    }

    try {
      const response = await fetch(huggingFaceUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.HUGGINGFACE_API_KEY !== undefined
            ? { authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` }
            : {})
        },
        body: JSON.stringify({
          inputs: {
            query,
            passages: results.map((result) => result.content)
          }
        })
      });

      if (!response.ok) {
        return results;
      }

      const scores = parseRerankScores(await response.json());
      if (scores === null || scores.length === 0) {
        return results;
      }

      return scores
        .map((score) => {
          const result = results[score.index];
          return result === undefined ? null : { ...result, score: score.score };
        })
        .filter((result): result is SearchResult => result !== null)
        .sort((left, right) => right.score - left.score);
    } catch {
      return results;
    }
  }
}
