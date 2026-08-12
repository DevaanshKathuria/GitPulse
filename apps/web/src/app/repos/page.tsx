"use client";

import Link from "next/link";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { api, type Repository } from "../../lib/api";
import { StatusBadge } from "../../components/status-badge";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";

const formatDate = (value: string | null | undefined): string => {
  return value === null || value === undefined ? "Never" : new Date(value).toLocaleString();
};

export default function ReposPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const list = await api.listRepos();
    const hydrated = await Promise.all(
      list.map((repo) => api.getRepo(repo.id).catch(() => repo))
    );
    setRepos(hydrated);
    setLoading(false);
  };

  useEffect(() => {
    void load().catch(() => {
      setError("Unable to load repositories.");
      setLoading(false);
    });
  }, []);

  const hasActiveIngestion = useMemo(
    () => repos.some((repo) => repo.status === "indexing" || repo.status === "pending"),
    [repos]
  );

  useEffect(() => {
    if (!hasActiveIngestion) {
      return;
    }

    const interval = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(interval);
  }, [hasActiveIngestion]);

  const submit = async () => {
    setError(null);
    setSubmitting(true);

    try {
      await api.createRepo(githubUrl);
      setGithubUrl("");
      setOpen(false);
      await load();
    } catch {
      setError("Unable to add that repository. Check the URL and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Repositories</h1>
          <p className="mt-1 text-sm text-slate-400">Indexed codebases and ingestion state.</p>
        </div>
        <Button onClick={() => setOpen(true)}>Add Repository</Button>
      </div>

      {error !== null && <Badge tone="red">{error}</Badge>}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-44" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {repos.length === 0 ? (
            <Card className="md:col-span-2 xl:col-span-3">
              <CardContent className="py-12 text-center">
                <p className="font-medium text-slate-200">No repositories indexed yet</p>
                <p className="mt-1 text-sm text-slate-500">Add a public GitHub repository to start exploring its code.</p>
              </CardContent>
            </Card>
          ) : repos.map((repo) => (
            <Link key={repo.id} href={`/repos/${repo.id}`}>
              <Card className="h-full transition hover:border-sky-500/60">
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle>{repo.owner}/{repo.name}</CardTitle>
                    <p className="mt-1 break-all text-xs text-slate-500">{repo.githubUrl}</p>
                  </div>
                  <StatusBadge status={repo.status} />
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-slate-500">Commits</p>
                    <p className="text-lg font-semibold">{repo.commitCount ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Files</p>
                    <p className="text-lg font-semibold">{repo.fileCount ?? "-"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-slate-500">Last synced</p>
                    <p className="text-slate-200">{formatDate(repo.lastSyncedAt)}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>Add Repository</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="https://github.com/owner/repo"
                value={githubUrl}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setGithubUrl(event.target.value)
                }
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button disabled={githubUrl.length < 12 || submitting} onClick={() => void submit()}>
                  {submitting ? "Adding..." : "Start ingestion"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
