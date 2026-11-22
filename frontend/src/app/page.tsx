"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { toPng } from "html-to-image";
import {
  Activity,
  Server,
  Wifi,
  CircleDot,
  MemoryStick,
  Clock,
  RefreshCw,
  Radio,
  Cpu,
  Terminal,
  Layers,
  AlertCircle,
  Camera,
  Check,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { StatCard } from "@/components/synclan/stat-card";
import { NodeCard, type ClientNode } from "@/components/synclan/node-card";
import { TopologyDiagram } from "@/components/synclan/topology-diagram";
import { ActivityFeed, type ActivityEvent } from "@/components/synclan/activity-feed";

interface Snapshot {
  mode: "admin" | "client" | "demo";
  uptime_sec: number;
  total_nodes: number;
  max_nodes: number;
  nodes_up: number;
  nodes_stale: number;
  total_free_ram_mb: number;
  captured_at: number;
  source: "proc" | "demo";
  nodes: ClientNode[];
}

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function useClock(): Date | null {
  // Returns null on the first render (SSR + first client render) to avoid
  // hydration mismatch. The first client render returns null too (same as SSR),
  // then the effect kicks in and starts ticking.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // Tick immediately on mount, then once per second.
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function Home() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<
    { t: string; ram: number; up: number; total: number }[]
  >([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [justCaptured, setJustCaptured] = useState(false);
  const prevNodeNamesRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const now = useClock();
  const { toast } = useToast();

  const handleScreenshot = useCallback(async () => {
    if (!captureRef.current || capturing) return;
    setCapturing(true);
    try {
      // Temporarily pause auto-refresh so the dashboard doesn't change mid-capture
      const wasAuto = autoRefresh;
      if (wasAuto) setAutoRefresh(false);
      // Let the UI settle
      await new Promise((r) => setTimeout(r, 150));
      const dataUrl = await toPng(captureRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#0b0e14",
        style: { transform: "none" },
      });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `synclan-dashboard-${ts}.png`;
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (wasAuto) setAutoRefresh(true);
      setJustCaptured(true);
      setTimeout(() => setJustCaptured(false), 1800);
      toast({
        title: "Screenshot saved",
        description: filename,
      });
    } catch (e) {
      toast({
        title: "Screenshot failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setCapturing(false);
    }
  }, [autoRefresh, capturing, toast]);

  const fetchSnap = useCallback(async () => {
    try {
      const r = await fetch("/api/synclan", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: Snapshot = await r.json();
      setSnap(data);
      setError(null);

      // Build activity events from node transitions
      const currentNames = new Set(data.nodes.map((n) => n.host || n.name));
      const prev = prevNodeNamesRef.current;
      const newEvents: ActivityEvent[] = [];
      const t = Date.now();

      for (const n of data.nodes) {
        const name = n.host || n.name;
        if (!prev.has(name)) {
          newEvents.push({
            id: `${name}-join-${t}`,
            ts: t,
            kind: "join",
            node: name,
            message: `connected (${n.ip}) — free RAM ${n.free_ram_mb}MB`,
          });
        }
        if (n.status === "STALE") {
          // Don't spam: only log if last_seen is fresh (within 60s)
          if (n.age_sec < 35) {
            newEvents.push({
              id: `${name}-stale-${t}`,
              ts: t,
              kind: "leave",
              node: name,
              message: `went STALE (no heartbeat for ${n.age_sec}s)`,
            });
          }
        }
      }
      // Log a heartbeat line every fetch (lite)
      if (data.nodes.length > 0 && newEvents.length === 0) {
        // Pick a random-ish node to show a heartbeat
        const sample = data.nodes[0];
        newEvents.push({
          id: `hb-${t}`,
          ts: t,
          kind: "log",
          node: sample.host || sample.name,
          message: `heartbeat — free RAM ${sample.free_ram_mb}MB`,
        });
      }

      if (newEvents.length > 0) {
        setEvents((prev) => [...prev, ...newEvents].slice(-50));
      }
      prevNodeNamesRef.current = currentNames;

      // Push chart history — use a fresh Date here so the label is captured at
      // fetch time, not bound to the React `now` state (which avoids hydration issues)
      const labelNow = new Date();
      const label = `${String(labelNow.getHours()).padStart(2, "0")}:${String(
        labelNow.getMinutes()
      ).padStart(2, "0")}:${String(labelNow.getSeconds()).padStart(2, "0")}`;
      setHistory((h) => {
        const next = [
          ...h,
          {
            t: label,
            ram: data.total_free_ram_mb,
            up: data.nodes_up,
            total: data.total_nodes,
          },
        ];
        return next.slice(-40);
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnap();
  }, [fetchSnap]);

  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(fetchSnap, 2000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, fetchSnap]);

  const isDemo = snap?.source === "demo";

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 rounded-xl bg-emerald-500/30 blur-md" />
              <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-400 text-black">
                <Activity className="h-5 w-5" />
              </div>
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight sm:text-lg">
                Sync<span className="text-gradient-emerald">LAN</span>
              </h1>
              <p className="text-[11px] text-muted-foreground">
                Kernel-module LAN PC monitoring
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Live clock — render placeholder on SSR to avoid hydration mismatch */}
            <div className="hidden items-center gap-1.5 rounded-md border border-white/5 bg-white/5 px-2.5 py-1.5 font-mono text-xs tabular-nums text-muted-foreground sm:flex">
              <Clock className="h-3 w-3" />
              {now ? now.toLocaleTimeString() : "--:--:--"}
            </div>

            {snap && (
              <Badge
                variant="outline"
                className={
                  isDemo
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                }
              >
                <span
                  className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${
                    isDemo ? "bg-amber-400" : "animate-pulse bg-emerald-400"
                  }`}
                />
                {isDemo ? "DEMO MODE" : "LIVE"}
              </Badge>
            )}

            <Button
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
              className={
                autoRefresh
                  ? "bg-emerald-500 text-black hover:bg-emerald-400"
                  : ""
              }
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${autoRefresh ? "animate-spin" : ""}`}
              />
              <span className="ml-1 hidden sm:inline">
                {autoRefresh ? "Auto 2s" : "Paused"}
              </span>
            </Button>

            {/* Screenshot button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleScreenshot}
              disabled={capturing || !snap}
              className="border-white/10 bg-white/5 hover:bg-white/10"
            >
              {justCaptured ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Camera
                  className={`h-3.5 w-3.5 ${capturing ? "animate-pulse text-amber-400" : ""}`}
                />
              )}
              <span className="ml-1 hidden sm:inline">
                {capturing ? "Capturing…" : justCaptured ? "Saved" : "Screenshot"}
              </span>
            </Button>
          </div>
        </div>
      </header>

      <main ref={captureRef} className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {loading && !snap ? (
          <div className="flex h-64 items-center justify-center">
            <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
          </div>
        ) : error ? (
          <div className="glass glow-rose rounded-xl p-6 text-rose-400">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-5 w-5" />
              Error
            </div>
            <p className="mt-2 font-mono text-sm text-foreground/80">{error}</p>
          </div>
        ) : snap ? (
          <div className="space-y-6">
            {/* Hero / stat row */}
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard
                icon={Server}
                label="Total Nodes"
                value={snap.total_nodes}
                sub={`of ${snap.max_nodes} max`}
                accent="cyan"
              />
              <StatCard
                icon={Wifi}
                label="Nodes UP"
                value={snap.nodes_up}
                sub={`${((snap.nodes_up / Math.max(snap.total_nodes, 1)) * 100).toFixed(0)}% online`}
                accent="emerald"
              />
              <StatCard
                icon={CircleDot}
                label="Nodes STALE"
                value={snap.nodes_stale}
                sub="> 30s no heartbeat"
                accent={snap.nodes_stale > 0 ? "rose" : "cyan"}
              />
              <StatCard
                icon={MemoryStick}
                label="Total Free RAM"
                value={
                  snap.total_free_ram_mb >= 1024
                    ? snap.total_free_ram_mb / 1024
                    : snap.total_free_ram_mb
                }
                suffix={snap.total_free_ram_mb >= 1024 ? "GB" : "MB"}
                decimals={snap.total_free_ram_mb >= 1024 ? 2 : 0}
                sub="across the LAN"
                accent="violet"
              />
              <StatCard
                icon={Clock}
                label="Uptime"
                value={snap.uptime_sec}
                suffix="s"
                sub={formatUptime(snap.uptime_sec)}
                accent="amber"
              />
            </section>

            {/* Chart + Topology */}
            <section className="grid gap-4 lg:grid-cols-5">
              {/* Chart */}
              <div className="glass relative overflow-hidden rounded-xl p-5 lg:col-span-3">
                <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl" />
                <div className="relative mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <MemoryStick className="h-4 w-4 text-cyan-300" />
                      LAN Free RAM Trend
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Aggregated free RAM across all nodes — last ~80s, polling every 2s
                    </p>
                  </div>
                  <Badge variant="outline" className="border-white/10 bg-white/5 font-mono text-xs">
                    {snap.total_free_ram_mb} MB now
                  </Badge>
                </div>
                <div className="relative h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={history}
                      margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="ramGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor="oklch(0.78 0.18 160)"
                            stopOpacity={0.5}
                          />
                          <stop
                            offset="100%"
                            stopColor="oklch(0.78 0.18 160)"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="oklch(1 0 0 / 0.06)"
                      />
                      <XAxis
                        dataKey="t"
                        tick={{ fontSize: 9, fill: "oklch(0.6 0.01 220)" }}
                        stroke="oklch(1 0 0 / 0.08)"
                        interval="preserveStartEnd"
                        minTickGap={40}
                      />
                      <YAxis
                        tick={{ fontSize: 9, fill: "oklch(0.6 0.01 220)" }}
                        stroke="oklch(1 0 0 / 0.08)"
                        width={45}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: "oklch(0.15 0.01 250)",
                          border: "1px solid oklch(0.78 0.18 160 / 0.3)",
                          borderRadius: "8px",
                          fontSize: "11px",
                          fontFamily: "monospace",
                        }}
                        labelStyle={{ color: "oklch(0.7 0.01 220)" }}
                        itemStyle={{ color: "oklch(0.85 0.18 160)" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="ram"
                        name="Free RAM (MB)"
                        stroke="oklch(0.78 0.18 160)"
                        strokeWidth={2}
                        fill="url(#ramGrad)"
                        isAnimationActive={false}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Topology */}
              <div className="glass relative overflow-hidden rounded-xl p-5 lg:col-span-2">
                <div className="pointer-events-none absolute -left-16 -top-16 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl" />
                <div className="relative mb-2 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Radio className="h-4 w-4 text-emerald-400" />
                    Network Topology
                  </h2>
                  <Badge variant="outline" className="border-white/10 bg-white/5 font-mono text-[10px]">
                    UDP :8889
                  </Badge>
                </div>
                <TopologyDiagram nodes={snap.nodes} />
              </div>
            </section>

            {/* Architecture strip */}
            <section className="glass grid-bg rounded-xl p-5">
              <div className="mb-4 flex items-center gap-2">
                <Layers className="h-4 w-4 text-cyan-300" />
                <h2 className="text-sm font-semibold">How SyncLAN Works</h2>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
                <ArchStep
                  icon={Server}
                  title="Client PC"
                  desc="Kernel module reads free RAM via si_meminfo()"
                  color="bg-emerald-500/15 text-emerald-400 ring-emerald-500/20"
                />
                <ArchArrow />
                <ArchStep
                  icon={Radio}
                  title="UDP :8889"
                  desc="Log pushed every 10s"
                  color="bg-amber-500/15 text-amber-400 ring-amber-500/20"
                />
                <ArchArrow />
                <ArchStep
                  icon={Cpu}
                  title="Admin Node"
                  desc="Aggregates all clients"
                  color="bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-400/20"
                />
                <ArchArrow />
                <ArchStep
                  icon={Terminal}
                  title="/proc/synclan_log"
                  desc="This dashboard reads it"
                  color="bg-cyan-500/15 text-cyan-300 ring-cyan-400/20"
                />
              </div>
            </section>

            {/* Node grid + Activity feed */}
            <section className="grid gap-4 lg:grid-cols-4">
              <div className="lg:col-span-3">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Connected PCs
                  </h2>
                  <span className="font-mono text-xs text-muted-foreground">
                    {snap.nodes_up} up · {snap.nodes_stale} stale
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {snap.nodes.map((n) => (
                    <NodeCard key={`${n.ip}-${n.name}`} node={n} />
                  ))}
                </div>
              </div>

              {/* Activity feed */}
              <div className="lg:col-span-1">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    <Activity className="h-4 w-4" />
                    Live Feed
                  </h2>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {events.length} events
                  </span>
                </div>
                <ActivityFeed events={events} />
              </div>
            </section>

            {/* Demo notice */}
            {isDemo && (
              <div className="glass rounded-xl border-l-2 border-amber-500/40 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <div className="text-sm">
                    <p className="font-semibold text-amber-400">Demo mode is active</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <code className="rounded bg-white/5 px-1 py-0.5 font-mono">/proc/synclan_log</code> was
                      not found on this host. When your sir wires this frontend to your real backend, the
                      dashboard will read live data from the kernel module and switch the badge from{" "}
                      <span className="text-amber-400">DEMO</span> to{" "}
                      <span className="text-emerald-400">LIVE</span>.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </main>

      <footer className="mt-auto border-t border-white/5 bg-background/50 py-4 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 text-center text-[11px] text-muted-foreground sm:px-6">
          SyncLAN · Kernel module telemetry · UDP-based LAN PC status · Built for hackathon demo
        </div>
      </footer>
    </div>
  );
}

function ArchStep({
  icon: Icon,
  title,
  desc,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-full ring-1 ${color}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-xs font-semibold">{title}</div>
      <div className="max-w-[110px] text-[10px] text-muted-foreground">
        {desc}
      </div>
    </div>
  );
}

function ArchArrow() {
  return (
    <div className="flex items-center text-muted-foreground/60">
      <svg width="20" height="10" viewBox="0 0 20 10">
        <line
          x1="0"
          y1="5"
          x2="14"
          y2="5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        >
          <animate
            attributeName="stroke-dashoffset"
            from="6"
            to="0"
            dur="0.6s"
            repeatCount="indefinite"
          />
        </line>
        <polygon points="14,1 18,5 14,9" fill="currentColor" />
      </svg>
    </div>
  );
}
