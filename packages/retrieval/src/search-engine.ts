import { Embedder } from "./embedder.js";
import { KeywordStore } from "./keyword-store.js";
import { VectorStore } from "./vector-store.js";
import type { SearchResult, StoreFilters } from "./types.js";

const vectorCandidateCount = 20;
const bm25CandidateCount = 20;
const rrfK = 60;
const rerankCandidateCount = 20;
const defaultHybridTopK = 10;
const huggingFaceUrl =
  "https://api-inference.huggingface.co/models/cross-encoder/ms-marco-MiniLM-L-6-v2";

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
    const topK = params.topK ?? defaultHybridTopK;

    if (params.strategy === "vector") {
      return this.searchVector(params.query, params.repoId, params.filters, topK);
    }

    if (params.strategy === "bm25") {
      return this.searchKeyword(params.query, params.repoId, params.filters, topK);
    }

    return this.searchHybrid(params.query, params.repoId, params.filters, topK);
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
