# Contributing to GitPulse

Thanks for helping improve GitPulse. Bug reports, documentation fixes, and focused feature changes are welcome.

## Local setup

Requirements:

- Node.js 20 (run `nvm use` if you use nvm)
- pnpm 9.15.4
- Docker with Compose

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis qdrant elasticsearch
pnpm --filter @gitpulse/db exec prisma db push
pnpm dev
```

API keys are optional for code-only ingestion and BM25 search. Vector search requires `OPENAI_API_KEY`; GitHub analytics requires `GITHUB_TOKEN`; cross-encoder reranking requires `HUGGINGFACE_API_KEY`. Never commit `.env` or credentials.

## Before opening a pull request

Run the same checks as CI:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

For retrieval changes, index GitPulse locally and rerun the labeled evaluation:

```bash
pnpm eval -- --repoId <gitpulse-repository-id>
```

Commit the regenerated `docs/benchmarks.md` only when the corpus, dataset, or retrieval behavior changed. Explain material metric changes in the pull request.

## Change guidelines

- Keep changes scoped and include clear reproduction or validation steps for behavioral changes.
- Preserve idempotency in ingestion and queue workers.
- Do not log repository contents, search text, tokens, or webhook secrets.
- Update `docs/openapi.yaml` when an API contract changes.
- Update the architecture or pipeline docs when component boundaries change.
- Avoid reporting benchmark numbers that were not produced by the checked-in evaluator.

## Reporting bugs

Include the affected service, reproduction steps, expected behavior, logs with secrets removed, and your Node/Docker versions. For security-sensitive reports, contact the maintainer privately instead of opening a public issue.
