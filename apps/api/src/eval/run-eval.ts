import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalReport } from "./evaluator.js";
import { goldenDataset, goldenDatasetMetadata } from "./golden-dataset.js";

type Strategy = "vector" | "bm25" | "hybrid";
type PrismaClient = (typeof import("@gitpulse/db"))["prisma"];
type EvaluatorConstructor = (typeof import("./evaluator.js"))["RetrievalEvaluator"];

const allStrategies: Strategy[] = ["bm25", "vector", "hybrid"];
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);
config({ path: path.join(workspaceRoot, ".env") });

const argumentValue = (name: string): string | undefined => {
  const equalsPrefix = `--${name}=`;
  const equalsArgument = process.argv.find((argument) =>
    argument.startsWith(equalsPrefix)
  );
  if (equalsArgument !== undefined) {
    return equalsArgument.slice(equalsPrefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const positionalRepoId = (): string | undefined =>
  process.argv.slice(2).find((argument) => !argument.startsWith("--"));

const parseStrategies = (): Strategy[] => {
  const value = argumentValue("strategies");
  if (value === undefined) {
    return allStrategies;
  }

  const requested = value.split(",").map((item) => item.trim());
  const invalid = requested.filter(
    (item) => !allStrategies.includes(item as Strategy)
  );
  if (invalid.length > 0 || requested.length === 0) {
    throw new Error("--strategies must contain bm25, vector, or hybrid");
  }

  return requested as Strategy[];
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const formatNumber = (value: number): string => value.toFixed(3);
const formatMs = (value: number): string => `${Math.round(value)}ms`;

const strategyName = (strategy: string): string => {
  if (strategy === "bm25") return "BM25";
  if (strategy === "vector") return "Vector";
  return process.env.HUGGINGFACE_API_KEY?.trim()
    ? "Hybrid + reranking"
    : "Hybrid (RRF)";
};

const table = (reports: EvalReport[]): string =>
  [
    "| Strategy | Recall@5 | Recall@10 | MRR | nDCG@10 | Mean latency | p95 latency |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...reports.map(
      (report) =>
        `| ${strategyName(report.strategy)} | ${formatPercent(report.recallAt5)} | ${formatPercent(report.recallAt10)} | ${formatNumber(report.mrr)} | ${formatNumber(report.ndcg10)} | ${formatMs(report.avgLatencyMs)} | ${formatMs(report.p95LatencyMs)} |`
    )
  ].join("\n");

const queryDetails = (reports: EvalReport[]): string =>
  reports
    .flatMap((report) => [
      `### ${strategyName(report.strategy)}`,
      "",
      "| Query | First relevant rank | Results | Latency |",
      "|---|---:|---:|---:|",
      ...report.queries.map(
        (query) =>
          `| ${query.query} | ${query.rank ?? "miss"} | ${query.resultCount} | ${formatMs(query.latencyMs)} |`
      ),
      ""
    ])
    .join("\n");

const executeEvaluation = async (
  prisma: PrismaClient,
  RetrievalEvaluator: EvaluatorConstructor
): Promise<void> => {
  const repoId = argumentValue("repoId") ?? positionalRepoId();
  if (repoId === undefined || repoId.length === 0) {
    throw new Error(
      "Usage: pnpm eval -- --repoId <repo-id> [--strategies bm25,vector,hybrid]"
    );
  }

  const repository = await prisma.repository.findUnique({
    where: { id: repoId },
    include: { _count: { select: { codeFiles: true } } }
  });
  if (repository === null) {
    throw new Error(`Repository ${repoId} was not found`);
  }
  if (repository.githubUrl.toLowerCase() !== goldenDatasetMetadata.repositoryUrl.toLowerCase()) {
    throw new Error(
      `This labeled dataset is for ${goldenDatasetMetadata.repositoryUrl}; received ${repository.githubUrl}`
    );
  }
  if (repository.status !== "ready" || repository._count.codeFiles === 0) {
    throw new Error(
      `Repository must be fully indexed before evaluation (status=${repository.status}, files=${repository._count.codeFiles})`
    );
  }

  const strategies = parseStrategies();
  if (
    strategies.some((strategy) => strategy !== "bm25") &&
    !process.env.OPENAI_API_KEY?.trim()
  ) {
    throw new Error(
      "OPENAI_API_KEY is required to evaluate vector or hybrid retrieval; use --strategies bm25 for a keyless run"
    );
  }

  const evaluator = new RetrievalEvaluator();
  const reports: EvalReport[] = [];
  for (const strategy of strategies) {
    process.stdout.write(`Evaluating ${strategy}...\n`);
    reports.push(await evaluator.evaluate(repoId, strategy));
  }

  const generatedAt = new Date().toISOString();
  const output = table(reports);
  const benchmark = [
    "# Retrieval Benchmark",
    "",
    `Measured on ${generatedAt} against [${repository.owner}/${repository.name}](${repository.githubUrl}) at its then-current default branch.`,
    "",
    `Dataset: **${goldenDatasetMetadata.name}** (${goldenDataset.length} manually labeled developer-intent queries).`,
    "",
    goldenDatasetMetadata.relevance,
    "",
    `Indexed corpus: **${repository._count.codeFiles} files**. Repository ID: \`${repoId}\`.`,
    "",
    "## Results",
    "",
    output,
    "",
    "Latencies are end-to-end calls made sequentially from the evaluator to the local retrieval services. Before each vector or hybrid query, the evaluator removes that query's cached embedding so the semantic strategies both include embedding generation. These environment-specific measurements are not production load-test claims. Hybrid uses Reciprocal Rank Fusion; cross-encoder reranking is applied only when `HUGGINGFACE_API_KEY` is configured.",
    "",
    "## Reproduce",
    "",
    "```bash",
    "docker compose up -d --build",
    `pnpm eval -- --repoId ${repoId}`,
    "```",
    "",
    "The evaluator refuses to run this dataset against a different repository, fails if a strategy returns no results for every query, and uses exact repository-relative paths for relevance judgments.",
    "",
    "## Per-query results",
    "",
    queryDetails(reports),
    "## Limitations",
    "",
    "This is a small, project-specific regression benchmark, not a general claim about retrieval quality across arbitrary repositories. The labels were selected manually from known GitPulse subsystems. Results can change as the codebase, indexed commit, external embedding model, or local hardware changes.",
    ""
  ].join("\n");

  const docsDirectory = path.join(workspaceRoot, "docs");
  await mkdir(docsDirectory, { recursive: true });
  await writeFile(path.join(docsDirectory, "benchmarks.md"), benchmark);
  process.stdout.write(`${output}\n`);
};

const run = async (): Promise<void> => {
  const [{ prisma }, { RetrievalEvaluator }, { closeRedis }] = await Promise.all([
    import("@gitpulse/db"),
    import("./evaluator.js"),
    import("@gitpulse/retrieval")
  ]);

  try {
    await executeEvaluation(prisma, RetrievalEvaluator);
  } finally {
    await Promise.all([prisma.$disconnect(), closeRedis()]);
  }
};

run()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Evaluation failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
