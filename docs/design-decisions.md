# Design Decisions

## Why BullMQ Over Alternatives

BullMQ fits GitPulse because the workload is Redis-backed, retry-heavy, and naturally split into independent jobs. It gives delayed retries, concurrency controls, progress updates, and operational visibility without introducing a larger workflow platform.

## Why Qdrant For Vector Search

Qdrant provides a straightforward HTTP API, strong metadata filtering, and a simple local Docker story. Those traits matter for repository-scoped code search where filters like repo, language, and file path are used on almost every query.

## Why Hybrid Search Over Vector-Only

Vector search is good for intent, but code search often depends on exact identifiers, file names, and framework terms. Hybrid search combines semantic recall with BM25 precision, which makes it more reliable for both natural-language questions and symbol-oriented queries.

## AST-Aware Chunking Tradeoffs

AST-aware chunks preserve function and class boundaries, which improves result readability and makes line metadata useful. The tradeoff is parser complexity and partial language coverage, so GitPulse keeps a sliding-window fallback for unsupported or malformed files.

## Why ts-morph For TypeScript Parsing

`ts-morph` wraps the TypeScript compiler API with a friendlier object model. It is a practical choice for extracting functions, classes, imports, exports, and route patterns from TypeScript and JavaScript without hand-writing a fragile parser.
