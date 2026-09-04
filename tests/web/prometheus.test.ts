import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findMetric,
  parsePrometheusMetrics,
  sumMetric
} from "../../apps/web/src/lib/prometheus.js";

const fixture = `
# HELP gitpulse_search_requests_total Total search requests
# TYPE gitpulse_search_requests_total counter
gitpulse_search_requests_total{strategy="bm25"} 4
gitpulse_search_requests_total{strategy="vector"} 2
process_resident_memory_bytes 104857600
escaped_metric{path="line\\nquote\\\"slash\\\\"} 1
`;

test("parsePrometheusMetrics parses samples, labels, and comments", () => {
  const samples = parsePrometheusMetrics(fixture);

  assert.equal(samples.length, 4);
  assert.equal(
    findMetric(samples, "gitpulse_search_requests_total", { strategy: "bm25" }),
    4
  );
  assert.equal(findMetric(samples, "process_resident_memory_bytes"), 104857600);
  assert.equal(
    findMetric(samples, "escaped_metric", { path: 'line\nquote"slash\\' }),
    1
  );
});

test("sumMetric aggregates labeled series", () => {
  const samples = parsePrometheusMetrics(fixture);

  assert.equal(sumMetric(samples, "gitpulse_search_requests_total"), 6);
  assert.equal(sumMetric(samples, "missing_metric"), 0);
});
