import { Tabs } from "./ui/tabs";

export function RepoTabs({ repoId, active }: { repoId: string; active: string }) {
  const base = `/repos/${repoId}`;
  return (
    <Tabs
      tabs={[
        { href: `${base}/search`, label: "Search", active: active === "search" },
        {
          href: `${base}/architecture`,
          label: "Architecture",
          active: active === "architecture"
        },
        { href: `${base}/prs`, label: "Pull Requests", active: active === "prs" },
        {
          href: `${base}/contributors`,
          label: "Contributors",
          active: active === "contributors"
        }
      ]}
    />
  );
}
