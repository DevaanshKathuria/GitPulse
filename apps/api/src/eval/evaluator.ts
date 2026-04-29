import { SearchEngine } from "@gitpulse/retrieval";
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
  }>;
}

type Strategy = "vector" | "bm25" | "hybrid";
const searchTimeoutMs = 1000;

const isExpectedFile = (filePath: string, expectedFiles: string[]): boolean => {
  const normalized = filePath.toLowerCase();
  return expectedFiles.some((expected) =>
    normalized.includes(expected.toLowerCase())
  );
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
      const startedAt = Date.now();
      const results = await this.searchSafely(repoId, strategy, item.query);
      const latencyMs = Date.now() - startedAt;
      const rank = findRank(results, item.expectedFiles, 10);

      queryResults.push({
        query: item.query,
        hit: rank !== null,
        rank,
        latencyMs
      });
      ndcgScores.push(rank === null ? 0 : discountedGain(rank));
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

  private async searchSafely(
    repoId: string,
    strategy: Strategy,
    query: string
  ): Promise<Array<{ filePath: string }>> {
    try {
      return await Promise.race([
        this.searchEngine.search({
          query,
          repoId,
          strategy,
          topK: 10
        }),
        new Promise<Array<{ filePath: string }>>((resolve) => {
          setTimeout(() => resolve([]), searchTimeoutMs);
        })
      ]);
    } catch {
      return [];
    }
  }
}
