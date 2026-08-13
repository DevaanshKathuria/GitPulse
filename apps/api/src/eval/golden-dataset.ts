export interface GoldenQuery {
  query: string;
  expectedFiles: string[];
}

export const goldenDatasetMetadata = {
  name: "GitPulse self-retrieval benchmark",
  repositoryUrl: "https://github.com/DevaanshKathuria/GitPulse",
  relevance:
    "A result is relevant when its repository-relative path exactly matches a manually labeled expected file."
} as const;

export const goldenDataset: GoldenQuery[] = [
  { query: "download a GitHub repository as a tar archive", expectedFiles: ["packages/ingestion/src/github-client.ts"] },
  { query: "ingest repository metadata commits pull requests and source files", expectedFiles: ["packages/ingestion/src/ingestion-service.ts"] },
  { query: "verify a GitHub webhook signature", expectedFiles: ["packages/ingestion/src/webhook-handler.ts"] },
  { query: "detect the programming language from a file extension", expectedFiles: ["packages/parser/src/language-detector.ts"] },
  { query: "parse TypeScript functions classes imports and exports with ts-morph", expectedFiles: ["packages/parser/src/parsers/typescript-parser.ts"] },
  { query: "build a file dependency graph and find circular imports", expectedFiles: ["packages/parser/src/dependency-graph.ts"] },
  { query: "split source code into AST-aware search chunks", expectedFiles: ["packages/retrieval/src/chunker.ts"] },
  { query: "generate and cache OpenAI embeddings in batches", expectedFiles: ["packages/retrieval/src/embedder.ts"] },
  { query: "index code chunks for keyword and vector retrieval", expectedFiles: ["packages/retrieval/src/code-indexer.ts"] },
  { query: "store and query source code in Elasticsearch with BM25", expectedFiles: ["packages/retrieval/src/keyword-store.ts"] },
  { query: "store embeddings and search vectors in Qdrant", expectedFiles: ["packages/retrieval/src/vector-store.ts"] },
  { query: "combine lexical and semantic results using reciprocal rank fusion", expectedFiles: ["packages/retrieval/src/search-engine.ts"] },
  { query: "cache API responses with stale while revalidate", expectedFiles: ["apps/api/src/lib/cache.ts"] },
  { query: "record Prometheus metrics for queues search and cache", expectedFiles: ["apps/api/src/lib/metrics.ts"] },
  { query: "validate and execute the semantic code search API endpoint", expectedFiles: ["apps/api/src/routes/search.ts"] },
  { query: "repository API endpoints for architecture pull requests and contributors", expectedFiles: ["apps/api/src/routes/repos.ts"] },
  { query: "score pull request risk and detect breaking exported symbols", expectedFiles: ["apps/api/src/services/pr-intelligence.ts"] },
  { query: "calculate contributor ownership bus factor and concentration risk", expectedFiles: ["apps/api/src/services/contributor-intelligence.ts"] },
  { query: "configure BullMQ workers with retries and exponential backoff", expectedFiles: ["packages/queue/src/worker-base.ts"] },
  { query: "render ranked code search results in the repository UI", expectedFiles: ["apps/web/src/app/repos/[id]/search/page.tsx"] }
];
