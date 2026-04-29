import { Badge } from "./ui/badge";
import type { RepoStatus } from "../lib/api";

export function StatusBadge({ status }: { status: RepoStatus }) {
  const tone =
    status === "ready"
      ? "green"
      : status === "failed"
        ? "red"
        : status === "indexing"
          ? "yellow"
          : "gray";

  return <Badge tone={tone}>{status}</Badge>;
}
