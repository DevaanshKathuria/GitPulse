import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isOriginAllowed,
  parseAllowedOrigins
} from "../../apps/api/src/lib/cors.js";

test("parseAllowedOrigins supports comma-separated configuration", () => {
  const origins = parseAllowedOrigins(
    "http://localhost:3000, https://gitpulse.example.com, "
  );

  assert.deepEqual([...origins], [
    "http://localhost:3000",
    "https://gitpulse.example.com"
  ]);
});

test("isOriginAllowed accepts explicitly configured origins", () => {
  const origins = new Set(["https://gitpulse.example.com"]);

  assert.equal(
    isOriginAllowed("https://gitpulse.example.com", origins, false),
    true
  );
  assert.equal(isOriginAllowed("https://other.example.com", origins, false), false);
});

test("isOriginAllowed optionally accepts loopback web development ports", () => {
  const origins = new Set<string>();

  assert.equal(isOriginAllowed("http://localhost:3002", origins, true), true);
  assert.equal(isOriginAllowed("http://127.0.0.1:4173", origins, true), true);
  assert.equal(isOriginAllowed("http://[::1]:3000", origins, true), true);
  assert.equal(isOriginAllowed("http://localhost.example.com:3002", origins, true), false);
  assert.equal(isOriginAllowed("http://localhost:3002", origins, false), false);
});
