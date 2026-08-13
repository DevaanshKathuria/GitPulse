import assert from "node:assert/strict";
import { test } from "node:test";
import { ContributorIntelligenceService } from "../../apps/api/src/services/contributor-intelligence.js";

test("calculateBusFactor counts owners needed to cover half a directory", async () => {
  const ownership = new Map([
    ["src/a.ts", "alice"],
    ["src/b.ts", "alice"],
    ["src/c.ts", "bob"],
    ["src/d.ts", "carol"],
    ["docs/guide.md", "dana"]
  ]);

  const result = await new ContributorIntelligenceService().calculateBusFactor(
    "repo-1",
    ownership
  );

  assert.equal(result.overall, 1);
  assert.equal(result.byDirectory.src?.busFactor, 2);
  assert.deepEqual(result.byDirectory.src?.owners, ["alice", "bob", "carol"]);
  assert.equal(result.byDirectory.docs?.busFactor, 1);
});

test("identifyRisks excludes directories with broad ownership", () => {
  const risks = new ContributorIntelligenceService().identifyRisks({
    api: { busFactor: 1, owners: ["alice"] },
    web: { busFactor: 2, owners: ["bob", "carol"] },
    shared: { busFactor: 4, owners: ["a", "b", "c", "d"] }
  });

  assert.deepEqual(
    risks.map(({ directory, risk }) => ({ directory, risk })),
    [
      { directory: "api", risk: "critical" },
      { directory: "web", risk: "high" }
    ]
  );
});
