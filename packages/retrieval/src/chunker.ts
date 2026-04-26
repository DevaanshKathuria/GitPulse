import type { ASTNode } from "@gitpulse/db";
import type { Chunk } from "./types.js";

const largeChunkTokenLimit = 1500;
const astWindowTokens = 1000;
const astWindowOverlapTokens = 200;
const fallbackWindowTokens = 512;
const fallbackWindowOverlapTokens = 128;
const charsPerToken = 4;
const minChunkChars = 20;
const supportedLanguages = new Set([
  "typescript",
  "javascript",
  "python",
  "go",
  "java",
  "ruby",
  "rust"
]);

const estimateTokens = (content: string): number => {
  return Math.ceil(content.length / charsPerToken);
};

const sliceLines = (
  content: string,
  startLine: number | null,
  endLine: number | null
): string => {
  if (startLine === null || endLine === null) {
    return "";
  }

  return content.split(/\r?\n/).slice(startLine - 1, endLine).join("\n");
};

const chunkIntoWindows = (
  content: string,
  windowTokens: number,
  overlapTokens: number
): string[] => {
  const windowChars = windowTokens * charsPerToken;
  const overlapChars = overlapTokens * charsPerToken;
  const stepChars = Math.max(windowChars - overlapChars, 1);
  const windows: string[] = [];

  for (let start = 0; start < content.length; start += stepChars) {
    const window = content.slice(start, start + windowChars);
    if (window.trim().length >= minChunkChars) {
      windows.push(window);
    }

    if (start + windowChars >= content.length) {
      break;
    }
  }

  return windows;
};

export class CodeChunker {
  public chunk(
    fileId: string,
    filePath: string,
    content: string,
    language: string,
    astNodes: ASTNode[]
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const astChunks = astNodes.filter(
      (node) => node.type === "function" || node.type === "class"
    );

    if (astChunks.length > 0 && supportedLanguages.has(language)) {
      for (const node of astChunks) {
        const nodeContent = sliceLines(content, node.startLine, node.endLine);
        if (nodeContent.trim().length < minChunkChars) {
          continue;
        }

        const windows =
          estimateTokens(nodeContent) > largeChunkTokenLimit
            ? chunkIntoWindows(nodeContent, astWindowTokens, astWindowOverlapTokens)
            : [nodeContent];

        for (const window of windows) {
          chunks.push({
            fileId,
            chunkIndex: chunks.length,
            content: window,
            metadata: {
              filePath,
              language,
              functionName: node.name ?? undefined,
              startLine: node.startLine ?? undefined,
              endLine: node.endLine ?? undefined,
              type: node.type === "class" ? "class" : "function"
            }
          });
        }
      }
    }

    if (chunks.length === 0) {
      for (const window of chunkIntoWindows(
        content,
        fallbackWindowTokens,
        fallbackWindowOverlapTokens
      )) {
        chunks.push({
          fileId,
          chunkIndex: chunks.length,
          content: window,
          metadata: {
            filePath,
            language,
            type: "window"
          }
        });
      }
    }

    return chunks.map((chunk, chunkIndex) => ({ ...chunk, chunkIndex }));
  }
}
