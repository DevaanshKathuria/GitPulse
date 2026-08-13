"use client";

import { Fragment, useEffect, useState } from "react";
import {
  api,
  type PullRequestIntelligence,
  type PullRequestSummary
} from "../../../../lib/api";
import { RepoTabs } from "../../../../components/repo-tabs";
import { Badge } from "../../../../components/ui/badge";
import { Card, CardContent } from "../../../../components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "../../../../components/ui/table";
import { Skeleton } from "../../../../components/ui/skeleton";

const riskTone = (score: number | null): "green" | "yellow" | "red" | "gray" => {
  if (score === null) return "gray";
  if (score < 30) return "green";
  if (score < 70) return "yellow";
  return "red";
};

export default function PullRequestsPage({ params }: { params: { id: string } }) {
  const [prs, setPrs] = useState<PullRequestSummary[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, PullRequestIntelligence | string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .pullRequests(params.id)
      .then((response) => {
        if (active) setPrs(response.items);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load pull requests"
          );
        }
      });

    return () => {
      active = false;
    };
  }, [params.id]);

  if (error !== null) {
    return (
      <div className="space-y-6">
        <RepoTabs repoId={params.id} active="prs" />
        <Card><CardContent className="text-sm text-red-300">{error}</CardContent></Card>
      </div>
    );
  }

  if (prs === null) {
    return <Skeleton className="h-96" />;
  }

  const toggle = async (pr: PullRequestSummary) => {
    if (expanded === pr.id) {
      setExpanded(null);
      return;
    }

    setExpanded(pr.id);
    if (details[pr.id] !== undefined) {
      return;
    }

    try {
      const response = await api.pullRequestIntelligence(params.id, pr.id);
      setDetails((current) => ({
        ...current,
        [pr.id]: "metadata" in response ? response : response.message
      }));
    } catch (requestError: unknown) {
      setDetails((current) => ({
        ...current,
        [pr.id]:
          requestError instanceof Error
            ? requestError.message
            : "Unable to load PR intelligence"
      }));
    }
  };

  return (
    <div className="space-y-6">
      <RepoTabs repoId={params.id} active="prs" />
      <Card>
        <CardContent className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>PR</TH><TH>Title</TH><TH>Author</TH><TH>Status</TH><TH>Risk</TH><TH>Breaking</TH>
              </TR>
            </THead>
            <TBody>
              {prs.length === 0 ? (
                <TR><TD colSpan={6}>No pull requests were ingested for this repository.</TD></TR>
              ) : null}
              {prs.map((pr) => (
                <Fragment key={pr.id}>
                  <TR className="cursor-pointer hover:bg-slate-900" onClick={() => void toggle(pr)}>
                    <TD>#{pr.number}</TD>
                    <TD className="min-w-72">{pr.title}</TD>
                    <TD>{pr.author}</TD>
                    <TD><Badge>{pr.status}</Badge></TD>
                    <TD><Badge tone={riskTone(pr.riskScore)}>{pr.riskScore ?? "pending"}</Badge></TD>
                    <TD>{pr.breakingChanges.length}</TD>
                  </TR>
                  {expanded === pr.id ? (
                    <TR key={`${pr.id}-details`}>
                      <TD colSpan={6}>
                        <PullRequestDetails
                          detail={details[pr.id]}
                          fallbackSummary={pr.summary}
                          breakingChanges={pr.breakingChanges}
                        />
                      </TD>
                    </TR>
                  ) : null}
                </Fragment>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PullRequestDetails({
  detail,
  fallbackSummary,
  breakingChanges
}: {
  detail: PullRequestIntelligence | string | undefined;
  fallbackSummary: string | null;
  breakingChanges: unknown[];
}) {
  const message =
    typeof detail === "string"
      ? detail
      : detail?.summary ?? fallbackSummary ?? "Loading analysis...";
  const metadata =
    typeof detail === "object" && detail !== null
      ? detail.metadata
      : typeof detail === "string"
        ? { message: detail }
        : { breakingChanges };

  return (
    <div className="space-y-3 rounded-md bg-slate-950 p-4">
      <p className="text-sm text-slate-300">{message}</p>
      <pre className="overflow-auto rounded-md bg-black/40 p-3 text-xs text-slate-400">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </div>
  );
}
