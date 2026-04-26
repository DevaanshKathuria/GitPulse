import { prisma } from "@gitpulse/db";
import path from "node:path";

export interface DependencyGraph {
  nodes: Array<{
    id: string;
    path: string;
    functionCount: number;
    importCount: number;
  }>;
  edges: Array<{ from: string; to: string; type: string }>;
  circularDependencies: string[][];
  unusedFiles: string[];
}

const entryPointNames = new Set(["index.ts", "main.ts", "app.ts", "server.ts"]);

const normalizePath = (filePath: string): string => path.posix.normalize(filePath);

const isEntryPoint = (filePath: string): boolean => {
  return entryPointNames.has(path.posix.basename(filePath));
};

export const detectCircularDependencies = (
  edges: Array<{ from: string; to: string }>
): string[][] => {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    const from = normalizePath(edge.from);
    const to = normalizePath(edge.to);
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
    adjacency.set(to, adjacency.get(to) ?? []);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const pathStack: string[] = [];
  const cycles = new Map<string, string[]>();

  const visit = (node: string): void => {
    visited.add(node);
    stack.add(node);
    pathStack.push(node);

    for (const next of adjacency.get(node) ?? []) {
      if (!visited.has(next)) {
        visit(next);
        continue;
      }

      if (!stack.has(next)) {
        continue;
      }

      const cycleStart = pathStack.indexOf(next);
      const cycle = [...pathStack.slice(cycleStart), next];
      const key = [...new Set(cycle)].sort().join("::");
      cycles.set(key, cycle);
    }

    stack.delete(node);
    pathStack.pop();
  };

  for (const node of adjacency.keys()) {
    if (!visited.has(node)) {
      visit(node);
    }
  }

  return [...cycles.values()];
};

export class DependencyGraphBuilder {
  public async buildForRepo(repoId: string): Promise<DependencyGraph> {
    const [dependencyEdges, codeFiles, astNodes] = await Promise.all([
      prisma.dependencyEdge.findMany({ where: { repoId } }),
      prisma.codeFile.findMany({
        where: { repoId },
        select: { id: true, path: true }
      }),
      prisma.aSTNode.findMany({
        where: {
          file: { repoId }
        },
        select: { fileId: true, type: true }
      })
    ]);

    const adjacency = new Map<string, string[]>();
    const incoming = new Set<string>();
    const functionCounts = new Map<string, number>();
    const importCounts = new Map<string, number>();

    for (const file of codeFiles) {
      adjacency.set(normalizePath(file.path), []);
    }

    for (const astNode of astNodes) {
      if (astNode.type !== "function") {
        continue;
      }

      functionCounts.set(astNode.fileId, (functionCounts.get(astNode.fileId) ?? 0) + 1);
    }

    for (const edge of dependencyEdges) {
      const from = normalizePath(edge.fromFile);
      const to = normalizePath(edge.toFile);
      adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
      incoming.add(to);
      importCounts.set(from, (importCounts.get(from) ?? 0) + 1);
    }

    return {
      nodes: codeFiles.map((file) => ({
        id: file.id,
        path: file.path,
        functionCount: functionCounts.get(file.id) ?? 0,
        importCount: importCounts.get(normalizePath(file.path)) ?? 0
      })),
      edges: dependencyEdges.map((edge) => ({
        from: edge.fromFile,
        to: edge.toFile,
        type: edge.type
      })),
      circularDependencies: detectCircularDependencies(
        dependencyEdges.map((edge) => ({ from: edge.fromFile, to: edge.toFile }))
      ),
      unusedFiles: codeFiles
        .map((file) => normalizePath(file.path))
        .filter((filePath) => !incoming.has(filePath) && !isEntryPoint(filePath))
    };
  }
}
