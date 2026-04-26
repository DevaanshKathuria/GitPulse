import { describe, expect, it } from "vitest";
import { detectCircularDependencies } from "./dependency-graph.js";

describe("detectCircularDependencies", () => {
  it("detects a simple A -> B -> A cycle", () => {
    const cycles = detectCircularDependencies([
      { from: "A.ts", to: "B.ts" },
      { from: "B.ts", to: "A.ts" }
    ]);

    expect(cycles).toEqual([["A.ts", "B.ts", "A.ts"]]);
  });
});
