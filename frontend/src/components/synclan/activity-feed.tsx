"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, ArrowDown, CircleDot } from "lucide-react";

export interface ActivityEvent {
  id: string;
  ts: number;
  kind: "join" | "leave" | "log" | "info";
  node?: string;
  message: string;
}

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  };

  const iconFor = (kind: ActivityEvent["kind"]) => {
    if (kind === "join")
      return <ArrowDown className="h-3 w-3 text-emerald-400" />;
    if (kind === "leave")
      return <ArrowUp className="h-3 w-3 text-rose-400" />;
    return <CircleDot className="h-3 w-3 text-cyan-300" />;
  };

  return (
    <div
      ref={scrollRef}
      className="scroll-slim h-[260px] overflow-y-auto rounded-lg bg-black/30 p-3 font-mono text-[11px]"
    >
      {events.length === 0 ? (
        <div className="text-muted-foreground/60">Waiting for events…</div>
      ) : (
        <ul className="space-y-1.5">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-muted-foreground/60">
                {fmtTime(e.ts)}
              </span>
              <span className="mt-0.5 shrink-0">{iconFor(e.kind)}</span>
              <span className="break-all text-foreground/80">
                {e.node && (
                  <span className="text-emerald-400">{e.node} </span>
                )}
                {e.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
