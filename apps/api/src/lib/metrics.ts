import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  register
} from "prom-client";

type CounterMetric = Counter<string>;
type GaugeMetric = Gauge<string>;
type HistogramMetric = Histogram<string>;

const getCounter = (
  name: string,
  help: string,
  labelNames?: string[]
): CounterMetric => {
  return (
    (register.getSingleMetric(name) as CounterMetric | undefined) ??
    new Counter({ name, help, labelNames: labelNames ?? [] })
  );
};

const getGauge = (
  name: string,
  help: string,
  labelNames?: string[]
): GaugeMetric => {
  return (
    (register.getSingleMetric(name) as GaugeMetric | undefined) ??
    new Gauge({ name, help, labelNames: labelNames ?? [] })
  );
};

const getHistogram = (
  name: string,
  help: string,
  buckets: number[],
  labelNames?: string[]
): HistogramMetric => {
  return (
    (register.getSingleMetric(name) as HistogramMetric | undefined) ??
    new Histogram({ name, help, buckets, labelNames: labelNames ?? [] })
  );
};

collectDefaultMetrics({ register });

export const ingestionJobsTotal = getCounter(
  "gitpulse_ingestion_jobs_total",
  "Total ingestion jobs",
  ["status"]
);

export const ingestionDurationSeconds = getHistogram(
  "gitpulse_ingestion_duration_seconds",
  "Ingestion duration",
  [1, 5, 10, 30, 60, 120, 300]
);

export const searchLatencySeconds = getHistogram(
  "gitpulse_search_latency_seconds",
  "Search latency",
  [0.1, 0.25, 0.5, 1, 2, 5],
  ["strategy"]
);

export const searchRequestsTotal = getCounter(
  "gitpulse_search_requests_total",
  "Total search requests",
  ["strategy"]
);

export const cacheHitsTotal = getCounter(
  "gitpulse_cache_hits_total",
  "Cache hits",
  ["key_type"]
);

export const cacheMissesTotal = getCounter(
  "gitpulse_cache_misses_total",
  "Cache misses",
  ["key_type"]
);

export const queueDepth = getGauge(
  "gitpulse_queue_depth",
  "Current queue depth",
  ["queue"]
);

export const workerJobDuration = getHistogram(
  "gitpulse_worker_job_duration_seconds",
  "Worker job duration",
  [0.5, 1, 5, 10, 30, 60],
  ["queue", "status"]
);

export const embeddingBatchesTotal = getCounter(
  "gitpulse_embedding_batches_total",
  "Embedding API batches processed"
);

export const observeSearch = (
  strategy: string,
  latencyMs: number
): void => {
  try {
    searchRequestsTotal.inc({ strategy });
    searchLatencySeconds.observe({ strategy }, latencyMs / 1000);
  } catch {
    return;
  }
};

export const observeCacheHit = (keyType: string): void => {
  try {
    cacheHitsTotal.inc({ key_type: keyType });
  } catch {
    return;
  }
};

export const observeCacheMiss = (keyType: string): void => {
  try {
    cacheMissesTotal.inc({ key_type: keyType });
  } catch {
    return;
  }
};

export { register };
