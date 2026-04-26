import { prisma } from "@gitpulse/db";
import path from "node:path";
import pino from "pino";
import { parseGo } from "./parsers/go-parser.js";
import { parsePython } from "./parsers/python-parser.js";
import { parseTypeScript } from "./parsers/typescript-parser.js";
import type { ParseResult, ParsedRoute } from "./types.js";

const logger = pino({ name: "gitpulse-parser" });

const parseByLanguage = (
  filePath: string,
  content: string,
  language: string
): ParseResult | null => {
  switch (language) {
    case "typescript":
    case "javascript":
      return parseTypeScript(filePath, content);
    case "python":
      return parsePython(content);
    case "go":
      return parseGo(content);
    default:
      return null;
  }
};

const resolveInternalImport = (
  filePath: string,
  source: string,
  knownFilePaths: Set<string>
): string => {
  if (source.startsWith("/")) {
    return resolveKnownPath(path.posix.normalize(source.slice(1)), knownFilePaths);
  }

  return resolveKnownPath(
    path.posix.normalize(path.posix.join(path.posix.dirname(filePath), source)),
    knownFilePaths
  );
};

const resolveKnownPath = (basePath: string, knownFilePaths: Set<string>): string => {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.py`,
    `${basePath}.go`,
    path.posix.join(basePath, "index.ts"),
    path.posix.join(basePath, "index.tsx"),
    path.posix.join(basePath, "index.js"),
    path.posix.join(basePath, "index.jsx")
  ];

  return candidates.find((candidate) => knownFilePaths.has(candidate)) ?? basePath;
};

const routeMetadata = (route: ParsedRoute): Record<string, string | number> => ({
  method: route.method,
  path: route.path,
  line: route.line
});

export class ParserOrchestrator {
  public async parse(
    fileId: string,
    filePath: string,
    content: string,
    language: string
  ): Promise<void> {
    const result = parseByLanguage(filePath, content, language);

    if (result === null) {
      return;
    }

    const codeFile = await prisma.codeFile.findUnique({
      where: { id: fileId },
      select: { repoId: true, repo: { select: { codeFiles: { select: { path: true } } } } }
    });

    if (codeFile === null) {
      return;
    }

    await prisma.$transaction([
      prisma.aSTNode.deleteMany({ where: { fileId } }),
      prisma.dependencyEdge.deleteMany({
        where: {
          repoId: codeFile.repoId,
          fromFile: filePath
        }
      })
    ]);

    await prisma.aSTNode.createMany({
      data: [
        ...result.functions.map((fn) => ({
          fileId,
          type: "function",
          name: fn.name,
          startLine: fn.startLine,
          endLine: fn.endLine,
          metadata: {
            params: fn.params,
            returnType: fn.returnType ?? null,
            isExported: fn.isExported,
            decorators: fn.decorators ?? []
          }
        })),
        ...result.classes.map((cls) => ({
          fileId,
          type: "class",
          name: cls.name,
          startLine: cls.startLine,
          endLine: cls.endLine,
          metadata: {
            isExported: cls.isExported
          }
        })),
        ...result.interfaces.map((iface) => ({
          fileId,
          type: "interface",
          name: iface.name,
          startLine: iface.startLine,
          endLine: iface.endLine,
          metadata: {}
        })),
        ...result.routes.map((route) => ({
          fileId,
          type: "route",
          name: `${route.method.toUpperCase()} ${route.path}`,
          startLine: route.line,
          endLine: route.line,
          metadata: routeMetadata(route)
        }))
      ]
    });

    const knownFilePaths = new Set(
      codeFile.repo.codeFiles.map((file) => path.posix.normalize(file.path))
    );

    for (const parsedImport of result.imports) {
      if (parsedImport.isExternal) {
        continue;
      }

      const toFile = resolveInternalImport(filePath, parsedImport.source, knownFilePaths);

      await prisma.dependencyEdge.upsert({
        where: {
          repoId_fromFile_toFile_type: {
            repoId: codeFile.repoId,
            fromFile: filePath,
            toFile,
            type: "import"
          }
        },
        create: {
          repoId: codeFile.repoId,
          fromFile: filePath,
          toFile,
          type: "import"
        },
        update: {}
      });
    }

    logger.info(
      {
        filePath,
        functionCount: result.functions.length,
        importCount: result.imports.length
      },
      `Parsed ${filePath}: ${result.functions.length} functions, ${result.imports.length} imports`
    );
  }
}
