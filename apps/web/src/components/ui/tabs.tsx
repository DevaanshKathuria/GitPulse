import Link from "next/link";
import { cn } from "../../lib/utils";

export interface TabLink {
  href: string;
  label: string;
  active?: boolean;
}

export function Tabs({ tabs }: { tabs: TabLink[] }) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-slate-800">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "border-b-2 px-3 py-2 text-sm transition",
            tab.active
              ? "border-sky-400 text-sky-200"
              : "border-transparent text-slate-400 hover:text-slate-100"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
