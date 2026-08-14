import {
  prisma,
  Prisma,
  type ASTNode,
  type PullRequest
} from "@gitpulse/db";
import OpenAI from "openai";

export interface ChangedDependencies {
  added: string[];
  removed: string[];
}

export interface ComplexityEstimate {
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  score: number;
}

const riskFileKeywords = [
  "auth",
  "security",
  "middleware",
  "database",
  "migration",
  "schema"
];

const importSourcePattern =
  /(?:import\s+(?:[^'"]+\s+from\s+)?|require\s*\()\s*['"]([^'"]+)['"]/;
const removedExportPattern =
  /^-\s*export\s+(?:async\s+)?(?:function|class|interface|const|let|var|type|enum)\s+([A-Za-z_$][\w$]*)/;
const removedNamedExportPattern = /^-\s*export\s*\{([^}]+)\}/;
const removedRenamedExportPattern =
  /^-\s*export\s+(?:async\s+)?(function|class)\s+([A-Za-z_$][\w$]*)/;
const addedRenamedExportPattern =
  /^\+\s*export\s+(?:async\s+)?(function|class)\s+([A-Za-z_$][\w$]*)/;

const dedupe = (values: string[]): string[] => [...new Set(values)];

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

export const extractChangedFiles = (diff: string): string[] => {
  return diff
    .split("\n")
    .filter((line) => line.startsWith("diff --git "))
    .map((line) => {
      const parts = line.split(" ");
      const filePath = parts[3]?.replace(/^b\//, "");
      return filePath ?? null;
    })
    .filter((filePath): filePath is string => filePath !== null);
};

export class PRIntelligenceService {
  private readonly apiKey: string;
  private readonly baseUrl: string | undefined;
  private readonly model: string;

  public constructor(
    apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? ""
  ) {
    this.apiKey = apiKey;
    this.baseUrl = process.env.LLM_BASE_URL?.trim() || undefined;
    this.model = process.env.LLM_MODEL?.trim() || "gpt-4o";
  }

  public async summarizePR(pr: PullRequest): Promise<string> {
    try {
      if (this.apiKey.length === 0) {
        return "Summary unavailable.";
      }

      const openai = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseUrl
      });
      const completion = await openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "You are a senior software engineer reviewing a pull request. Provide a concise technical summary in exactly 3-5 sentences. Focus on: what changed, why it matters, and any risks."
          },
          {
            role: "user",
            content: `PR Title: ${pr.title}\n\nDescription: ${
              pr.body ?? ""
            }\n\nDiff (truncated to 3000 chars):\n${pr.diff?.slice(0, 3000) ?? ""}`
          }
        ]
      });

      return completion.choices[0]?.message.content ?? "Summary unavailable.";
    } catch {
      return "Summary unavailable.";
    }
  }

  public async detectChangedDeps(diff: string): Promise<ChangedDependencies> {
    const added: string[] = [];
    const removed: string[] = [];

    for (const line of diff.split("\n")) {
      if (
        (!line.startsWith("+") && !line.startsWith("-")) ||
        line.startsWith("+++") ||
        line.startsWith("---") ||
        (!line.includes("import") && !line.includes("require"))
      ) {
        continue;
      }

      const source = importSourcePattern.exec(line)?.[1];
      if (source === undefined) {
        continue;
      }

      if (line.startsWith("+")) {
        added.push(source);
      } else {
        removed.push(source);
      }
    }

    return {
      added: dedupe(added),
      removed: dedupe(removed)
    };
  }

  public estimateComplexity(diff: string): ComplexityEstimate {
    const lines = diff.split("\n");
    const linesAdded = lines.filter(
      (line) => line.startsWith("+") && !line.startsWith("+++")
    ).length;
    const linesRemoved = lines.filter(
      (line) => line.startsWith("-") && !line.startsWith("---")
    ).length;
    const filesChanged = lines.filter((line) => line.startsWith("diff --git")).length;

    return {
      linesAdded,
      linesRemoved,
      filesChanged,
      score: Math.min((linesAdded + linesRemoved) * 0.4 + filesChanged * 10, 100)
    };
  }

  public async scoreRisk(
    pr: PullRequest,
    changedFiles: string[],
    complexity: ComplexityEstimate
  ): Promise<number> {
    const changedDeps = await this.detectChangedDeps(pr.diff ?? "");
    let score = 0;

    if (complexity.score > 50) {
      score += 20;
    }
    if (complexity.filesChanged > 10) {
      score += 15;
    }
    if (
      changedFiles.some((file) =>
        riskFileKeywords.some((keyword) => file.toLowerCase().includes(keyword))
      )
    ) {
      score += 25;
    }
    if (changedDeps.added.length > 3) {
      score += 10;
    }
    if (!changedFiles.some((file) => file.includes(".test.") || file.includes(".spec."))) {
      score += 15;
    }
    if (changedFiles.length > 20) {
      score += 15;
    }

    return Math.min(score, 100);
  }

  public detectBreakingChanges(diff: string, _astNodes: ASTNode[]): string[] {
    const breakingChanges: string[] = [];
    const removedExports: Array<{ type: string; name: string }> = [];
    const addedExports: Array<{ type: string; name: string }> = [];

    for (const line of diff.split("\n")) {
      const removedExport = removedExportPattern.exec(line);
      if (removedExport?.[1] !== undefined) {
        breakingChanges.push(`Removed exported function: ${removedExport[1]}`);
      }

      const removedNamedExports = removedNamedExportPattern.exec(line)?.[1];
      if (removedNamedExports !== undefined) {
        for (const exportName of removedNamedExports.split(",")) {
          const name = exportName.trim().split(/\s+as\s+/)[0];
          if (name !== undefined && name.length > 0) {
            breakingChanges.push(`Removed exported function: ${name}`);
          }
        }
      }

      const removedRename = removedRenamedExportPattern.exec(line);
      if (removedRename?.[1] !== undefined && removedRename[2] !== undefined) {
        removedExports.push({ type: removedRename[1], name: removedRename[2] });
      }

      const addedRename = addedRenamedExportPattern.exec(line);
      if (addedRename?.[1] !== undefined && addedRename[2] !== undefined) {
        addedExports.push({ type: addedRename[1], name: addedRename[2] });
      }
    }

    for (const removed of removedExports) {
      const added = addedExports.find((candidate) => candidate.type === removed.type);
      if (added !== undefined && added.name !== removed.name) {
        breakingChanges.push(`Renamed: ${removed.name} -> ${added.name}`);
      }
    }

    return dedupe(breakingChanges);
  }

  public async analyzePR(prId: string): Promise<void> {
    const pr = await prisma.pullRequest.findUnique({
      where: { id: prId }
    });

    if (pr === null) {
      return;
    }

    const diff = pr.diff ?? "";
    const changedFiles = extractChangedFiles(diff);
    const astNodes = await prisma.aSTNode.findMany({
      where: {
        file: {
          repoId: pr.repoId
        }
      }
    });
    const complexity = this.estimateComplexity(diff);
    const [summary, changedDeps, breakingChanges] = await Promise.all([
      this.summarizePR(pr),
      this.detectChangedDeps(diff),
      Promise.resolve(this.detectBreakingChanges(diff, astNodes))
    ]);
    const risk = await this.scoreRisk(pr, changedFiles, complexity);

    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: {
        summary,
        riskScore: risk,
        metadata: toInputJson({
          complexity,
          changedDeps,
          breakingChanges,
          changedFiles,
          analyzedAt: new Date().toISOString()
        })
      }
    });
  }
}
