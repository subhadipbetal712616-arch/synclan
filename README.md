# SyncLAN

**Real-time LAN PC monitoring powered by a Linux kernel module + modern web dashboard.**

SyncLAN lets one admin PC collect and visualize the live status of every PC on the LAN — free RAM, CPU usage, CPU temperature, GPU utilisation/temperature, keyboard/mouse detection, and heartbeat age. The kernel module on each client reads system stats and ships them over UDP to the admin node, which exposes the aggregated view through `/proc/synclan_log`. A Next.js dashboard reads that file and renders it as a beautiful live UI.

```
┌────────────┐    UDP :8889     ┌────────────┐    /proc       ┌─────────────┐
│  Client PC │ ───────────────▶ │ Admin Node │ ─────────────▶ │  Dashboard  │
│  (kernel   │   (every 10s,   │  (kernel   │  synclan_log   │  (Next.js)  │
│   module + │    log push)    │   module)  │                │             │
│  health    │                  └────────────┘                └─────────────┘
│   agent)   │                         ▲                              │
└────────────┘                         │                              │
       └────── UDP :8888 ──────────────┘                              │
              heartbeat (every                              browser polls
              refresh_cycle)                                /api/synclan
```

---

## Repository structure

```
synclan/
├── backend/                    # Linux kernel module (C) + userspace health agent
│   ├── SYNCLAN_KMODULE.c       # Kernel module source
│   ├── Makefile                 # kbuild Makefile
│   ├── synclan_client.sh        # Userspace health agent (CPU/GPU/temp/input)
│   ├── README.md                # Backend deployment guide
│   └── LICENSE                  # GPL v3
│
├── frontend/                    # Next.js 16 web dashboard (TypeScript)
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx              # Main dashboard UI
│   │   │   ├── api/synclan/route.ts  # Parses /proc/synclan_log → JSON
│   │   │   ├── layout.tsx
│   │   │   └── globals.css           # Dark theme + glassmorphism utilities
│   │   └── components/
│   │       ├── synclan/              # Dashboard components
│   │       │   ├── stat-card.tsx          # Animated count-up stat cards
│   │       │   ├── node-card.tsx          # Per-PC status card
│   │       │   ├── topology-diagram.tsx   # SVG network topology
│   │       │   ├── activity-feed.tsx       # Live event log
│   │       │   └── use-animated-number.ts # Count-up hook
│   │       └── ui/                   # shadcn/ui primitives
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   └── tsconfig.json
│
├── README.md                   # You are here
├── CONNECTION.md               # How to wire frontend ↔ backend
├── LICENSE                     # GPL v3
└── .gitignore
```

---

## Tech stack

**Backend (kernel module + health agent)**
- Linux kernel module (C) — UDP sockets, `/proc` filesystem, `si_meminfo()` for free RAM
- `kthread` + `delayed_work` for periodic log shipping
- Module params: `role_admin`, `local_ip`, `server_port` (8888), `log_send_port` (8889), `log_target_ip`
- `synclan_client.sh` — userspace health agent that collects:
  - **CPU usage** from `/proc/stat`
  - **CPU temperature** from `sensors` or `/sys/class/thermal/`
  - **GPU utilisation + temperature** via `nvidia-smi` or AMD DRM sysfs
  - **Keyboard / mouse detection** from `/dev/input/by-path` or `/proc/bus/input/devices`
  - **Memory available** from `/proc/meminfo`
- 36-hour append-only local log with auto-pruning
- Optional HTTP POST push (`SYNCLAN_APP_URL`) for direct ingestion into the dashboard

**Frontend (dashboard)**
- Next.js 16 with App Router
- TypeScript 5
- Tailwind CSS 4 + shadcn/ui
- Recharts for the trend chart
- html-to-image for screenshot export
- lucide-react icons

---

## Quick start

### 1. Build & load the kernel module

```bash
cd backend
make
```

On the admin PC (collector):

```bash
sudo insmod SYNCLAN_KMODULE.ko role_admin=1 local_ip="192.168.1.10"
cat /proc/synclan_log       # should print an aggregated log header
```

On each client PC:

```bash
sudo insmod SYNCLAN_KMODULE.ko role_admin=0 local_ip="192.168.1.25" log_target_ip="192.168.1.10"
```

### 2. Run the userspace health agent

On each client PC (collects CPU/GPU/temp/input stats and pushes them over UDP):

```bash
cd backend
chmod +x synclan_client.sh

SYNCLAN_HOST_NAME="lan-client-01" \
SYNCLAN_LOCAL_IP="192.168.1.25" \
SYNCLAN_UDP_HOST="192.168.1.10" \
SYNCLAN_INTERVAL=10 \
./synclan_client.sh
```

Optional: also push directly to your tracking app:

```bash
SYNCLAN_APP_URL="http://192.168.1.10:8000/api/logs" \
./synclan_client.sh
```

The agent writes a 36-hour append-only log to `~/.local/share/synclan_logs/<hostname>_health.log`.

### 3. Run the dashboard

**Option A — run on the admin node itself (recommended):**

```bash
cd frontend
npm install         # or: bun install
npm run dev         # or: bun run dev
```

Open `http://localhost:3000`. The dashboard reads `/proc/synclan_log` directly. The header badge shows **LIVE**.

**Option B — run on a separate PC:**

See [CONNECTION.md](./CONNECTION.md) for full instructions on exposing `/proc/synclan_log` over HTTP and editing one `fetch()` call in the API route.

### 4. Demo mode (no kernel module needed)

If `/proc/synclan_log` doesn't exist on the host running the dashboard, the API automatically returns simulated animated data so you can demo the UI anywhere. An amber **DEMO MODE** badge makes this state obvious.

---

## Dashboard features

- **5 animated stat cards** — Total Nodes, Nodes UP, Nodes STALE, Total Free RAM, Uptime (smooth count-up animation)
- **Live SVG topology diagram** — admin node in center, clients orbiting, animated dashed lines for UDP flow, pulse rings on UP nodes
- **RAM trend chart** — aggregated free RAM over the last ~80 seconds, updates every 2s
- **Node cards** — for each PC shows:
  - Status badge (UP/STALE)
  - CPU usage bar (color-coded green/amber/red)
  - CPU temperature bar (color-coded by threshold)
  - GPU utilisation + temperature (when present)
  - Free RAM bar
  - Disk usage bar (only for legacy-format clients)
  - Keyboard/mouse detection status
  - Printer name (only for legacy-format clients)
  - Last-seen age
  - Raw log preview (pipe-delimited, one field per line)
- **Live activity feed** — auto-scrolling log of node joins, leaves, and heartbeats
- **Auto-refresh toggle** — polls every 2s, can be paused
- **Screenshot button** — captures the dashboard as a PNG with a timestamped filename
- **Demo mode fallback** — UI always alive even without the kernel module loaded
- **Fully responsive** — mobile, tablet, desktop

---

## API contract — `GET /api/synclan`

The dashboard polls this endpoint every 2 seconds. Response shape:

```jsonc
{
  "mode": "admin",                // "admin" | "client" | "demo"
  "uptime_sec": 6522,             // kernel module uptime
  "total_nodes": 6,               // number of clients in the table
  "max_nodes": 32,                // MAX_NODES constant from the module
  "nodes_up": 6,                  // count of status == "UP"
  "nodes_stale": 0,               // count of status == "STALE"
  "total_free_ram_mb": 3984,      // sum of free_ram_mb across all nodes
  "captured_at": 1795267433000,   // epoch ms when snapshot was taken
  "source": "proc",               // "proc" (live) | "demo" (fallback)
  "nodes": [
    {
      "name": "admin-host",
      "ip": "127.0.0.1",
      "status": "UP",             // "UP" | "STALE"
      "age_sec": 0,               // seconds since last heartbeat
      "free_ram_mb": 72,

      // Fields from the new synclan_client.sh (pipe-delimited payload):
      "host": "admin-host",
      "cpu_usage_percent": 18.4,
      "cpu_temp_c": 48.0,
      "gpu_util_percent": 5,      // absent if GPU not detected
      "gpu_temp_c": 42,           // absent if GPU not detected
      "keyboard": "detected",     // "detected" | "not_detected"
      "mouse": "detected",
      "mem_avail_mb": 612,
      "iso_ts": "2026-11-22T15:30:41+05:30",
      "ts": 1795267441,

      // Fields from the legacy sim_client.sh (kept for backward compat):
      "ssd_root_percent": 37,     // absent for new-format clients
      "ssd_root_used": "6.4G",
      "ssd_root_total": "19G",
      "printers": "none",

      "last_log": "1795267441|2026-11-22T15:30:41+05:30|host=admin-host|cpu_usage=18.4%|cpu_temp=48.0C|gpu(util=5% temp=42C)|keyboard=detected mouse=detected|mem_avail=612MB"
    }
  ]
}
```

The parser in `frontend/src/app/api/synclan/route.ts` accepts both the new pipe-delimited payload AND the legacy `host=... mem_avail=... ssd_root=...` format — so old `sim_client.sh` senders and new `synclan_client.sh` senders both work without code changes.

---

## Kernel module parameters

| Param | Default | Description |
|---|---|---|
| `role_admin` | `0` | `1` = admin collector node, `0` = client sender |
| `local_ip` | `127.0.0.1` | Local host's LAN IPv4 — used to identify the local node entry |
| `server_port` | `8888` | UDP heartbeat listener port (both roles) |
| `log_send_port` | `8889` | UDP port for client log pushes / admin log listener |
| `log_target_ip` | `192.168.1.10` | Admin node's LAN IP (client mode only) |

Examples:

```bash
sudo insmod SYNCLAN_KMODULE.ko role_admin=1 local_ip="192.168.1.10"
sudo insmod SYNCLAN_KMODULE.ko role_admin=0 local_ip="192.168.1.25" log_target_ip="192.168.1.10"
```

Unload:

```bash
sudo rmmod SYNCLAN_KMODULE
```

---

## Health agent environment variables

| Env var | Default | Description |
|---|---|---|
| `SYNCLAN_HOST_NAME` | `$(hostname -s)` | Display name for this node |
| `SYNCLAN_LOCAL_IP` | `127.0.0.1` | Local LAN IP (informational) |
| `SYNCLAN_UDP_HOST` | `127.0.0.1` | Admin node IP to push logs to |
| `SYNCLAN_UDP_PORT` | `8889` | Admin node's log listener port |
| `SYNCLAN_INTERVAL` | `10` | Seconds between samples |
| `SYNCLAN_LOG_DIR` | `~/.local/share/synclan_logs` | Where to write the local log file |
| `SYNCLAN_RETENTION_HOURS` | `36` | Hours of history to keep (≥24 guaranteed) |
| `SYNCLAN_APP_URL` | (empty) | Optional HTTP POST endpoint to push the log file |

---

## Constants (defined in `SYNCLAN_KMODULE.c`)

| Constant | Value | Meaning |
|---|---|---|
| `MAX_NODES` | 32 | Maximum clients tracked |
| `LOG_PERIOD_SEC` | 10 | Client log push interval |
| `NODE_TIMEOUT_SEC` | 30 | Heartbeat timeout before STALE |
| `MAX_LOG_PAYLOAD` | 1024 | Max log line length |
| `PROC_LOG_NAME` | `synclan_log` | `/proc/synclan_log` filename |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Dashboard shows "DEMO MODE" forever | `/proc/synclan_log` not found. Load the kernel module with `role_admin=1` on the host running the dashboard, or set up an HTTP proxy (see [CONNECTION.md](./CONNECTION.md)). |
| Stat cards stay at 0 | The kernel module output must start with `=== SyncLAN Admin Aggregated Log` or `=== SyncLAN Client Log` — the parser keys off those headers. |
| Node cards have no CPU/GPU/temp rows | Those fields come from `synclan_client.sh`. If a node only runs the kernel module (without the health agent), only `free_ram_mb` is populated. Run `synclan_client.sh` on each client. |
| GPU shows "n/a" | Either no GPU detected, or `nvidia-smi` not installed and no DRM sysfs entries. AMD/Intel GPUs use `/sys/class/drm/card*/`. |
| CPU temp shows "n/a" | Install `lm-sensors` (`sudo apt install lm-sensors && sudo sensors-detect`), or ensure `/sys/class/thermal/thermal_zone*/temp` is readable. |
| `dmesg` shows "Failed to bind heartbeat port 8888" | Another process (or a previous instance of the module) is holding port 8888. `sudo rmmod SYNCLAN_KMODULE` first. |
| Client doesn't appear in admin view | Check `log_target_ip` on the client points to the admin's LAN IP, and that no firewall blocks UDP 8888/8889. |

---

## Build for production

```bash
# Frontend:
cd frontend
npm run build
npm run start       # serves on port 3000

# Backend (kernel module):
cd backend
make
```

---

## License

GNU General Public License v3 — see [LICENSE](./LICENSE).

---

## Author

Built as a hackathon project. Kernel module by Anonymous121; dashboard frontend built on top.
