# Connecting the Frontend to the Backend

This guide shows two ways to wire the SyncLAN dashboard to your real kernel-module backend. Pick one.

- **Option A** — run the frontend on the admin node itself (simplest, recommended)
- **Option B** — run the frontend on a separate PC and fetch the log over HTTP

---

## Option A — Run the frontend on the admin node (recommended)

The dashboard reads `/proc/synclan_log` directly from the local filesystem. No network needed.

### Step 1 — Build & load the kernel module on the admin node

On the admin PC (the one that collects logs from all clients):

```bash
cd backend
make
sudo insmod SYNCLAN_KMODULE.ko role_admin=1 local_ip="192.168.1.10"
```

Replace `192.168.1.10` with the admin PC's actual LAN IP.

Verify the log file exists and has content:

```bash
cat /proc/synclan_log
```

You should see something like:

```
=== SyncLAN Client Log (ts=1795267441, uptime=6522s, free_ram=72MB, nodes=1/32) ===

--- Client: admin-host (127.0.0.1) [UP, age=0s, free_ram=72MB] ---
(no log received yet)
```

### Step 2 — Install Node.js or Bun on the admin node

If not already installed:

```bash
# Ubuntu / Debian:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# OR install Bun (faster):
curl -fsSL https://bun.sh/install | bash
```

### Step 3 — Install frontend dependencies

```bash
cd frontend
npm install        # or: bun install
```

This creates `node_modules/` — it takes ~1 minute the first time.

### Step 4 — Run the dashboard

```bash
npm run dev        # or: bun run dev
```

You'll see:

```
▲ Next.js 16.1.3
- Local:        http://localhost:3000
✓ Ready in 661ms
```

### Step 5 — Open the dashboard

On the admin PC, open a browser and go to:

```
http://localhost:3000
```

The badge in the top-right should say **LIVE** (green). If it says **DEMO MODE** (amber), `/proc/synclan_log` is missing — repeat Step 1.

### Step 6 — Add client PCs to the cluster

On every other PC you want to monitor:

```bash
# Load the kernel module in client role:
cd backend
make
sudo insmod SYNCLAN_KMODULE.ko role_admin=0 local_ip="192.168.1.25" log_target_ip="192.168.1.10"

# Run the userspace health agent (collects CPU/GPU/temp/input stats):
chmod +x synclan_client.sh
SYNCLAN_HOST_NAME="lan-client-01" \
SYNCLAN_LOCAL_IP="192.168.1.25" \
SYNCLAN_UDP_HOST="192.168.1.10" \
SYNCLAN_INTERVAL=10 \
./synclan_client.sh
```

The health agent pushes a pipe-delimited log line every 10 seconds over UDP:

```
1795267441|2026-11-22T15:30:41+05:30|host=lan-client-01|cpu_usage=23.4%|cpu_temp=52.0C|gpu(util=15% temp=45C)|keyboard=detected mouse=detected|mem_avail=612MB
```

Refresh the dashboard — new nodes appear within 2 seconds with all CPU/GPU/temp/keyboard/mouse metrics.

### Step 7 — Expose the dashboard to the LAN (optional)

By default, Next.js only listens on `localhost`. To let other PCs on the LAN open the dashboard in their browser:

```bash
# Edit frontend/package.json, change the "dev" script to:
"dev": "next dev -H 0.0.0.0 -p 3000 2>&1 | tee dev.log"

# Then run again:
npm run dev
```

Now anyone on the LAN can open `http://192.168.1.10:3000` (replace with your admin node's IP).

---

## Option B — Run the frontend on a separate PC

Use this if you don't want to install Node.js on the admin node.

### Step 1 — Expose `/proc/synclan_log` over HTTP on the admin node

On the admin PC (where the kernel module is already loaded):

```bash
cd / && busybox httpd -p 8000 -h /
```

This serves the entire filesystem over HTTP on port 8000. Test from another PC:

```bash
curl http://192.168.1.10:8000/proc/synclan_log
```

You should see the raw log text.

> **Security note**: this exposes your whole filesystem. Use only on a trusted LAN, and stop it when done with `pkill busybox`. For a production setup, write a tiny script that only serves that one file.

### Step 2 — Edit the API route in the frontend

On the PC that will run the dashboard (could be your laptop), open this file:

```
frontend/src/app/api/synclan/route.ts
```

Find this block near the bottom:

```ts
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
```

Replace it with:

```ts
export async function GET() {
  try {
    // Fetch the log from the admin node over HTTP
    const r = await fetch("http://192.168.1.10:8000/proc/synclan_log", {
      cache: "no-store",
    });
    if (r.ok) {
      const raw = await r.text();
      const snap = parseProc(raw);
      if (snap) {
        return NextResponse.json(snap, {
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
  } catch {
    // admin node unreachable — fall through to demo
  }

  const snap = demoSnapshot();
  return NextResponse.json(snap, {
    headers: { "Cache-Control": "no-store" },
  });
}
```

Replace `192.168.1.10` with your admin node's actual LAN IP. You can also remove the `existsSync` / `readFileSync` imports at the top if your linter complains — they're no longer used.

### Step 3 — Install dependencies & run

On your frontend PC:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The dashboard polls your admin node over HTTP every 2 seconds.

---

## Optional: Push logs directly to your app via HTTP

The `synclan_client.sh` health agent can also POST its log file directly to your own backend:

```bash
SYNCLAN_HOST_NAME="lan-client-01" \
SYNCLAN_LOCAL_IP="192.168.1.25" \
SYNCLAN_UDP_HOST="192.168.1.10" \
SYNCLAN_INTERVAL=10 \
SYNCLAN_APP_URL="http://192.168.1.10:8000/api/logs" \
./synclan_client.sh
```

When `SYNCLAN_APP_URL` is set, the agent does both:
- Sends the latest line over UDP (port 8889) — for the admin node's `/proc/synclan_log`
- POSTs the full log file to `SYNCLAN_APP_URL` — for your own ingestion endpoint

The HTTP POST includes an `X-Node-Host` header with the hostname. The body is the raw log file content.

---

## Quick troubleshooting

| Problem | What to check |
|---|---|
| Badge still says **DEMO MODE** | `cat /proc/synclan_log` on the admin node — if it's empty or missing, the kernel module didn't load. Run `dmesg \| tail` to see why. |
| Stat cards show 0 | The kernel module output must start with `=== SyncLAN Admin Aggregated Log` or `=== SyncLAN Client Log` — the parser keys off those exact headers. |
| Node cards have no CPU/GPU/temp rows | Run `synclan_client.sh` on the client. The kernel module alone only reports `free_ram_mb`. |
| GPU shows "n/a" | No `nvidia-smi` and no `/sys/class/drm/card*/gpu_busy_percent`. Install nvidia drivers or run on a machine with a GPU. |
| CPU temp shows "n/a" | `sensors` command missing — `sudo apt install lm-sensors && sudo sensors-detect`. |
| `EADDRINUSE` when starting the dashboard | Port 3000 is in use. Kill the old process: `kill $(lsof -t -i:3000)` then retry. |
| Can't access dashboard from another PC | Use `next dev -H 0.0.0.0` (Option A, Step 7) and check your firewall allows port 3000. |
| Option B: `fetch failed` in console | Admin node not reachable. Check IP, check `busybox httpd` is still running, check firewall allows port 8000. |
| Old clients (running `sim_client.sh`) don't show CPU/GPU | That's expected — `sim_client.sh` is the old format. The parser still accepts it but only shows RAM/disk/printers. Upgrade them to `synclan_client.sh`. |

---

## One-line summary for your sir

> The frontend talks to **one HTTP endpoint** — `GET /api/synclan`. By default it reads `/proc/synclan_log` locally. To wire it to the real backend, either (A) run the Next.js app on the admin node, or (B) change one `fetch()` call in `src/app/api/synclan/route.ts` to point at the admin node. The JSON contract is documented in the main `README.md`.
