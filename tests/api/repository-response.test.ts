import assert from "node:assert/strict";
import { test } from "node:test";
import { publicRepositorySelect } from "../../apps/api/src/lib/repository-response.js";

test("public repository responses never select the webhook secret", () => {
  assert.equal("webhookSecret" in publicRepositorySelect, false);
  assert.deepEqual(Object.keys(publicRepositorySelect).sort(), [
    "createdAt",
    "githubUrl",
    "id",
    "lastSyncedAt",
    "metadata",
    "name",
    "owner",
    "status",
    "updatedAt"
  ]);
});
