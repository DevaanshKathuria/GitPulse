import { getRedis, hashText, SearchEngine } from "@gitpulse/retrieval";
import { goldenDataset } from "./golden-dataset.js";

export interface EvalReport {
  strategy: string;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  ndcg10: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  queries: Array<{
    query: string;
    hit: boolean;
    rank: number | null;
    latencyMs: number;
    resultCount: number;
  }>;
}

type Strategy = "vector" | "bm25" | "hybrid";
const searchTimeoutMs = 30_000;

const isExpectedFile = (filePath: string, expectedFiles: string[]): boolean => {
  const normalized = filePath.toLowerCase();
  return expectedFiles.some((expected) => normalized === expected.toLowerCase());
};

const findRank = (
  results: Array<{ filePath: string }>,
  expectedFiles: string[],
  limit: number
): number | null => {
  const index = results
    .slice(0, limit)
    .findIndex((result) => isExpectedFile(result.filePath, expectedFiles));

  return index === -1 ? null : index + 1;
};

const discountedGain = (rank: number): number => {
  return 1 / Math.log2(rank + 1);
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
};

export class RetrievalEvaluator {
  private readonly searchEngine: SearchEngine;

  public constructor(searchEngine = new SearchEngine()) {
    this.searchEngine = searchEngine;
  }

  public async evaluate(repoId: string, strategy: Strategy): Promise<EvalReport> {
    const queryResults: EvalReport["queries"] = [];
    const ndcgScores: number[] = [];

    for (const item of goldenDataset) {
      if (strategy !== "bm25") {
        await this.clearQueryEmbedding(item.query);
      }
      const startedAt = Date.now();
      const results = await this.searchWithTimeout(repoId, strategy, item.query);
      const latencyMs = Date.now() - startedAt;
      const rank = findRank(results, item.expectedFiles, 10);

      queryResults.push({
        query: item.query,
        hit: rank !== null,
        rank,
        latencyMs,
        resultCount: results.length
      });
      ndcgScores.push(rank === null ? 0 : discountedGain(rank));
    }

    if (queryResults.every((result) => result.resultCount === 0)) {
      throw new Error(
        `${strategy} returned no results for any query; verify that the repository is indexed and the strategy's backing service is configured`
      );
    }

    const total = goldenDataset.length;
    const recallAt = (limit: number): number =>
      queryResults.filter((result) => {
        return result.rank !== null && result.rank <= limit;
      }).length / total;
    const reciprocalRanks = queryResults.map((result) =>
      result.rank === null ? 0 : 1 / result.rank
    );
    const latencies = queryResults.map((result) => result.latencyMs);

    return {
      strategy,
      recallAt5: recallAt(5),
      recallAt10: recallAt(10),
      mrr:
        reciprocalRanks.reduce((sum, value) => sum + value, 0) /
        reciprocalRanks.length,
      ndcg10: ndcgScores.reduce((sum, value) => sum + value, 0) / ndcgScores.length,
      avgLatencyMs:
        latencies.reduce((sum, value) => sum + value, 0) /
        Math.max(latencies.length, 1),
      p95LatencyMs: percentile(latencies, 95),
      queries: queryResults
    };
  }

  private async clearQueryEmbedding(query: string): Promise<void> {
    try {
      await getRedis().del(`gitpulse:emb:${hashText(query)}`);
    } catch {
      // Redis is optional.
    }
  }

  private async searchWithTimeout(
    repoId: string,
    strategy: Strategy,
    query: string
  ): Promise<Array<{ filePath: string }>> {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        this.searchEngine.search({
          query,
          repoId,
          strategy,
          topK: 10
        }),
        new Promise<Array<{ filePath: string }>>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`${strategy} search timed out after ${searchTimeoutMs}ms`));
          }, searchTimeoutMs);
        })
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}
