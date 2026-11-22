"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useAnimatedNumber } from "./use-animated-number";

export interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
  sub?: string;
  accent: "emerald" | "amber" | "rose" | "cyan" | "violet";
}

const ACCENTS: Record<
  StatCardProps["accent"],
  { text: string; ring: string; glow: string; bg: string; icon: string }
> = {
  emerald: {
    text: "text-emerald-400",
    ring: "ring-emerald-500/20",
    glow: "glow-emerald",
    bg: "bg-emerald-500/10",
    icon: "text-emerald-400",
  },
  amber: {
    text: "text-amber-400",
    ring: "ring-amber-500/20",
    glow: "glow-amber",
    bg: "bg-amber-500/10",
    icon: "text-amber-400",
  },
  rose: {
    text: "text-rose-400",
    ring: "ring-rose-500/20",
    glow: "glow-rose",
    bg: "bg-rose-500/10",
    icon: "text-rose-400",
  },
  cyan: {
    text: "text-cyan-300",
    ring: "ring-cyan-400/20",
    glow: "shadow-[0_0_24px_-4px_oklch(0.72_0.13_180/0.4)]",
    bg: "bg-cyan-500/10",
    icon: "text-cyan-300",
  },
  violet: {
    text: "text-fuchsia-300",
    ring: "ring-fuchsia-400/20",
    glow: "shadow-[0_0_24px_-4px_oklch(0.65_0.18_300/0.4)]",
    bg: "bg-fuchsia-500/10",
    icon: "text-fuchsia-300",
  },
};

export function StatCard({
  icon: Icon,
  label,
  value,
  suffix,
  decimals = 0,
  sub,
  accent,
}: StatCardProps) {
  const animated = useAnimatedNumber(value);
  const a = ACCENTS[accent];
  const display =
    decimals > 0
      ? animated.toFixed(decimals)
      : Math.round(animated).toLocaleString();

  return (
    <div
      className={`glass relative overflow-hidden rounded-xl p-5 ring-1 ${a.ring} transition-transform hover:scale-[1.02]`}
    >
      {/* corner glow */}
      <div
        className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full ${a.bg} blur-2xl`}
      />
      <div className="relative flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className={`text-3xl font-bold tabular-nums sm:text-4xl ${a.text}`}>
              {display}
            </span>
            {suffix && (
              <span className="text-sm font-medium text-muted-foreground">
                {suffix}
              </span>
            )}
          </div>
          {sub && (
            <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>
          )}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${a.bg} ${a.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
