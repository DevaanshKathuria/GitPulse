"use client";

import { useEffect, useState } from "react";
import { api, type Contributor, type Repository } from "../../../lib/api";
import { RepoTabs } from "../../../components/repo-tabs";
import { StatusBadge } from "../../../components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";

export default function RepoDashboardPage({ params }: { params: { id: string } }) {
  const [repo, setRepo] = useState<Repository | null>(null);
  const [contributors, setContributors] = useState<Contributor[]>([]);

  useEffect(() => {
    void Promise.all([
      api.getRepo(params.id).then(setRepo),
      api.contributors(params.id).then(setContributors).catch(() => setContributors([]))
    ]);
  }, [params.id]);

  if (repo === null) {
    return <Skeleton className="h-80" />;
  }

  const stats = [
    ["Commits", repo.commitCount ?? 0],
    ["Pull Requests", repo.prCount ?? 0],
    ["Files", repo.fileCount ?? 0],
    ["Contributors", contributors.length]
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{repo.owner}/{repo.name}</h1>
          <p className="mt-1 break-all text-sm text-slate-400">{repo.githubUrl}</p>
        </div>
        <StatusBadge status={repo.status} />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {stats.map(([label, value]) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="text-sm text-slate-400">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ingestion</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-slate-300 md:grid-cols-3">
          <p>Status: <span className="text-slate-100">{repo.status}</span></p>
          <p>Last synced: {repo.lastSyncedAt ? new Date(repo.lastSyncedAt).toLocaleString() : "Never"}</p>
          <p>Job: {repo.latestIngestionJob?.status ?? "none"}</p>
        </CardContent>
      </Card>

      <RepoTabs repoId={params.id} active="" />
    </div>
  );
}
