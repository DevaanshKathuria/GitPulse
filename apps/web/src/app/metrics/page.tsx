"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { api, rawMetricsUrl } from "../../lib/api";
import {
  findMetric,
  parsePrometheusMetrics,
  sumMetric,
  type PrometheusSample
} from "../../lib/prometheus";

const formatDuration = (seconds: number | undefined): string => {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }

  const wholeSeconds = Math.floor(seconds);
  const days = Math.floor(wholeSeconds / 86_400);
  const hours = Math.floor((wholeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${wholeSeconds % 60}s`;
  return `${wholeSeconds}s`;
};

const formatBytes = (bytes: number | undefined): string => {
  if (bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

const formatCount = (value: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);

const StatCard = ({
  label,
  value,
  detail,
  tone = "sky"
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "sky" | "emerald" | "violet" | "amber";
}) => {
  const toneClasses = {
    sky: "bg-sky-400 shadow-sky-400/40",
    emerald: "bg-emerald-400 shadow-emerald-400/40",
    violet: "bg-violet-400 shadow-violet-400/40",
    amber: "bg-amber-400 shadow-amber-400/40"
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className={`h-2 w-2 rounded-full shadow-[0_0_12px] ${toneClasses[tone]}`} />
          {label}
        </div>
        <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-50">{value}</p>
        <p className="mt-1 text-xs text-slate-500">{detail}</p>
      </CardContent>
    </Card>
  );
};

const ActivityItem = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</p>
    <p className="mt-2 text-2xl font-semibold text-slate-100">{value}</p>
  </div>
);

export default function MetricsPage() {
  const [samples, setSamples] = useState<PrometheusSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);

    try {
      const rawMetrics = await api.metrics();
      setSamples(parsePrometheusMetrics(rawMetrics));
      setUpdatedAt(new Date());
      setError(null);
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to load metrics."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const summary = useMemo(() => {
    const processStartedAt = findMetric(samples, "process_start_time_seconds");
    const heapUsed = samples
      .filter((sample) => sample.name === "nodejs_heap_size_used_bytes")
      .reduce((total, sample) => total + sample.value, 0);
    const cacheHits = sumMetric(samples, "gitpulse_cache_hits_total");
    const cacheMisses = sumMetric(samples, "gitpulse_cache_misses_total");
    const cacheRequests = cacheHits + cacheMisses;

    return {
      uptime:
        processStartedAt === undefined ? undefined : Date.now() / 1000 - processStartedAt,
      residentMemory: findMetric(samples, "process_resident_memory_bytes"),
      heapUsed,
      eventLoopP99: findMetric(samples, "nodejs_eventloop_lag_p99_seconds"),
      searchRequests: sumMetric(samples, "gitpulse_search_requests_total"),
      ingestionJobs: sumMetric(samples, "gitpulse_ingestion_jobs_total"),
      queueDepth: sumMetric(samples, "gitpulse_queue_depth"),
      cacheHitRate: cacheRequests === 0 ? undefined : (cacheHits / cacheRequests) * 100
    };
  }, [samples, updatedAt]);

  const searchStrategies = useMemo(() => {
    const strategies = new Set(
      samples
        .filter((sample) => sample.name === "gitpulse_search_requests_total")
        .map((sample) => sample.labels.strategy)
        .filter((strategy): strategy is string => strategy !== undefined)
    );

    return [...strategies].sort().map((strategy) => {
      const requests =
        findMetric(samples, "gitpulse_search_requests_total", { strategy }) ?? 0;
      const latencySum =
        findMetric(samples, "gitpulse_search_latency_seconds_sum", { strategy }) ?? 0;
      const latencyCount =
        findMetric(samples, "gitpulse_search_latency_seconds_count", { strategy }) ?? 0;

      return {
        strategy,
        requests,
        meanLatencyMs: latencyCount === 0 ? undefined : (latencySum / latencyCount) * 1000
      };
    });
  }, [samples]);

  const queueDepths = useMemo(
    () =>
      samples
        .filter((sample) => sample.name === "gitpulse_queue_depth")
        .map((sample) => ({ queue: sample.labels.queue ?? "unknown", depth: sample.value }))
        .sort((left, right) => left.queue.localeCompare(right.queue)),
    [samples]
  );

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80 p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-50">System Metrics</h1>
              <Badge tone={error === null ? "green" : "red"}>
                {error === null ? "Live" : "Unavailable"}
              </Badge>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Runtime health and application activity from GitPulse&apos;s Prometheus telemetry.
            </p>
            <p className="mt-3 text-xs text-slate-500">
              {updatedAt === null
                ? "Waiting for the first snapshot"
                : `Updated ${updatedAt.toLocaleTimeString()} · refreshes every 15 seconds`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={rawMetricsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-md bg-slate-800 px-3 text-sm font-medium text-slate-100 transition hover:bg-slate-700"
            >
              Raw metrics
            </a>
            <Button disabled={refreshing} onClick={() => void load(true)}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </div>
      </section>

      {error !== null ? (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium text-red-200">Metrics API is unavailable</p>
              <p className="mt-1 text-sm text-red-200/70">{error}</p>
            </div>
            <Button variant="secondary" onClick={() => void load(true)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-36" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="API uptime" value={formatDuration(summary.uptime)} detail="Since the API process started" />
          <StatCard label="Resident memory" value={formatBytes(summary.residentMemory)} detail="Memory held by the API process" tone="emerald" />
          <StatCard label="Heap used" value={formatBytes(summary.heapUsed)} detail="JavaScript heap currently in use" tone="violet" />
          <StatCard
            label="Event loop p99"
            value={
              summary.eventLoopP99 === undefined
                ? "—"
                : `${(summary.eventLoopP99 * 1000).toFixed(1)} ms`
            }
            detail="99th percentile runtime delay"
            tone="amber"
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Application activity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ActivityItem label="Search requests" value={formatCount(summary.searchRequests)} />
          <ActivityItem label="Ingestion jobs" value={formatCount(summary.ingestionJobs)} />
          <ActivityItem label="Queued work" value={formatCount(summary.queueDepth)} />
          <ActivityItem
            label="Cache hit rate"
            value={
              summary.cacheHitRate === undefined ? "No traffic" : `${summary.cacheHitRate.toFixed(1)}%`
            }
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Search performance</CardTitle>
          </CardHeader>
          <CardContent>
            {searchStrategies.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Search activity will appear after the first query.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-800">
                <div className="grid grid-cols-3 bg-slate-900 px-4 py-2 text-xs uppercase tracking-wider text-slate-500">
                  <span>Strategy</span>
                  <span className="text-right">Requests</span>
                  <span className="text-right">Mean latency</span>
                </div>
                {searchStrategies.map((item) => (
                  <div key={item.strategy} className="grid grid-cols-3 border-t border-slate-800 px-4 py-3 text-sm">
                    <span className="font-medium capitalize text-slate-200">{item.strategy}</span>
                    <span className="text-right text-slate-300">{formatCount(item.requests)}</span>
                    <span className="text-right text-slate-300">
                      {item.meanLatencyMs === undefined ? "—" : `${item.meanLatencyMs.toFixed(0)} ms`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Queue health</CardTitle>
          </CardHeader>
          <CardContent>
            {queueDepths.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Queue readings will appear when workers report their depth.
              </p>
            ) : (
              <div className="space-y-3">
                {queueDepths.map((item) => (
                  <div key={item.queue} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
                    <div>
                      <p className="font-medium text-slate-200">{item.queue}</p>
                      <p className="text-xs text-slate-500">Waiting jobs</p>
                    </div>
                    <Badge tone={item.depth > 0 ? "yellow" : "green"}>
                      {formatCount(item.depth)} queued
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
