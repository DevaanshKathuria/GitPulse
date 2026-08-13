import { prisma, Prisma } from "@gitpulse/db";

export interface BusFactorResult {
  overall: number;
  byDirectory: Record<string, { busFactor: number; owners: string[] }>;
}

export interface ConcentrationRisk {
  directory: string;
  risk: "critical" | "high" | "medium";
  reason: string;
}

export interface ActivityTrend {
  week: string;
  commits: number;
}

interface FileChangeEntry {
  path: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

const extractChangedFilePaths = (
  filesChanged: Prisma.JsonValue | null
): string[] => {
  if (!Array.isArray(filesChanged)) {
    return [];
  }

  return filesChanged
    .map((entry): string | null => {
      if (typeof entry === "string") {
        return entry;
      }

      if (isObject(entry) && typeof entry.path === "string") {
        return (entry as unknown as FileChangeEntry).path;
      }

      if (isObject(entry) && typeof entry.filename === "string") {
        return entry.filename;
      }

      return null;
    })
    .filter((path): path is string => path !== null);
};

const topLevelDirectory = (filePath: string): string => {
  return filePath.split("/")[0] ?? ".";
};

const isoWeek = (date: Date): string => {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
};

const lastTwelveWeeks = (): string[] => {
  const weeks: string[] = [];
  const cursor = new Date();

  for (let index = 11; index >= 0; index -= 1) {
    const weekDate = new Date(cursor);
    weekDate.setDate(cursor.getDate() - index * 7);
    weeks.push(isoWeek(weekDate));
  }

  return weeks;
};

export class ContributorIntelligenceService {
  public async buildOwnershipMap(repoId: string): Promise<Map<string, string>> {
    const commits = await prisma.commit.findMany({
      where: { repoId },
      select: {
        author: true,
        filesChanged: true
      }
    });
    const fileContributions = new Map<string, Map<string, number>>();

    for (const commit of commits) {
      for (const filePath of extractChangedFilePaths(commit.filesChanged)) {
        const contributors = fileContributions.get(filePath) ?? new Map<string, number>();
        contributors.set(commit.author, (contributors.get(commit.author) ?? 0) + 1);
        fileContributions.set(filePath, contributors);
      }
    }

    const ownership = new Map<string, string>();
    for (const [filePath, contributors] of fileContributions.entries()) {
      const total = [...contributors.values()].reduce((sum, count) => sum + count, 0);
      const owner = [...contributors.entries()].find(([, count]) => count / total > 0.5);
      if (owner !== undefined) {
        ownership.set(filePath, owner[0]);
      }
    }

    return ownership;
  }

  public async calculateBusFactor(
    _repoId: string,
    ownershipMap: Map<string, string>
  ): Promise<BusFactorResult> {
    const directoryFiles = new Map<string, string[]>();
    const directoryOwners = new Map<string, Map<string, number>>();

    for (const [filePath, owner] of ownershipMap.entries()) {
      const directory = topLevelDirectory(filePath);
      directoryFiles.set(directory, [...(directoryFiles.get(directory) ?? []), filePath]);
      const owners = directoryOwners.get(directory) ?? new Map<string, number>();
      owners.set(owner, (owners.get(owner) ?? 0) + 1);
      directoryOwners.set(directory, owners);
    }

    const byDirectory: BusFactorResult["byDirectory"] = {};
    for (const [directory, files] of directoryFiles.entries()) {
      const owners = directoryOwners.get(directory) ?? new Map<string, number>();
      const contributionCounts = [...owners.values()].sort(
        (left, right) => right - left
      );
      let coveredFiles = 0;
      let busFactor = 0;

      for (const ownedFileCount of contributionCounts) {
        coveredFiles += ownedFileCount;
        busFactor += 1;
        if (coveredFiles / files.length > 0.5) {
          break;
        }
      }

      byDirectory[directory] = {
        busFactor,
        owners: [...owners.keys()]
      };
    }

    const factors = Object.values(byDirectory).map((entry) => entry.busFactor);
    return {
      overall: factors.length === 0 ? 0 : Math.min(...factors),
      byDirectory
    };
  }

  public identifyRisks(
    busFactor: Record<string, { busFactor: number; owners: string[] }>
  ): ConcentrationRisk[] {
    return Object.entries(busFactor)
      .map(([directory, value]): ConcentrationRisk | null => {
        if (value.busFactor === 1) {
          return {
            directory,
            risk: "critical",
            reason: "Single contributor owns this subsystem"
          };
        }

        if (value.busFactor === 2) {
          return {
            directory,
            risk: "high",
            reason: "Only two contributors own this subsystem"
          };
        }

        if (value.busFactor <= 3) {
          return {
            directory,
            risk: "medium",
            reason: "Limited ownership diversity"
          };
        }

        return null;
      })
      .filter((risk): risk is ConcentrationRisk => risk !== null);
  }

  public async getActivityTrends(
    repoId: string,
    contributorLogin: string
  ): Promise<ActivityTrend[]> {
    const weeks = lastTwelveWeeks();
    const weekCounts = new Map(weeks.map((week) => [week, 0]));
    const since = new Date();
    since.setDate(since.getDate() - 12 * 7);
    const commits = await prisma.commit.findMany({
      where: {
        repoId,
        author: contributorLogin,
        timestamp: {
          gte: since
        }
      },
      select: {
        timestamp: true
      }
    });

    for (const commit of commits) {
      const week = isoWeek(commit.timestamp);
      if (weekCounts.has(week)) {
        weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1);
      }
    }

    return weeks.map((week) => ({
      week,
      commits: weekCounts.get(week) ?? 0
    }));
  }

  public async analyzeContributors(repoId: string): Promise<void> {
    const ownershipMap = await this.buildOwnershipMap(repoId);
    const busFactor = await this.calculateBusFactor(repoId, ownershipMap);
    const risks = this.identifyRisks(busFactor.byDirectory);
    const contributors = await prisma.contributor.findMany({ where: { repoId } });

    await prisma.$transaction(
      contributors.map((contributor) => {
        const ownedFiles = [...ownershipMap.entries()]
          .filter(([, owner]) => owner === contributor.login)
          .map(([filePath]) => filePath);

        return prisma.contributor.update({
          where: { id: contributor.id },
          data: { ownedFiles: toInputJson(ownedFiles) }
        });
      })
    );

    const repository = await prisma.repository.findUnique({
      where: { id: repoId },
      select: { metadata: true }
    });
    const metadata = isObject(repository?.metadata) ? repository.metadata : {};

    await prisma.repository.update({
      where: { id: repoId },
      data: {
        metadata: toInputJson({
          ...metadata,
          contributorAnalytics: {
            ...busFactor,
            risks,
            analyzedAt: new Date().toISOString()
          }
        })
      }
    });
  }
}
