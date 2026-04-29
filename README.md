# GitPulse

> Semantic Code Intelligence & Repository Analytics Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript)](https://typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-9-F69220?style=flat-square&logo=pnpm)](https://pnpm.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![CI](https://github.com/DevaanshKathuria/GitPulse/actions/workflows/ci.yml/badge.svg)](https://github.com/DevaanshKathuria/GitPulse/actions/workflows/ci.yml)

GitPulse ingests any GitHub repository and gives you semantic code search, AST-powered architecture analysis, PR risk scoring, contributor ownership maps, and engineering analytics -- all built on a distributed async pipeline.

---

## What it does

Most developer tools let you *browse* code. GitPulse lets you *understand* it.

Point it at any GitHub repo and it:

- **Finds code by meaning, not keywords.** Ask "where is JWT auth implemented?" and get the exact functions -- not a grep output.
- **Maps your architecture automatically.** Generates a dependency graph of every file, detects circular dependencies, and flags over-coupled modules.
- **Scores every PR for risk.** Analyses diffs to detect breaking changes, changed dependencies, and architectural impact before a PR is merged.
- **Quantifies contributor ownership.** Shows who owns which subsystems, calculates bus factor per directory, and surfaces knowledge concentration risks.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         GitPulse Platform                       │
│                                                                 │
│  ┌──────────┐    ┌──────────────────────────────────────────┐  │
│  │ Next.js  │───▶│              Express API                  │  │
│  │  Web UI  │    │  /repos  /search  /architecture  /prs     │  │
│  └──────────┘    └────────────────┬─────────────────────────┘  │
│                                   │                             │
│              ┌────────────────────▼───────────────────────┐    │
│              │             BullMQ Queue Layer              │    │
│              │  repo-ingestion │ file-parsing │ embedding  │    │
│              │  pr-analysis    │ contributor-analysis      │    │
│              └──┬──────────────┬──────────────┬───────────┘    │
│                 │              │              │                 │
│         ┌───────▼──┐  ┌───────▼──┐  ┌───────▼──┐            │
│         │ Ingestion │  │   AST    │  │Embedding │            │
│         │  Worker  │  │  Parser  │  │  Worker  │            │
│         │(Octokit) │  │(ts-morph │  │(OpenAI + │            │
│         │          │  │tree-sitter│  │ Qdrant)  │            │
│         └───────┬──┘  └───────┬──┘  └───────┬──┘            │
│                 │              │              │                 │
│         ┌───────▼──────────────▼──────────────▼────────────┐  │
│         │              Data Layer                            │  │
│         │  PostgreSQL │ Redis │ Qdrant │ Elasticsearch       │  │
│         └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.7 (strict mode throughout) |
| API | Express.js + Zod validation |
| Queue | BullMQ + Redis |
| Vector DB | Qdrant |
| Keyword search | Elasticsearch 8 (BM25) |
| Database | PostgreSQL 16 + Prisma ORM |
| AST parsing | ts-morph (TypeScript), Tree-sitter (Python, Go) |
| Embeddings | OpenAI text-embedding-3-small |
| Reranking | HuggingFace cross-encoder/ms-marco-MiniLM-L-6-v2 |
| LLM | OpenAI GPT-4o (PR summaries) |
| Cache | Redis (ioredis) with stale-while-revalidate |
| Metrics | Prometheus + prom-client |
| Logging | pino (structured JSON) |
| Frontend | Next.js 14 (App Router) + Tailwind + shadcn/ui |
| Infra | Docker + Docker Compose + Turborepo |
| CI/CD | GitHub Actions |

---

## Core features

### Hybrid semantic code search

Three retrieval strategies available per query:

- **Vector search** -- embeds query with text-embedding-3-small, searches Qdrant by cosine similarity
- **BM25** -- Elasticsearch keyword search over all indexed code
- **Hybrid + reranking** -- Reciprocal Rank Fusion (RRF) merges both result sets, then a cross-encoder reranks the top 20 candidates

Chunking is AST-aware: functions and classes become their own chunks, preserving semantic boundaries instead of slicing at arbitrary character limits.

Example query:
```
POST /api/v1/search
{
  "query": "where is rate limiting implemented?",
  "repoId": "clx...",
  "strategy": "hybrid",
  "filters": { "language": "typescript" }
}
```

### AST parsing engine

Every TypeScript, JavaScript, Python, and Go file is parsed after ingestion. Extracted per file:

- All function/class/interface declarations with line ranges
- Import and export statements (internal vs external)
- Express/Next.js API route declarations
- Cross-file call graph edges

Used to power: AST-aware chunking, dependency graph generation, circular dependency detection, dead code detection.

### Architecture intelligence

```
GET /api/v1/repos/:id/architecture
```

Returns a full dependency graph as nodes + edges (react-flow compatible), plus:

- Circular dependency list (DFS cycle detection)
- Over-coupled modules (files with >15 dependents)
- Dead code candidates (exported but never imported internally)
- Module coupling scores

### PR intelligence

```
GET /api/v1/repos/:id/prs/:prId/intelligence
```

For every PR:

- GPT-4o generated summary (3-5 sentences, technically focused)
- Risk score (0-100) based on: files touched, critical paths, dependency changes, test coverage signals, diff size
- Breaking change detection (removed/renamed exported symbols)
- Changed dependency map (added/removed imports)

### Contributor analytics

```
GET /api/v1/repos/:id/bus-factor
```

- File ownership map (contributor with >50% of commits to a file owns it)
- Bus factor per directory
- Knowledge concentration risk: critical (1 owner), high (2 owners), medium (<=3 owners)
- 12-week activity trend per contributor

### Async ingestion pipeline

Repositories are ingested through a 4-stage queue pipeline:

```
repo-ingestion → file-parsing → embedding-generation
                              ↘ pr-analysis
                              ↘ contributor-analysis
```

All jobs are: idempotent (safe to re-run), retry-safe (3 attempts, exponential backoff), and failure-isolated (one file failing does not block the rest of the repo).

---

## Evaluation results

Retrieval evaluation run against a 500-file TypeScript codebase with 20 manually curated query/expected-file pairs:

| Strategy | Recall@5 | Recall@10 | MRR | nDCG@10 | Avg latency | p95 latency |
|---|---|---|---|---|---|---|
| BM25 only | 0.55 | 0.65 | 0.48 | 0.52 | 85ms | 140ms |
| Vector only | 0.70 | 0.80 | 0.63 | 0.67 | 210ms | 380ms |
| Hybrid + reranking | **0.85** | **0.90** | **0.79** | **0.82** | 340ms | 580ms |

Hybrid retrieval improves Recall@5 by +54% over BM25 and +21% over vector-only. Full benchmark methodology in [`docs/benchmarks.md`](docs/benchmarks.md).

---

## Project structure

```
gitpulse/
├── apps/
│   ├── api/                  # Express REST API + workers
│   │   └── src/
│   │       ├── routes/       # Repo, search, PR, contributor endpoints
│   │       ├── services/     # PR intelligence, contributor analytics
│   │       ├── workers/      # BullMQ worker entry points
│   │       ├── lib/          # Cache, metrics, logger
│   │       └── eval/         # Retrieval evaluation framework
│   └── web/                  # Next.js 14 frontend
│       └── src/app/
│           ├── repos/        # Repo list + add repo
│           ├── repos/[id]/
│           │   ├── search/   # Semantic search UI
│           │   ├── architecture/ # Dependency graph (react-flow)
│           │   ├── prs/      # PR intelligence table
│           │   └── contributors/ # Bus factor + analytics
├── packages/
│   ├── db/                   # Prisma schema + singleton client
│   ├── queue/                # BullMQ queue definitions + WorkerBase
│   ├── parser/               # AST parsing engine + dependency graph
│   ├── retrieval/            # Chunker + embedder + hybrid search engine
│   └── shared/               # Shared TypeScript types + constants
├── docs/
│   ├── architecture.md       # System design + data flow
│   ├── ingestion-flow.md     # Ingestion sequence diagram
│   ├── retrieval-pipeline.md # Chunking, fusion, reranking
│   ├── benchmarks.md         # Evaluation results
│   └── design-decisions.md   # Engineering tradeoffs
├── docker-compose.yml        # All 6 services: postgres, redis, qdrant, es, api, web
└── .github/workflows/ci.yml  # Typecheck, lint, test, docker build
```

---

## Getting started

### Prerequisites

- Docker + Docker Compose
- Node.js 20+
- pnpm 9+
- GitHub personal access token (classic, `repo` scope)
- OpenAI API key

### 1. Clone and install

```bash
git clone https://github.com/DevaanshKathuria/GitPulse.git
cd GitPulse
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in: GITHUB_TOKEN, OPENAI_API_KEY, HUGGINGFACE_API_KEY
```

### 3. Start infrastructure

```bash
docker-compose up -d postgres redis qdrant elasticsearch
```

### 4. Run database migrations

```bash
pnpm --filter @gitpulse/db exec prisma migrate dev
```

### 5. Start API and workers

```bash
pnpm dev
```

### 6. Open the UI

Visit [http://localhost:3000](http://localhost:3000), click "Add Repository", and paste any public GitHub URL.

---

## API reference

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/repos` | Add a repository for indexing |
| GET | `/api/v1/repos` | List all repositories |
| GET | `/api/v1/repos/:id` | Repository details + stats |
| POST | `/api/v1/repos/:id/sync` | Trigger incremental sync |
| POST | `/api/v1/search` | Semantic code search |
| GET | `/api/v1/repos/:id/architecture` | Dependency graph + metrics |
| GET | `/api/v1/repos/:id/prs` | PR list with risk scores |
| GET | `/api/v1/repos/:id/prs/:prId/intelligence` | Full PR analysis |
| GET | `/api/v1/repos/:id/contributors` | Contributor analytics |
| GET | `/api/v1/repos/:id/bus-factor` | Bus factor by directory |
| GET | `/metrics` | Prometheus metrics endpoint |
| POST | `/webhooks/github` | GitHub webhook receiver |

---

## Running the evaluation

```bash
# Index a repo first, then run against its repoId
pnpm eval -- --repoId <your-repo-id>
```

Outputs a strategy comparison table and writes results to `docs/benchmarks.md`.

---

## Observability

Prometheus metrics available at `/metrics`:

- `gitpulse_ingestion_jobs_total` -- ingestion job count by status
- `gitpulse_ingestion_duration_seconds` -- ingestion duration histogram
- `gitpulse_search_latency_seconds` -- search latency by strategy
- `gitpulse_cache_hits_total` / `gitpulse_cache_misses_total`
- `gitpulse_queue_depth` -- live queue depth per queue
- `gitpulse_worker_job_duration_seconds` -- worker job duration by queue

---

## Documentation

- [Architecture](docs/architecture.md) -- system design, component responsibilities, data flow
- [Ingestion flow](docs/ingestion-flow.md) -- sequence diagram from repo add to indexed
- [Retrieval pipeline](docs/retrieval-pipeline.md) -- chunking, RRF fusion, reranking explained
- [Benchmarks](docs/benchmarks.md) -- evaluation methodology and results
- [Design decisions](docs/design-decisions.md) -- engineering tradeoffs and rationale

---

## License

MIT

---
