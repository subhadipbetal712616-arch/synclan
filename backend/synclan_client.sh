#!/usr/bin/env bash
set -u

HOST_NAME="$(hostname -s)"
LOG_DIR="${SYNCLAN_LOG_DIR:-$HOME/.local/share/synclan_logs}"
LOG_FILE="${LOG_DIR}/${HOST_NAME}_health.log"
RETENTION_HOURS="${SYNCLAN_RETENTION_HOURS:-36}"   # >= 24h guaranteed
INTERVAL="${SYNCLAN_INTERVAL:-10}"
APP_ENDPOINT="${SYNCLAN_APP_URL:-}"               # e.g., http://127.0.0.1:9000/ingest
UDP_HOST="${SYNCLAN_UDP_HOST:-127.0.0.1}"
UDP_PORT="${SYNCLAN_UDP_PORT:-8889}"

mkdir -p "$LOG_DIR"
touch "$LOG_FILE"

get_cpu_usage() {
  read -r _ u1 n1 s1 i1 io1 irq1 sirq1 _ < /proc/stat
  t1=$((u1 + n1 + s1 + i1 + io1 + irq1 + sirq1))
  sleep 0.5
  read -r _ u2 n2 s2 i2 io2 irq2 sirq2 _ < /proc/stat
  t2=$((u2 + n2 + s2 + i2 + io2 + irq2 + sirq2))
  dt=$((t2 - t1))
  di=$((i2 - i1))
  if [ "$dt" -gt 0 ]; then
    awk -v dt="$dt" -v di="$di" 'BEGIN { printf "%.1f%%", ((dt - di) * 100.0) / dt }'
  else
    echo "n/a"
  fi
}

get_cpu_temp() {
  if command -v sensors >/dev/null 2>&1; then
    temp=$(sensors 2>/dev/null | awk '/Package id 0:|Tctl:|Tdie:|CPU:/ {
      for (i=1; i<=NF; i++) if ($i ~ /^\+?[0-9]+(\.[0-9]+)?°C/) { gsub(/^\+|°C/, "", $i); print $i"C"; exit }
    }')
    [ -n "$temp" ] && { echo "$temp"; return; }
  fi
  for tz in /sys/class/thermal/thermal_zone*; do
    [ -r "$tz/type" ] && [ -r "$tz/temp" ] || continue
    tname=$(cat "$tz/type")
    case "$tname" in
      *x86_pkg_temp*|*cpu*|*soc*|*k10temp*|*acpitz*)
        awk -v m="$(cat "$tz/temp")" 'BEGIN { printf "%.1fC", m/1000.0 }'
        return
        ;;
    esac
  done
  if [ -r /sys/class/thermal/thermal_zone0/temp ]; then
    awk -v m="$(cat /sys/class/thermal/thermal_zone0/temp)" 'BEGIN { printf "%.1fC", m/1000.0 }'
  else
    echo "n/a"
  fi
}

get_gpu_stats() {
  if command -v nvidia-smi >/dev/null 2>&1; then
    out=$(nvidia-smi --query-gpu=utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>/dev/null | head -n1)
    if [ -n "$out" ]; then
      u=$(echo "$out" | awk -F',' '{gsub(/ /,"",$1); print $1"%"}')
      t=$(echo "$out" | awk -F',' '{gsub(/ /,"",$2); print $2"C"}')
      echo "util=${u} temp=${t}"
      return
    fi
  fi
  # Fallback for AMD / DRM sysfs
  for card in /sys/class/drm/card*/device; do
    if [ -r "$card/gpu_busy_percent" ]; then
      u="$(cat "$card/gpu_busy_percent")%"
      t="n/a"
      for hw in "$card"/hwmon/hwmon*/temp1_input; do
        [ -r "$hw" ] && t=$(awk -v m="$(cat "$hw")" 'BEGIN { printf "%.1fC", m/1000.0 }') && break
      done
      echo "util=${u} temp=${t}"
      return
    fi
  done
  echo "util=n/a temp=n/a"
}

check_kbd_mouse() {
  kbd="not_detected"
  mouse="not_detected"

  if [ -d /dev/input/by-path ]; then
    ls /dev/input/by-path/*-event-kbd >/dev/null 2>&1 && kbd="detected"
    ls /dev/input/by-path/*-event-mouse >/dev/null 2>&1 && mouse="detected"
  fi

  if [ "$kbd" = "not_detected" ] || [ "$mouse" = "not_detected" ]; then
    if [ -r /proc/bus/input/devices ]; then
      grep -qiE "keyboard|kbd" /proc/bus/input/devices && [ "$kbd" = "not_detected" ] && kbd="detected"
      grep -qiE "mouse|pointer|trackpad" /proc/bus/input/devices && [ "$mouse" = "not_detected" ] && mouse="detected"
    fi
  fi

  echo "keyboard=${kbd} mouse=${mouse}"
}

prune_old_entries() {
  now_epoch=$(date +%s)
  cutoff=$((now_epoch - RETENTION_HOURS * 3600))
  tmp_file="${LOG_FILE}.tmp"
  awk -F'|' -v cut="$cutoff" '$1 >= cut { print $0 }' "$LOG_FILE" > "$tmp_file" && mv "$tmp_file" "$LOG_FILE"
}

while true; do
  ts_epoch=$(date +%s)
  ts_iso=$(date -Iseconds)
  cpu_u=$(get_cpu_usage)
  cpu_t=$(get_cpu_temp)
  gpu_s=$(get_gpu_stats)
  hid_s=$(check_kbd_mouse)
  mem_avail=$(awk '/MemAvailable:/ {printf "%dMB", $2/1024}' /proc/meminfo)

  # Pipe-delimited append-only record (field 1 = epoch for exact 24h+ retention)
  line="${ts_epoch}|${ts_iso}|host=${HOST_NAME}|cpu_usage=${cpu_u}|cpu_temp=${cpu_t}|gpu(${gpu_s})|${hid_s}|mem_avail=${mem_avail}"

  # Append only — never overwrite
  printf '%s\n' "$line" >> "$LOG_FILE"

  # Keep at least 24 hours of history (36h window)
  prune_old_entries

  # Send to your tracking application:
  # Option A: HTTP POST (JSON or raw log file) if SYNCLAN_APP_URL is set
  if [ -n "$APP_ENDPOINT" ] && command -v curl >/dev/null 2>&1; then
    curl -sS -X POST -H "X-Node-Host: ${HOST_NAME}" --data-binary @"$LOG_FILE" "$APP_ENDPOINT" >/dev/null 2>&1 || true
  fi

  # Option B: Send latest line over UDP to your collector/admin
  printf '%s\n' "$line" | nc -u -w1 "$UDP_HOST" "$UDP_PORT" >/dev/null 2>&1 || true

  sleep "$INTERVAL"
done
