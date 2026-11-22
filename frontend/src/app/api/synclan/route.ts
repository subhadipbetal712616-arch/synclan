import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------- Types ----------
interface ClientNode {
  name: string;
  ip: string;
  status: "UP" | "STALE";
  age_sec: number;
  free_ram_mb: number;
  // Old-format optional fields (from sim_client.sh)
  host?: string;
  mem_avail_mb?: number;
  ssd_root_percent?: number;
  ssd_root_used?: string;
  ssd_root_total?: string;
  printers?: string;
  ts?: number;
  last_log?: string;
  // New-format fields (from synclan_client.sh)
  cpu_usage_percent?: number;
  cpu_temp_c?: number;
  gpu_util_percent?: number;
  gpu_temp_c?: number;
  keyboard?: string;
  mouse?: string;
  iso_ts?: string;
}

interface SyncLanSnapshot {
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

const PROC_PATH = "/proc/synclan_log";
const MAX_NODES = 32;

// ---------- Old-format helpers (sim_client.sh) ----------
// Line like: "host=Debian mem_avail=556MB ssd_root=37% (6.4G/19G) printers=none ts=1795244310"
function parseKeyValueLog(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of line.trim().split(/\s+/)) {
    const eq = tok.indexOf("=");
    if (eq > 0) {
      const k = tok.slice(0, eq);
      const v = tok.slice(eq + 1);
      out[k] = v;
    }
  }
  return out;
}

function parseDisk(s: string): { percent: number; used: string; total: string } {
  const m = s.match(/(\d+)%\s*\(([^/]+)\/([^)]+)\)/);
  if (!m) return { percent: 0, used: "?", total: "?" };
  return { percent: parseInt(m[1], 10), used: m[2], total: m[3] };
}

function parseMb(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d+)MB$/i);
  return m ? parseInt(m[1], 10) : undefined;
}

// ---------- New-format parser (synclan_client.sh) ----------
// Line like: "1795267441|2026-11-22T15:30:41+05:30|host=lab-pc-01|cpu_usage=23.4%|cpu_temp=52.0C|gpu(util=15% temp=45C)|keyboard=detected mouse=detected|mem_avail=612MB"
function parsePipeLog(line: string): Partial<ClientNode> {
  const parts = line.split("|");
  const out: Partial<ClientNode> = {};
  if (parts.length < 2) return out;

  // First field: epoch seconds
  const epoch = parseInt(parts[0], 10);
  if (!isNaN(epoch)) out.ts = epoch;

  // Second field: ISO timestamp
  if (parts[1]) out.iso_ts = parts[1];

  // Walk the remaining key=val parts
  for (let i = 2; i < parts.length; i++) {
    const p = parts[i];
    // gpu(util=15% temp=45C)
    const gpuMatch = p.match(/^gpu\(util=([\dn\/a]+)%?\s+temp=([\dn\/a.]+)C?\)$/i);
    if (gpuMatch) {
      const u = gpuMatch[1];
      const t = gpuMatch[2];
      if (u !== "n/a") out.gpu_util_percent = parseFloat(u);
      if (t !== "n/a") out.gpu_temp_c = parseFloat(t);
      continue;
    }
    // keyboard=detected mouse=detected
    const kmMatch = p.match(/^keyboard=(\S+)\s+mouse=(\S+)$/i);
    if (kmMatch) {
      out.keyboard = kmMatch[1];
      out.mouse = kmMatch[2];
      continue;
    }
    // Standard key=val
    const eq = p.indexOf("=");
    if (eq > 0) {
      const k = p.slice(0, eq);
      const v = p.slice(eq + 1);
      switch (k) {
        case "host":
          out.host = v;
          break;
        case "cpu_usage": {
          const m = v.match(/^([\d.]+)%?$/);
          if (m) out.cpu_usage_percent = parseFloat(m[1]);
          break;
        }
        case "cpu_temp": {
          const m = v.match(/^([\d.]+)C?$/i);
          if (m) out.cpu_temp_c = parseFloat(m[1]);
          break;
        }
        case "mem_avail":
          out.mem_avail_mb = parseMb(v);
          break;
      }
    }
  }
  return out;
}

// Decide which format a `last_log` body line is in, parse accordingly.
function parseLastLog(line: string): Partial<ClientNode> {
  if (!line) return {};
  const trimmed = line.trim();
  if (trimmed.includes("|")) return parsePipeLog(trimmed);
  if (trimmed.includes("=")) {
    const kv = parseKeyValueLog(trimmed);
    const out: Partial<ClientNode> = {
      host: kv.host,
      mem_avail_mb: parseMb(kv.mem_avail),
      printers: kv.printers,
    };
    if (kv.ts) out.ts = parseInt(kv.ts, 10);
    if (kv.ssd_root) {
      const d = parseDisk(kv.ssd_root);
      out.ssd_root_percent = d.percent;
      out.ssd_root_used = d.used;
      out.ssd_root_total = d.total;
    }
    return out;
  }
  return {};
}

// ---------- /proc/synclan_log parser ----------
function parseProc(raw: string): SyncLanSnapshot | null {
  const lines = raw.split("\n");

  // Accept both old and new headers:
  //   OLD: === SyncLAN Admin Aggregated Log (uptime=6522, clients=1/32) ===
  //   NEW: === SyncLAN Client Log (ts=1795267441, uptime=6522s, free_ram=72MB, nodes=1/32) ===
  const headerLine = lines.find(
    (l) =>
      l.startsWith("=== SyncLAN Admin Aggregated Log") ||
      l.startsWith("=== SyncLAN Client Log")
  );
  if (!headerLine) return null;

  const upMatch = headerLine.match(/uptime=(\d+)/);
  const clientsMatch = headerLine.match(/(?:clients|nodes)=(\d+)\/(\d+)/);
  const tsMatch = headerLine.match(/ts=(\d+)/);
  const freeRamMatch = headerLine.match(/free_ram=(\d+)MB/);

  const uptime_sec = upMatch ? parseInt(upMatch[1], 10) : 0;
  const total_nodes = clientsMatch ? parseInt(clientsMatch[1], 10) : 0;
  const max_nodes = clientsMatch ? parseInt(clientsMatch[2], 10) : MAX_NODES;
  const total_free_ram_mb_from_header = freeRamMatch
    ? parseInt(freeRamMatch[1], 10)
    : undefined;

  const nodes: ClientNode[] = [];

  // Per-node regex — unchanged in both formats:
  //   --- Client: name (ip) [UP, age=0s, free_ram=72MB] ---
  const re = /--- Client:\s*([^\s]+)\s+\(([^)]+)\)\s*\[([^,]+),\s*age=(\d+)s,\s*free_ram=(\d+)MB\]\s*---/;
  const blocks: { name: string; ip: string; status: string; age: number; free_ram: number; body: string }[] = [];
  let current: { name: string; ip: string; status: string; age: number; free_ram: number; body: string[] } | null = null;

  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      if (current) {
        blocks.push({ ...current, body: current.body.join("\n").trim() });
      }
      current = {
        name: m[1],
        ip: m[2],
        status: m[3],
        age: parseInt(m[4], 10),
        free_ram: parseInt(m[5], 10),
        body: [],
      };
    } else if (current && line.trim() !== "") {
      current.body.push(line);
    }
  }
  if (current) {
    blocks.push({ ...current, body: current.body.join("\n").trim() });
  }

  for (const b of blocks) {
    const node: ClientNode = {
      name: b.name,
      ip: b.ip,
      status: b.status === "UP" ? "UP" : "STALE",
      age_sec: b.age,
      free_ram_mb: b.free_ram,
      last_log: b.body,
    };

    // Parse the body (last_log) — supports both old and new format
    if (b.body) {
      // For the new pipe-delimited format, the body is a single line
      // For the old format, the body is also a single line of key=val tokens
      const bodyLine = b.body.split("\n")[0];
      Object.assign(node, parseLastLog(bodyLine));
    }

    nodes.push(node);
  }

  const nodes_up = nodes.filter((n) => n.status === "UP").length;
  const total_free_ram_mb =
    total_free_ram_mb_from_header ??
    nodes.reduce((s, n) => s + n.free_ram_mb, 0);

  return {
    mode: "admin",
    uptime_sec,
    total_nodes,
    max_nodes,
    nodes_up,
    nodes_stale: total_nodes - nodes_up,
    total_free_ram_mb,
    captured_at: tsMatch ? parseInt(tsMatch[1], 10) * 1000 : Date.now(),
    source: "proc",
    nodes,
  };
}

// ---------- Demo mode ----------
const DEMO_NODE_SEEDS: {
  name: string;
  ip: string;
  baseRam: number;
  cpu: number;
  cpuTemp: number;
  gpu: number;
  gpuTemp: number;
  disk: number;
  printers: string;
  hasGpu: boolean;
  hasInput: boolean;
}[] = [
  { name: "admin-host", ip: "127.0.0.1", baseRam: 128, cpu: 18, cpuTemp: 48, gpu: 5, gpuTemp: 42, disk: 37, printers: "HP-LaserJet-pro", hasGpu: true, hasInput: true },
  { name: "lab-pc-01", ip: "192.168.1.21", baseRam: 612, cpu: 34, cpuTemp: 56, gpu: 22, gpuTemp: 51, disk: 58, printers: "none", hasGpu: true, hasInput: true },
  { name: "lab-pc-02", ip: "192.168.1.22", baseRam: 488, cpu: 67, cpuTemp: 72, gpu: 78, gpuTemp: 68, disk: 71, printers: "Epson-L3210", hasGpu: true, hasInput: true },
  { name: "lab-pc-03", ip: "192.168.1.23", baseRam: 980, cpu: 8, cpuTemp: 44, gpu: 0, gpuTemp: 0, disk: 22, printers: "none", hasGpu: false, hasInput: true },
  { name: "raspi-01", ip: "192.168.1.31", baseRam: 240, cpu: 42, cpuTemp: 58, gpu: 12, gpuTemp: 55, disk: 64, printers: "none", hasGpu: true, hasInput: false },
  { name: "build-srv", ip: "192.168.1.40", baseRam: 1536, cpu: 88, cpuTemp: 81, gpu: 95, gpuTemp: 76, disk: 84, printers: "Canon-MF301", hasGpu: true, hasInput: false },
];

function demoSnapshot(): SyncLanSnapshot {
  const t = Date.now();
  const tsec = Math.floor(t / 1000);
  const iso = new Date(t).toISOString();

  const nodes: ClientNode[] = DEMO_NODE_SEEDS.map((s, i) => {
    const osc = Math.sin(tsec / 30 + i * 1.7);
    const jitter = (Math.sin(tsec * 0.7 + i) * 0.5 + 0.5) * 60;
    const freeRam = Math.max(8, Math.round(s.baseRam + osc * 80 + jitter - 30));
    const cpu = Math.min(99, Math.max(2, Math.round(s.cpu + Math.sin(tsec / 20 + i) * 12)));
    const cpuTemp = Math.min(95, Math.max(35, Math.round(s.cpuTemp + Math.sin(tsec / 25 + i) * 4)));
    const gpuUtil = s.hasGpu ? Math.min(99, Math.max(0, Math.round(s.gpu + Math.sin(tsec / 18 + i) * 15))) : undefined;
    const gpuTemp = s.hasGpu ? Math.min(90, Math.max(35, Math.round(s.gpuTemp + Math.sin(tsec / 30 + i) * 4))) : undefined;
    const disk = Math.min(99, Math.max(5, Math.round(s.disk + Math.sin(tsec / 90 + i) * 3)));

    // Make one node occasionally go stale so judges see red state
    const staleCycle = Math.floor(tsec / 45) % 6;
    const isStale = i === staleCycle && (tsec % 45) > 35;
    const age = isStale ? 30 + ((tsec + i * 7) % 20) : (tsec + i * 3) % 10;

    const gpuStr = s.hasGpu
      ? `util=${gpuUtil}% temp=${gpuTemp}C`
      : `util=n/a temp=n/a`;
    const kmStr = s.hasInput
      ? `keyboard=detected mouse=detected`
      : `keyboard=not_detected mouse=not_detected`;
    const lastLog = `${tsec}|${iso}|host=${s.name}|cpu_usage=${cpu}%|cpu_temp=${cpuTemp}C|gpu(${gpuStr})|${kmStr}|mem_avail=${freeRam + 40}MB`;

    return {
      name: s.name,
      ip: s.ip,
      status: isStale ? "STALE" : "UP",
      age_sec: age,
      free_ram_mb: freeRam,
      // New-format fields
      host: s.name,
      mem_avail_mb: freeRam + 40,
      cpu_usage_percent: cpu,
      cpu_temp_c: cpuTemp,
      gpu_util_percent: gpuUtil,
      gpu_temp_c: gpuTemp,
      keyboard: s.hasInput ? "detected" : "not_detected",
      mouse: s.hasInput ? "detected" : "not_detected",
      iso_ts: iso,
      ts: tsec,
      last_log: lastLog,
    };
  });

  return {
    mode: "demo",
    uptime_sec: tsec - 1795240000,
    total_nodes: nodes.length,
    max_nodes: MAX_NODES,
    nodes_up: nodes.filter((n) => n.status === "UP").length,
    nodes_stale: nodes.filter((n) => n.status === "STALE").length,
    total_free_ram_mb: nodes.reduce((s, n) => s + n.free_ram_mb, 0),
    captured_at: t,
    source: "demo",
    nodes,
  };
}

export async function GET() {
  try {
    if (existsSync(PROC_PATH)) {
      const raw = readFileSync(PROC_PATH, "utf-8");
      const snap = parseProc(raw);
      if (snap) {
        return NextResponse.json(snap, {
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
  } catch {
    // fall through to demo
  }

  const snap = demoSnapshot();
  return NextResponse.json(snap, {
    headers: { "Cache-Control": "no-store" },
  });
}
