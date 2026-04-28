import { describe, expect, it } from "vitest";
import { PRIntelligenceService } from "./pr-intelligence.js";

describe("PRIntelligenceService", () => {
  it("detects removed exported symbols from a diff", () => {
    const service = new PRIntelligenceService("test-key");
    const changes = service.detectBreakingChanges(
      [
        "diff --git a/src/auth.ts b/src/auth.ts",
        "- export function authenticate(user: User) {",
        "+ function authenticateInternal(user: User) {"
      ].join("\n"),
      []
    );

    expect(changes).toContain("Removed exported function: authenticate");
  });
});
