import { prisma } from "@gitpulse/db";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { RetrievalEvaluator, type EvalReport } from "./evaluator.js";

const strategies = ["vector", "bm25", "hybrid"] as const;

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const formatNumber = (value: number): string => value.toFixed(3);
const formatMs = (value: number): string => `${Math.round(value)}ms`;

const row = (report: EvalReport): string => {
  return [
    report.strategy,
    formatPercent(report.recallAt5),
    formatPercent(report.recallAt10),
    formatNumber(report.mrr),
    formatNumber(report.ndcg10),
    formatMs(report.avgLatencyMs),
    formatMs(report.p95LatencyMs)
  ].join(" | ");
};

const table = (reports: EvalReport[]): string => {
  return [
    "| Strategy | Recall@5 | Recall@10 | MRR | nDCG@10 | Avg Latency | P95 Latency |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...reports.map((report) => `| ${row(report)} |`)
  ].join("\n");
};

const latencySummary = async (repoId: string): Promise<string> => {
  const logs = await prisma.retrievalLog
    .findMany({
      where: { repoId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        strategy: true,
        latencyMs: true,
        createdAt: true
      }
    })
    .catch(() => []);

  if (logs.length === 0) {
    return "No retrieval latency logs found for this repository.";
  }

  return logs
    .map((log) => {
      return `- ${log.createdAt.toISOString()} ${log.strategy ?? "unknown"} ${
        log.latencyMs ?? 0
      }ms`;
    })
    .join("\n");
};

const run = async (): Promise<void> => {
  const repoId = process.argv[2];

  if (repoId === undefined || repoId.length === 0) {
    throw new Error("Usage: pnpm run eval <repoId>");
  }

  const evaluator = new RetrievalEvaluator();
  const reports: EvalReport[] = [];

  for (const strategy of strategies) {
    reports.push(await evaluator.evaluate(repoId, strategy));
  }

  const output = table(reports);
  const benchmark = [
    "# GitPulse Retrieval Benchmarks",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Repository: ${repoId}`,
    "",
    output,
    "",
    "## Recent Retrieval Latency Logs",
    "",
    await latencySummary(repoId),
    ""
  ].join("\n");

  await mkdir(path.resolve("docs"), { recursive: true });
  await writeFile(path.resolve("docs", "benchmarks.md"), benchmark);
  process.stdout.write(`${output}\n`);
};

run()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Evaluation failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect().finally(() => {
      process.exit();
    });
  });
