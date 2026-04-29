import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type Tone = "blue" | "green" | "yellow" | "red" | "gray" | "orange";

const tones: Record<Tone, string> = {
  blue: "border-sky-400/40 bg-sky-400/10 text-sky-200",
  green: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  yellow: "border-yellow-400/40 bg-yellow-400/10 text-yellow-200",
  red: "border-red-400/40 bg-red-400/10 text-red-200",
  gray: "border-slate-600 bg-slate-800 text-slate-300",
  orange: "border-orange-400/40 bg-orange-400/10 text-orange-200"
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = "gray", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
