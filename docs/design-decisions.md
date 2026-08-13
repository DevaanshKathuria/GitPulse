# Design Decisions

## Why BullMQ Over Alternatives

BullMQ fits GitPulse because the workload is Redis-backed, retry-heavy, and naturally split into independent jobs. It gives delayed retries, concurrency controls, progress updates, and operational visibility without introducing a larger workflow platform.

## Why Qdrant For Vector Search

Qdrant provides a straightforward HTTP API, strong metadata filtering, and a simple local Docker story. Those traits matter for repository-scoped code search where filters like repo, language, and file path are used on almost every query.

## Why Hybrid Search Over Vector-Only

Vector search is good for intent, but code search often depends on exact identifiers, file names, and framework terms. Hybrid search combines semantic recall with BM25 precision, which makes it more reliable for both natural-language questions and symbol-oriented queries.

## AST-Aware Chunking Tradeoffs

AST-aware chunks preserve function and class boundaries, which improves result readability and makes line metadata useful. The tradeoff is parser complexity and partial language coverage, so GitPulse keeps a sliding-window fallback for unsupported or malformed files.

## Why ts-morph And Tree-sitter For Parsing

`ts-morph` exposes the TypeScript compiler model through a practical API, which gives TypeScript and JavaScript parsing accurate functions, classes, imports, exports, call relationships, and Express route discovery. Lightweight Tree-sitter parsers cover Python and Go declarations and imports. Files in other languages still flow through sliding-window chunking rather than being excluded from search.
