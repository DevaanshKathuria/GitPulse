"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type BusFactor, type Contributor } from "../../../../lib/api";
import { RepoTabs } from "../../../../components/repo-tabs";
import { Badge } from "../../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "../../../../components/ui/table";
import { Skeleton } from "../../../../components/ui/skeleton";

const riskTone = (risk: string): "red" | "orange" | "yellow" | "green" => {
  if (risk === "critical") return "red";
  if (risk === "high") return "orange";
  if (risk === "medium") return "yellow";
  return "green";
};

export default function ContributorsPage({ params }: { params: { id: string } }) {
  const [contributors, setContributors] = useState<Contributor[] | null>(null);
  const [busFactor, setBusFactor] = useState<BusFactor | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .contributors(params.id)
      .then((response) => {
        if (active) setContributors(response);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load contributors"
          );
        }
      });
    void api
      .busFactor(params.id)
      .then((response) => {
        if (active && "overall" in response) setBusFactor(response);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load bus-factor analysis"
          );
        }
      });

    return () => {
      active = false;
    };
  }, [params.id]);

  const directoryRows = useMemo(() => {
    if (busFactor === null) return [];
    return Object.entries(busFactor.byDirectory).map(([directory, value]) => ({
      directory,
      ...value,
      risk: busFactor.risks.find((item) => item.directory === directory)?.risk ?? "healthy"
    }));
  }, [busFactor]);

  if (error !== null) {
    return (
      <div className="space-y-6">
        <RepoTabs repoId={params.id} active="contributors" />
        <Card><CardContent className="text-sm text-red-300">{error}</CardContent></Card>
      </div>
    );
  }

  if (contributors === null) {
    return <Skeleton className="h-96" />;
  }

  const health = busFactor === null ? "pending" : busFactor.overall <= 1 ? "critical" : busFactor.overall <= 2 ? "low" : "healthy";

  return (
    <div className="space-y-6">
      <RepoTabs repoId={params.id} active="contributors" />
      <Card>
        <CardHeader><CardTitle>Contributors</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <THead><TR><TH>Login</TH><TH>Commits</TH><TH>Lines Added</TH><TH>Lines Removed</TH><TH>Files Owned</TH></TR></THead>
            <TBody>
              {contributors.length === 0 ? (
                <TR><TD colSpan={5}>Contributor analytics require a GitHub token and a fresh repository sync.</TD></TR>
              ) : null}
              {contributors.map((contributor) => (
                <TR key={contributor.login}>
                  <TD>{contributor.login}</TD>
                  <TD>{contributor.commitCount}</TD>
                  <TD>{contributor.linesAdded}</TD>
                  <TD>{contributor.linesRemoved}</TD>
                  <TD>{contributor.ownedFilesCount}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Bus Factor</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <p className="text-5xl font-semibold">{busFactor?.overall ?? "-"}</p>
            <Badge tone={riskTone(health)}>{health}</Badge>
          </div>
          <Table>
            <THead><TR><TH>Directory</TH><TH>Bus Factor</TH><TH>Owners</TH><TH>Risk</TH></TR></THead>
            <TBody>
              {directoryRows.map((row) => (
                <TR key={row.directory}>
                  <TD>{row.directory}</TD>
                  <TD>{row.busFactor}</TD>
                  <TD>{row.owners.join(", ")}</TD>
                  <TD><Badge tone={riskTone(row.risk)}>{row.risk}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
