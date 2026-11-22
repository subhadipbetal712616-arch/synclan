"use client";

import { Badge } from "@/components/ui/badge";
import {
  HardDrive,
  MemoryStick,
  Printer,
  Clock,
  MonitorCheck,
  Network,
  Cpu,
  Thermometer,
  CircuitBoard,
  Keyboard,
  Mouse,
} from "lucide-react";
import { useAnimatedNumber } from "./use-animated-number";

export interface ClientNode {
  name: string;
  ip: string;
  status: "UP" | "STALE";
  age_sec: number;
  free_ram_mb: number;
  host?: string;
  mem_avail_mb?: number;
  ssd_root_percent?: number;
  ssd_root_used?: string;
  ssd_root_total?: string;
  printers?: string;
  ts?: number;
  iso_ts?: string;
  last_log?: string;
  // New-format fields
  cpu_usage_percent?: number;
  cpu_temp_c?: number;
  gpu_util_percent?: number;
  gpu_temp_c?: number;
  keyboard?: string;
  mouse?: string;
}

function ramColor(mb: number): string {
  if (mb < 100) return "text-rose-400";
  if (mb < 400) return "text-amber-400";
  return "text-emerald-400";
}

function ramBarColor(mb: number): string {
  if (mb < 100) return "bg-rose-500";
  if (mb < 400) return "bg-amber-500";
  return "bg-emerald-500";
}

function diskBarColor(p: number): string {
  if (p < 50) return "bg-emerald-500";
  if (p < 75) return "bg-amber-500";
  return "bg-rose-500";
}

function cpuUsageColor(p: number): string {
  if (p < 50) return "text-emerald-400";
  if (p < 80) return "text-amber-400";
  return "text-rose-400";
}

function cpuUsageBarColor(p: number): string {
  if (p < 50) return "bg-emerald-500";
  if (p < 80) return "bg-amber-500";
  return "bg-rose-500";
}

function tempColor(c: number): string {
  if (c < 60) return "text-emerald-400";
  if (c < 80) return "text-amber-400";
  return "text-rose-400";
}

function tempBarColor(c: number): string {
  if (c < 60) return "bg-emerald-500";
  if (c < 80) return "bg-amber-500";
  return "bg-rose-500";
}

interface MeterRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  suffix: string;
  decimals?: number;
  max: number;
  colorFn: (v: number) => string;
  barColorFn: (v: number) => string;
}

function MeterRow({
  icon: Icon,
  label,
  value,
  suffix,
  decimals = 0,
  max,
  colorFn,
  barColorFn,
}: MeterRowProps) {
  const animated = useAnimatedNumber(value);
  const display =
    decimals > 0 ? animated.toFixed(decimals) : Math.round(animated).toString();
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span className={`font-mono font-semibold tabular-nums ${colorFn(value)}`}>
          {display}{suffix}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColorFn(value)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function NodeCard({ node }: { node: ClientNode }) {
  const isUp = node.status === "UP";
  const animatedRam = useAnimatedNumber(node.free_ram_mb);
  const ramPct = Math.min(100, (node.free_ram_mb / 1500) * 100);
  const hasNewMetrics =
    node.cpu_usage_percent !== undefined ||
    node.cpu_temp_c !== undefined ||
    node.gpu_util_percent !== undefined;

  return (
    <div
      className={`group glass relative overflow-hidden rounded-xl p-4 ring-1 transition-all duration-300 hover:scale-[1.015] ${
        isUp
          ? "ring-emerald-500/20 hover:glow-emerald"
          : "ring-rose-500/20 hover:glow-rose"
      }`}
    >
      {/* Top accent line */}
      <div
        className={`absolute left-0 top-0 h-full w-1 ${
          isUp ? "bg-emerald-500" : "bg-rose-500"
        }`}
      />

      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2 pl-2">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              isUp ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
            }`}
          >
            <MonitorCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold leading-tight">
              {node.host || node.name}
            </div>
            <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
              <Network className="h-3 w-3" />
              {node.ip}
            </div>
          </div>
        </div>
        <Badge
          variant={isUp ? "default" : "destructive"}
          className={`shrink-0 border ${
            isUp
              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
              : "border-rose-500/30 bg-rose-500/15 text-rose-400"
          }`}
        >
          <span
            className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${
              isUp ? "animate-pulse bg-emerald-400" : "bg-rose-400"
            }`}
          />
          {node.status}
        </Badge>
      </div>

      {/* CPU + Temp + GPU (new-format only) */}
      {hasNewMetrics && (
        <div className="mb-2 pl-2">
          {node.cpu_usage_percent !== undefined && (
            <MeterRow
              icon={Cpu}
              label="CPU usage"
              value={node.cpu_usage_percent}
              suffix="%"
              max={100}
              colorFn={cpuUsageColor}
              barColorFn={cpuUsageBarColor}
            />
          )}
          {node.cpu_temp_c !== undefined && (
            <MeterRow
              icon={Thermometer}
              label="CPU temp"
              value={node.cpu_temp_c}
              suffix="°C"
              decimals={1}
              max={100}
              colorFn={tempColor}
              barColorFn={tempBarColor}
            />
          )}
          {node.gpu_util_percent !== undefined && (
            <MeterRow
              icon={CircuitBoard}
              label="GPU util"
              value={node.gpu_util_percent}
              suffix={node.gpu_temp_c !== undefined ? ` / ${Math.round(node.gpu_temp_c)}°C` : "%"}
              max={100}
              colorFn={cpuUsageColor}
              barColorFn={cpuUsageBarColor}
            />
          )}
        </div>
      )}

      {/* Free RAM (always shown) */}
      <div className="mb-2 pl-2">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <MemoryStick className="h-3.5 w-3.5" />
            Free RAM
          </span>
          <span className={`font-mono font-semibold tabular-nums ${ramColor(node.free_ram_mb)}`}>
            {Math.round(animatedRam)} MB
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className={`h-full rounded-full transition-all duration-700 ${ramBarColor(node.free_ram_mb)}`}
            style={{ width: `${ramPct}%` }}
          />
        </div>
      </div>

      {/* Disk (old-format only) */}
      {node.ssd_root_percent !== undefined && (
        <div className="mb-2 pl-2">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              <HardDrive className="h-3.5 w-3.5" />
              Disk
            </span>
            <span className="font-mono font-semibold tabular-nums">
              {node.ssd_root_percent}%
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({node.ssd_root_used}/{node.ssd_root_total})
              </span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className={`h-full rounded-full transition-all duration-700 ${diskBarColor(node.ssd_root_percent)}`}
              style={{ width: `${node.ssd_root_percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Input devices + Printers row */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-2 text-[11px]">
        {node.keyboard && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Keyboard className="h-3 w-3" />
            <span className={
              node.keyboard === "detected" ? "text-emerald-400" : "text-rose-400"
            }>
              {node.keyboard === "detected" ? "kbd" : "no kbd"}
            </span>
          </span>
        )}
        {node.mouse && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Mouse className="h-3 w-3" />
            <span className={
              node.mouse === "detected" ? "text-emerald-400" : "text-rose-400"
            }>
              {node.mouse === "detected" ? "mouse" : "no mouse"}
            </span>
          </span>
        )}
        {node.printers !== undefined && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Printer className="h-3 w-3" />
            {node.printers && node.printers !== "none" ? (
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">
                {node.printers}
              </span>
            ) : (
              <span className="text-muted-foreground/70">no printer</span>
            )}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 font-mono text-muted-foreground tabular-nums">
          <Clock className="h-3 w-3" />
          {node.age_sec}s
        </span>
      </div>

      {/* Raw log */}
      {node.last_log && (
        <div className="mt-2 overflow-hidden rounded-md bg-black/30 p-2 pl-3">
          <pre className="whitespace-pre-wrap break-all font-mono text-[9px] leading-relaxed text-muted-foreground/80">
            {node.last_log.replace(/\|/g, "\n")}
          </pre>
        </div>
      )}
    </div>
  );
}
