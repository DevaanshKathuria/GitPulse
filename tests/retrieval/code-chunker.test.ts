import assert from "node:assert/strict";
import { test } from "node:test";
import { CodeChunker } from "../../packages/retrieval/src/chunker.js";

type AstNode = Parameters<CodeChunker["chunk"]>[4][number];

const astNode = (values: Partial<AstNode>): AstNode => {
  return {
    id: "node-1",
    fileId: "file-1",
    type: "function",
    name: "authenticate",
    startLine: 2,
    endLine: 4,
    metadata: null,
    createdAt: new Date(0),
    ...values
  };
};

test("CodeChunker creates chunks from function boundaries", () => {
  const content = [
    "const version = 1;",
    "export function authenticate(token: string) {",
    "  return token.length > 10;",
    "}",
    "export const unrelated = true;"
  ].join("\n");

  const chunks = new CodeChunker().chunk(
    "file-1",
    "src/auth.ts",
    content,
    "typescript",
    [astNode({})]
  );

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.metadata.type, "function");
  assert.equal(chunks[0]?.metadata.functionName, "authenticate");
  assert.equal(chunks[0]?.metadata.startLine, 2);
  assert.match(chunks[0]?.content ?? "", /return token\.length/);
  assert.doesNotMatch(chunks[0]?.content ?? "", /unrelated/);
});

test("CodeChunker falls back to window chunks without AST nodes", () => {
  const content = "const message = 'fallback content long enough to index';";
  const chunks = new CodeChunker().chunk(
    "file-2",
    "src/plain.ts",
    content,
    "typescript",
    []
  );

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.chunkIndex, 0);
  assert.equal(chunks[0]?.metadata.type, "window");
  assert.equal(chunks[0]?.content, content);
});
