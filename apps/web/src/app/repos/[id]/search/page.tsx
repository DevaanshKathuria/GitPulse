"use client";

import { type ChangeEvent, useState } from "react";
import { api, type SearchResult, type SearchStrategy } from "../../../../lib/api";
import { RepoTabs } from "../../../../components/repo-tabs";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Progress } from "../../../../components/ui/progress";

const languages = ["", "typescript", "javascript", "python", "go", "ruby", "rust", "java"];

export default function SearchPage({ params }: { params: { id: string } }) {
  const [query, setQuery] = useState("");
  const [strategy, setStrategy] = useState<SearchStrategy>("hybrid");
  const [language, setLanguage] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [meta, setMeta] = useState<{ latencyMs: number; strategy: string; cached: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    const response = await api.search({
      query,
      repoId: params.id,
      strategy,
      filters: language.length > 0 ? { language } : undefined,
      topK: 10
    });
    setResults(response.results);
    setMeta(response);
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <RepoTabs repoId={params.id} active="search" />
      <Card>
        <CardHeader>
          <CardTitle>Semantic Search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
            <Input
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setQuery(event.target.value)
              }
              placeholder="Find code by intent, symbol, or behavior"
            />
            <select
              className="h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
              value={language}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setLanguage(event.target.value)
              }
            >
              {languages.map((item) => <option key={item} value={item}>{item || "all languages"}</option>)}
            </select>
            <Button disabled={query.length < 3 || loading} onClick={() => void submit()}>{loading ? "Searching" : "Search"}</Button>
          </div>
          <div className="flex gap-3 text-sm text-slate-300">
            {(["hybrid", "vector", "bm25"] as const).map((item) => (
              <label key={item} className="flex items-center gap-2">
                <input type="radio" checked={strategy === item} onChange={() => setStrategy(item)} />
                {item}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {meta ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-400">{results.length} results in {meta.latencyMs}ms via {meta.strategy}</span>
          {meta.cached ? <Badge tone="green">Cached</Badge> : null}
        </div>
      ) : null}

      <div className="space-y-3">
        {results.map((result) => (
          <Card key={result.chunkId}>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-100">{result.filePath}</p>
                  {result.functionName ? <p className="text-sm text-slate-400">{result.functionName}</p> : null}
                </div>
                <Badge tone="blue">{result.language}</Badge>
              </div>
              <Progress value={Math.min(100, Math.max(0, result.score * 100))} />
              <pre className="max-h-32 overflow-hidden rounded-md bg-black/40 p-3 text-xs text-slate-300">{result.content.slice(0, 200)}</pre>
              <p className="text-xs text-slate-500">Lines {result.startLine ?? "-"} to {result.endLine ?? "-"}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
