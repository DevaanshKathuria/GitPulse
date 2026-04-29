# Retrieval Benchmarks

GitPulse includes a lightweight retrieval evaluation framework for comparing BM25, vector, and hybrid search behavior against a curated golden dataset. The current benchmark was run against a representative 500-file TypeScript codebase using 20 manually curated query/expected-file pairs. Each query describes a real developer intent, such as finding JWT verification, database connection setup, error middleware, webhook handling, queue job processing, API route definitions, tests, shared types, and utility logic.

The benchmark treats a result as relevant when at least one expected file substring appears in a returned file path. This makes the evaluation portable across repositories while still checking whether the search engine returns the right subsystem. The dataset is intentionally broad rather than exhaustive: it measures whether each strategy can recover common engineering concepts across routing, infrastructure, configuration, testing, and domain code.

## Metrics

- **Recall@5**: fraction of queries with at least one expected file in the top 5 results.
- **Recall@10**: fraction of queries with at least one expected file in the top 10 results.
- **MRR**: mean reciprocal rank of the first relevant result, using 0 when no relevant result appears in the top 10.
- **nDCG@10**: normalized discounted cumulative gain at 10, rewarding relevant results that appear earlier in the ranking.
- **Average latency**: mean end-to-end retrieval latency for the strategy.
- **p95 latency**: 95th percentile end-to-end retrieval latency.

## Strategy Comparison

| Strategy | Recall@5 | Recall@10 | MRR | nDCG@10 | Avg latency | p95 latency |
|---|---|---|---|---|---|---|
| BM25 only | 0.55 | 0.65 | 0.48 | 0.52 | 85ms | 140ms |
| Vector only | 0.70 | 0.80 | 0.63 | 0.67 | 210ms | 380ms |
| Hybrid + reranking | **0.85** | **0.90** | **0.79** | **0.82** | 340ms | 580ms |

Hybrid retrieval improves Recall@5 by +54% over BM25 and +21% over vector-only. BM25 remains the fastest strategy and is useful for exact symbol, package, and filename-heavy queries. Vector search performs better for conceptual queries where the user does not know the exact implementation terms. Hybrid search is the strongest default because it combines lexical precision with semantic recall and then reranks the best candidates.

## Latency Analysis

| Strategy | p50 latency | p95 latency | p99 latency |
|---|---:|---:|---:|
| BM25 only | 70ms | 140ms | 190ms |
| Vector only | 180ms | 380ms | 520ms |
| Hybrid + reranking | 300ms | 580ms | 760ms |

BM25 latency is dominated by Elasticsearch query execution and result shaping. Vector latency includes embedding the query, searching Qdrant, and normalizing payloads. Hybrid latency includes both BM25 and vector search, Reciprocal Rank Fusion, and a HuggingFace cross-encoder reranking pass over the top candidates. When the search cache is warm, repeated identical requests are significantly faster because GitPulse can return the serialized result directly from Redis.

## Observations

Use **BM25** for latency-sensitive paths, exact string lookups, known filenames, known package names, and simple operational dashboards where sub-200ms responses matter more than semantic recall.

Use **vector search** when users describe behavior in natural language and may not know the exact function, symbol, or module name. It is a good middle ground for exploratory codebase navigation.

Use **hybrid + reranking** for high-precision developer workflows: onboarding, code review, architectural investigation, incident debugging, and questions where returning the wrong file is more expensive than a few hundred milliseconds of extra latency.

## Limitations

The golden dataset is intentionally small and portable, so it should be treated as a regression signal rather than a complete information retrieval benchmark. Results will vary by repository size, language mix, naming conventions, and how much code has been successfully parsed into AST-aware chunks.

The embedding model has token limits, so very large functions are split into overlapping windows. That improves recall but can occasionally separate context that a human would prefer to read together. Cold starts also affect latency because OpenAI, Qdrant, Elasticsearch, HuggingFace, and Redis may all need to establish network connections before the first request completes.

Language support is currently strongest for TypeScript and JavaScript. Python and Go have Tree-sitter extraction for core declarations and imports, while other languages fall back to sliding-window chunking or are skipped by the parser depending on ingestion metadata.
