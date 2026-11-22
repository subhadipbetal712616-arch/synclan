---------------------------------------------------------------------------------
SyncLAN Guide
________________________________________________________________________________

BUILD & PREPARE
-----------------------
Build the kernel module
`make`

Make the userspace health agent executable
`chmod +x synclan_health_agent.sh`

1. LOCALHOST TESTING (Single Machine: 127.0.0.1)
--------------------------------------------------------------------------------
 Terminal 1: Load kernel module in Admin mode on localhost
`sudo rmmod SYNCLAN_KMODULE 2>/dev/null || true
sudo insmod SYNCLAN_KMODULE.ko role_admin=1 local_ip="127.0.0.1"`

 Terminal 2: Run userspace health agent pointing to localhost
`SYNCLAN_HOST_NAME="sim-client-1" \
SYNCLAN_LOCAL_IP="127.0.0.1" \
SYNCLAN_UDP_HOST="127.0.0.1" \
SYNCLAN_INTERVAL=10 \
./synclan_health_agent.sh`

Optional: Include backend/frontend log ingestion URL
`SYNCLAN_HOST_NAME="sim-client-1" \
SYNCLAN_LOCAL_IP="127.0.0.1" \
SYNCLAN_UDP_HOST="127.0.0.1" \
SYNCLAN_INTERVAL=10 \
SYNCLAN_APP_URL="http://127.0.0.1:8000/api/logs" \
./synclan_health_agent.sh`


2. LAN DEPLOYMENT - ADMIN / AGGREGATOR NODE (Example IP: 192.168.1.10)
--------------------------------------------------------------------------------
 Load kernel module in Admin role
`sudo rmmod SYNCLAN_KMODULE 2>/dev/null || true`
`sudo insmod SYNCLAN_KMODULE.ko role_admin=1 local_ip="192.168.1.10"`

 Optional: Custom UDP ports (default: heartbeat_port=8888, log_port=8889)
`sudo insmod SYNCLAN_KMODULE.ko role_admin=1 local_ip="192.168.1.10" heartbeat_port=8888 log_port=8889`


3. LAN DEPLOYMENT - CLIENT / REPORTER NODE (Example IP: 192.168.1.25 -> Admin: 192.168.1.10)
--------------------------------------------------------------------------------
 Step A: Load kernel module in Client role
`sudo rmmod SYNCLAN_KMODULE 2>/dev/null || true`
`sudo insmod SYNCLAN_KMODULE.ko role_admin=0 local_ip="192.168.1.25" log_target_ip="192.168.1.10"`

 Step B: Run userspace health agent for LAN reporting + frontend push
`SYNCLAN_HOST_NAME="lan-client-01" \
SYNCLAN_LOCAL_IP="192.168.1.25" \
SYNCLAN_UDP_HOST="192.168.1.10" \
SYNCLAN_INTERVAL=10 \
SYNCLAN_APP_URL="http://192.168.1.10:8000/api/logs" \
./synclan_health_agent.sh`


4. VERIFICATION & CLEANUP
--------------------------------------------------------------------------------
# View kernel module status and discovered nodes
`cat /proc/synclan_log`

# View recent JSONL health entries
`tail -n 10 "$HOME/.local/share/synclan_logs/"*_health.jsonl`

# Check recent kernel messages for SYNCLAN_KMODULE
`dmesg | grep -i synclan | tail -n 20`

# Unload kernel module when finished
sudo rmmod SYNCLAN_KMODULE
================================================================================
