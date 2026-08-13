import assert from "node:assert/strict";
import { test } from "node:test";
import { detectCircularDependencies } from "../../packages/parser/src/dependency-graph.js";

test("detectCircularDependencies returns a closed dependency cycle", () => {
  const cycles = detectCircularDependencies([
    { from: "src/a.ts", to: "src/b.ts" },
    { from: "src/b.ts", to: "src/c.ts" },
    { from: "src/c.ts", to: "src/a.ts" },
    { from: "src/d.ts", to: "src/e.ts" }
  ]);

  assert.deepEqual(cycles, [["src/a.ts", "src/b.ts", "src/c.ts", "src/a.ts"]]);
});

test("detectCircularDependencies ignores acyclic paths", () => {
  const cycles = detectCircularDependencies([
    { from: "src/index.ts", to: "src/server.ts" },
    { from: "src/server.ts", to: "src/routes.ts" }
  ]);

  assert.deepEqual(cycles, []);
});
