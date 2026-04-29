"use client";

import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import { useEffect, useMemo, useState } from "react";
import { api, type ArchitectureGraph } from "../../../../lib/api";
import { RepoTabs } from "../../../../components/repo-tabs";
import { Badge } from "../../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";

const filename = (path: string): string => path.split("/").pop() ?? path;

export default function ArchitecturePage({ params }: { params: { id: string } }) {
  const [graph, setGraph] = useState<ArchitectureGraph | null>(null);

  useEffect(() => {
    void api.architecture(params.id).then(setGraph);
  }, [params.id]);

  const circularFiles = useMemo(() => new Set(graph?.circularDependencies.flat() ?? []), [graph]);
  const unusedFiles = useMemo(() => new Set(graph?.unusedFiles ?? []), [graph]);

  const flow = useMemo((): { nodes: Node[]; edges: Edge[] } => {
    if (graph === null) {
      return { nodes: [], edges: [] };
    }

    return {
      nodes: graph.nodes.map((node, index) => {
        const isCircular = circularFiles.has(node.path);
        const isUnused = unusedFiles.has(node.path);
        return {
          id: node.path,
          position: { x: (index % 5) * 210, y: Math.floor(index / 5) * 110 },
          data: { label: filename(node.path) },
          style: {
            border: `1px solid ${isCircular ? "#ef4444" : isUnused ? "#64748b" : "#38bdf8"}`,
            background: isCircular ? "#3f1218" : isUnused ? "#111827" : "#0f172a",
            color: "#e5e7eb",
            fontSize: 12,
            width: 170
          }
        };
      }),
      edges: graph.edges.map((edge, index) => ({
        id: `${edge.from}-${edge.to}-${index}`,
        source: edge.from,
        target: edge.to,
        label: edge.type,
        animated: circularFiles.has(edge.from) && circularFiles.has(edge.to)
      }))
    };
  }, [circularFiles, graph, unusedFiles]);

  if (graph === null) {
    return <Skeleton className="h-[620px]" />;
  }

  return (
    <div className="space-y-6">
      <RepoTabs repoId={params.id} active="architecture" />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="h-[650px] overflow-hidden">
          <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView>
            <Background />
            <Controls />
          </ReactFlow>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Stats</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <p>Total files<br /><span className="text-xl text-slate-100">{graph.stats.totalFiles}</span></p>
              <p>Total edges<br /><span className="text-xl text-slate-100">{graph.stats.totalEdges}</span></p>
              <p>Circular<br /><span className="text-xl text-red-300">{graph.stats.circularCount}</span></p>
              <p>Unused<br /><span className="text-xl text-slate-300">{graph.stats.unusedCount}</span></p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Circular Dependencies</CardTitle></CardHeader>
            <CardContent>
              <details open>
                <summary className="cursor-pointer text-sm text-slate-300">Show cycles</summary>
                <div className="mt-3 space-y-2">
                  {graph.circularDependencies.length === 0 ? <Badge>None</Badge> : graph.circularDependencies.map((cycle, index) => (
                    <p key={index} className="text-xs text-red-200">{cycle.join(" -> ")}</p>
                  ))}
                </div>
              </details>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Unused Files</CardTitle></CardHeader>
            <CardContent>
              <details>
                <summary className="cursor-pointer text-sm text-slate-300">Show files</summary>
                <div className="mt-3 max-h-56 space-y-1 overflow-auto">
                  {graph.unusedFiles.map((file) => <p key={file} className="text-xs text-slate-400">{file}</p>)}
                </div>
              </details>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
