# Retrieval Benchmark

Measured on 2026-08-13T10:58:29.391Z against [DevaanshKathuria/GitPulse](https://github.com/DevaanshKathuria/GitPulse) at its then-current default branch.

Dataset: **GitPulse self-retrieval benchmark** (20 manually labeled developer-intent queries).

A result is relevant when its repository-relative path exactly matches a manually labeled expected file.

Indexed corpus: **122 files**. Repository ID: `cmsq013p40000np01kjxh5aqv`.

## Results

| Strategy | Recall@5 | Recall@10 | MRR | nDCG@10 | Mean latency | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| BM25 | 35.0% | 55.0% | 0.197 | 0.279 | 21ms | 19ms |
| Vector | 95.0% | 95.0% | 0.749 | 0.798 | 631ms | 1034ms |
| Hybrid (RRF) | 75.0% | 90.0% | 0.477 | 0.576 | 642ms | 1143ms |

Pure vector search produced the strongest retrieval quality on this corpus. BM25's weaker rankings reduced hybrid quality during Reciprocal Rank Fusion, indicating that lexical matches added noise for several developer-intent queries in this dataset.

Latencies are end-to-end calls made sequentially from the evaluator to the local retrieval services. Before each vector or hybrid query, the evaluator removes that query's cached embedding so the semantic strategies both include embedding generation. Warm-cache latency was not measured. BM25's mean is higher than its p95 because one 159ms request raised the mean while the other 19 requests completed in 19ms or less. These environment-specific measurements are not production load-test claims. Cross-encoder reranking is applied only when `HUGGINGFACE_API_KEY` is configured.

## Reproduce

```bash
docker compose up -d --build
pnpm eval -- --repoId cmsq013p40000np01kjxh5aqv
```

The evaluator refuses to run this dataset against a different repository, fails if a strategy returns no results for every query, and uses exact repository-relative paths for relevance judgments.

## Per-query results

### BM25

| Query | First relevant rank | Results | Latency |
|---|---:|---:|---:|
| download a GitHub repository as a tar archive | miss | 10 | 159ms |
| ingest repository metadata commits pull requests and source files | 9 | 10 | 19ms |
| verify a GitHub webhook signature | 1 | 10 | 12ms |
| detect the programming language from a file extension | 3 | 10 | 15ms |
| parse TypeScript functions classes imports and exports with ts-morph | 4 | 10 | 17ms |
| build a file dependency graph and find circular imports | miss | 10 | 15ms |
| split source code into AST-aware search chunks | miss | 10 | 16ms |
| generate and cache OpenAI embeddings in batches | 1 | 10 | 12ms |
| index code chunks for keyword and vector retrieval | miss | 10 | 16ms |
| store and query source code in Elasticsearch with BM25 | miss | 10 | 12ms |
| store embeddings and search vectors in Qdrant | miss | 10 | 10ms |
| combine lexical and semantic results using reciprocal rank fusion | 10 | 10 | 15ms |
| cache API responses with stale while revalidate | 3 | 10 | 13ms |
| record Prometheus metrics for queues search and cache | 7 | 10 | 10ms |
| validate and execute the semantic code search API endpoint | miss | 10 | 10ms |
| repository API endpoints for architecture pull requests and contributors | 7 | 10 | 19ms |
| score pull request risk and detect breaking exported symbols | 3 | 10 | 16ms |
| calculate contributor ownership bus factor and concentration risk | 5 | 10 | 17ms |
| configure BullMQ workers with retries and exponential backoff | miss | 10 | 14ms |
| render ranked code search results in the repository UI | miss | 10 | 12ms |

### Vector

| Query | First relevant rank | Results | Latency |
|---|---:|---:|---:|
| download a GitHub repository as a tar archive | 1 | 10 | 972ms |
| ingest repository metadata commits pull requests and source files | 2 | 10 | 1326ms |
| verify a GitHub webhook signature | 1 | 10 | 557ms |
| detect the programming language from a file extension | 1 | 10 | 504ms |
| parse TypeScript functions classes imports and exports with ts-morph | 1 | 10 | 806ms |
| build a file dependency graph and find circular imports | 1 | 10 | 519ms |
| split source code into AST-aware search chunks | 1 | 10 | 633ms |
| generate and cache OpenAI embeddings in batches | 1 | 10 | 475ms |
| index code chunks for keyword and vector retrieval | miss | 10 | 740ms |
| store and query source code in Elasticsearch with BM25 | 1 | 10 | 462ms |
| store embeddings and search vectors in Qdrant | 1 | 10 | 497ms |
| combine lexical and semantic results using reciprocal rank fusion | 1 | 10 | 1034ms |
| cache API responses with stale while revalidate | 2 | 10 | 611ms |
| record Prometheus metrics for queues search and cache | 1 | 10 | 444ms |
| validate and execute the semantic code search API endpoint | 5 | 10 | 420ms |
| repository API endpoints for architecture pull requests and contributors | 3 | 10 | 446ms |
| score pull request risk and detect breaking exported symbols | 1 | 10 | 621ms |
| calculate contributor ownership bus factor and concentration risk | 1 | 10 | 596ms |
| configure BullMQ workers with retries and exponential backoff | 5 | 10 | 512ms |
| render ranked code search results in the repository UI | 4 | 10 | 436ms |

### Hybrid (RRF)

| Query | First relevant rank | Results | Latency |
|---|---:|---:|---:|
| download a GitHub repository as a tar archive | 10 | 10 | 1143ms |
| ingest repository metadata commits pull requests and source files | 4 | 10 | 453ms |
| verify a GitHub webhook signature | 1 | 10 | 449ms |
| detect the programming language from a file extension | 1 | 10 | 688ms |
| parse TypeScript functions classes imports and exports with ts-morph | 1 | 10 | 480ms |
| build a file dependency graph and find circular imports | 5 | 10 | 544ms |
| split source code into AST-aware search chunks | 6 | 10 | 446ms |
| generate and cache OpenAI embeddings in batches | 1 | 10 | 1105ms |
| index code chunks for keyword and vector retrieval | miss | 10 | 1001ms |
| store and query source code in Elasticsearch with BM25 | 5 | 10 | 455ms |
| store embeddings and search vectors in Qdrant | 5 | 10 | 453ms |
| combine lexical and semantic results using reciprocal rank fusion | 4 | 10 | 449ms |
| cache API responses with stale while revalidate | 1 | 10 | 486ms |
| record Prometheus metrics for queues search and cache | 2 | 10 | 575ms |
| validate and execute the semantic code search API endpoint | miss | 10 | 454ms |
| repository API endpoints for architecture pull requests and contributors | 3 | 10 | 450ms |
| score pull request risk and detect breaking exported symbols | 1 | 10 | 450ms |
| calculate contributor ownership bus factor and concentration risk | 1 | 10 | 1038ms |
| configure BullMQ workers with retries and exponential backoff | 5 | 10 | 1262ms |
| render ranked code search results in the repository UI | 7 | 10 | 461ms |

## Limitations

This is a small, project-specific regression benchmark, not a general claim about retrieval quality across arbitrary repositories. The labels were selected manually from known GitPulse subsystems. Results can change as the codebase, indexed commit, external embedding model, or local hardware changes.
