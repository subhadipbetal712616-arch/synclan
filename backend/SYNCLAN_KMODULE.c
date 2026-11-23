/* SyncLAN Kernel Module:
 * - Tracks local and peer LAN nodes, populates live free RAM (MB) via si_meminfo(),
 *   exposes /proc/synclan_log, and ships periodic logs to the Admin Node.
 */

#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>
#include <linux/slab.h>
#include <linux/string.h>
#include <linux/mm.h>
#include <linux/ktime.h>
#include <linux/kthread.h>
#include <linux/mutex.h>
#include <linux/workqueue.h>
#include <linux/proc_fs.h>
#include <linux/seq_file.h>
#include <linux/net.h>
#include <linux/in.h>
#include <linux/inet.h>
#include <net/sock.h>
#include <linux/timekeeping.h>

MODULE_LICENSE("GPL");
MODULE_AUTHOR("Anonymous121");
MODULE_DESCRIPTION("SyncLAN KERNEL MODULE");

#define MAX_NODES 32
#define SERVER_PORT 8888
#define LOG_SEND_PORT 8889
#define LOG_TARGET_IP "192.168.1.10"
#define LOG_PERIOD_SEC 10
#define NODE_TIMEOUT_SEC 30
#define MAX_LOG_PAYLOAD 1024
#define PROC_LOG_NAME "synclan_log"

static int role_admin = 0;
module_param(role_admin, int, 0444);
MODULE_PARM_DESC(role_admin, "1 for admin collector node, 0 for client node");

static char local_ip[16] = "127.0.0.1";
module_param_string(local_ip,local_ip, sizeof(local_ip), 0444);
MODULE_PARM_DESC(local_ip,"Local host IPV4 address for local health only");

static int server_port = SERVER_PORT;
module_param(server_port, int, 0444);
MODULE_PARM_DESC(server_port, "UDP heartbeat listener port");

static int log_send_port = LOG_SEND_PORT;
module_param(log_send_port, int, 0444);
MODULE_PARM_DESC(log_send_port, "UDP port for client log pushes / admin log listener");

static char log_target_ip[16] = LOG_TARGET_IP;
module_param_string(log_target_ip, log_target_ip, sizeof(log_target_ip), 0444);
MODULE_PARM_DESC(log_target_ip, "Authorized Admin Node IPv4 address (client mode)");

struct synclan_node {
	char name[64];
	char ip[16];
	int active;
	u64 last_seen_sec;
	unsigned long mem_info; /* Free RAM in MB */
	char last_log[MAX_LOG_PAYLOAD];
};

static struct synclan_node nodes[MAX_NODES];
static int node_count = 0;
static DEFINE_MUTEX(node_lock);

static struct socket *listen_sock = NULL;
static struct socket *admin_recv_sock = NULL;
static struct socket *send_sock = NULL;
static struct task_struct *server_thread = NULL;
static struct task_struct *admin_recv_thread = NULL;
static struct proc_dir_entry *proc_entry = NULL;

static void synclan_work_handler(struct work_struct *work);
static DECLARE_DELAYED_WORK(synclan_log_work, synclan_work_handler);

/* Read current free RAM in megabytes via si_meminfo() */
static unsigned long get_local_free_ram_mb(void)
{
	struct sysinfo info;

	si_meminfo(&info);
	/* info.freeram is in pages; PAGE_SHIFT is log2(PAGE_SIZE), so >> 20 converts bytes to MB */
	return ((unsigned long)info.freeram << PAGE_SHIFT) >> 20;
}

static void copy_safe(char *dst, const char *src, size_t size)
{
	if (!dst || !src || size == 0)
		return;
	strscpy(dst, src, size);
}

static void set_status_locked(struct synclan_node *node, int status)
{
	if (!node)
		return;
	node->active = status;
	node->last_seen_sec = ktime_get_seconds();
}

static void refresh_node_states_locked(u64 now_sec)
{
	int i;
	for (i = 0; i < node_count; i++) {
		if (nodes[i].active && (now_sec - nodes[i].last_seen_sec) > NODE_TIMEOUT_SEC)
			nodes[i].active = 0;
	}
}

static struct synclan_node *find_or_add_locked(const char *name, const char *ip)
{
	int i;
	struct synclan_node *node = NULL;

	for (i = 0; i < node_count; i++) {
		if (strncmp(nodes[i].ip, ip, sizeof(nodes[i].ip)) == 0) {
			node = &nodes[i];
			if (name && name[0] != '\0')
				copy_safe(node->name, name, sizeof(node->name));
			set_status_locked(node, 1);
			return node;
		}
	}

	if (node_count < MAX_NODES) {
		node = &nodes[node_count++];
		copy_safe(node->name, (name && name[0] != '\0') ? name : "unknown",
			  sizeof(node->name));
		copy_safe(node->ip, ip, sizeof(node->ip));
		set_status_locked(node, 1);
		pr_info("SyncLAN: Added node %s (%s)\n", node->name, node->ip);
	} else {
		pr_warn_ratelimited("SyncLAN: Max nodes (%d) reached, ignoring %s\n",
				    MAX_NODES, ip);
	}

	return node;
}

/* Keep local host entry updated with live free RAM */
static void update_local_health(void)
{
	unsigned long free_mb = get_local_free_ram_mb();

	mutex_lock(&node_lock);
	if (node_count > 0 && strcmp(nodes[0].ip, local_ip) == 0) {
		nodes[0].mem_info = free_mb;
		set_status_locked(&nodes[0], 1);
	}
	mutex_unlock(&node_lock);
}
/* Store incoming log payload from a client node on the admin node */
static void record_client_log(const char *ip, const char *payload)
{
	struct synclan_node *node;

	mutex_lock(&node_lock);
	node = find_or_add_locked(NULL, ip);
	if (node) {
		copy_safe(node->last_log, payload, sizeof(node->last_log));
		set_status_locked(node, 1);
	}
	mutex_unlock(&node_lock);
}

/* Format client/local log snapshot */
static ssize_t format_client_log(char *buf, size_t buf_len)
{
int i;
size_t offset = 0;
u64 now_sec = ktime_get_seconds();
time64_t epoch_sec = ktime_get_real_seconds();
unsigned long local_free_mb = get_local_free_ram_mb();

mutex_lock(&node_lock);
refresh_node_states_locked(now_sec);

offset += scnprintf(buf + offset, buf_len - offset,
		    "=== SyncLAN Client Log (ts=%lld, uptime=%llus, free_ram=%luMB, nodes=%d/%d) ===\n",
		    (long long)epoch_sec, now_sec, local_free_mb, node_count, MAX_NODES);	for (i = 0; i < node_count && offset < (int)buf_len - 1; i++) {
		offset += scnprintf(buf + offset, buf_len - offset,
				    "node=%s ip=%s status=%s age=%llus free_ram=%luMB\n",
				    nodes[i].name,
				    nodes[i].ip,
				    nodes[i].active ? "UP" : "STALE",
				    now_sec >= nodes[i].last_seen_sec ?
					    (now_sec - nodes[i].last_seen_sec) : 0,
				    nodes[i].mem_info);
	}

	mutex_unlock(&node_lock);
	return offset;
}

/* Format aggregated logs from all clients on the admin node */
static ssize_t format_admin_log(char *buf, size_t buf_len)
{
int i;
size_t offset = 0;
u64 now_sec = ktime_get_seconds();
time64_t epoch_sec = ktime_get_real_seconds();
unsigned long local_free_mb = get_local_free_ram_mb();

mutex_lock(&node_lock);
refresh_node_states_locked(now_sec);

offset += scnprintf(buf + offset, buf_len - offset,
		    "=== SyncLAN Client Log (ts=%lld, uptime=%llus, free_ram=%luMB, nodes=%d/%d) ===\n",
		    (long long)epoch_sec, now_sec, local_free_mb, node_count, MAX_NODES);
	for (i = 0; i < node_count && offset < (int)buf_len - 1; i++) {
		u64 age = now_sec >= nodes[i].last_seen_sec ?
			  (now_sec - nodes[i].last_seen_sec) : 0;

		offset += scnprintf(buf + offset, buf_len - offset,
				    "\n--- Client: %s (%s) [%s, age=%llus, free_ram=%luMB] ---\n%s\n",
				    nodes[i].name,
				    nodes[i].ip,
				    nodes[i].active ? "UP" : "STALE",
				    age,
				    nodes[i].mem_info,
				    nodes[i].last_log[0] ? nodes[i].last_log : "(no log received yet)");
	}

	mutex_unlock(&node_lock);
	return offset;
}

static int format_synclan_log(char *buf, size_t buf_len)
{
	if (!buf || buf_len == 0)
		return 0;
	return role_admin ? format_admin_log(buf, buf_len) : format_client_log(buf, buf_len);
}

static int synclan_proc_show(struct seq_file *m, void *v)
{
	char *buf;
	int len;

	update_local_health();

	buf = kmalloc(PAGE_SIZE * 2, GFP_KERNEL);
	if (!buf)
		return -ENOMEM;

	len = format_synclan_log(buf, PAGE_SIZE * 2);
	seq_write(m, buf, len);

	kfree(buf);
	return 0;
}

static int synclan_proc_open(struct inode *inode, struct file *file)
{
	return single_open(file, synclan_proc_show, NULL);
}

static const struct proc_ops synclan_proc_ops = {
	.proc_open    = synclan_proc_open,
	.proc_read    = seq_read,
	.proc_lseek   = seq_lseek,
	.proc_release = single_release,
};

/* Client mode: send dynamic log to Admin Node over UDP */
static void send_log_to_admin(void)
{
	struct sockaddr_in dest;
	struct msghdr msg;
	struct kvec vec;
	char *buf;
	int len, ret;
	__be32 target_ip;

	if (role_admin || !send_sock)
		return;

	if (!in4_pton(log_target_ip, -1, (u8 *)&target_ip, -1, NULL)) {
		pr_err_ratelimited("SyncLAN: Invalid log_target_ip '%s'\n", log_target_ip);
		return;
	}

	buf = kmalloc(MAX_LOG_PAYLOAD, GFP_KERNEL);
	if (!buf)
		return;

	len = format_client_log(buf, MAX_LOG_PAYLOAD);
	if (len <= 0) {
		kfree(buf);
		return;
	}

	memset(&dest, 0, sizeof(dest));
	dest.sin_family = AF_INET;
	dest.sin_port = htons(log_send_port);
	dest.sin_addr.s_addr = target_ip;

	memset(&msg, 0, sizeof(msg));
	msg.msg_name = &dest;
	msg.msg_namelen = sizeof(dest);

	vec.iov_base = buf;
	vec.iov_len = len;

	ret = kernel_sendmsg(send_sock, &msg, &vec, 1, len);
	if (ret < 0)
		pr_debug("SyncLAN: send_log_to_admin to %s:%d returned %d\n",
			 log_target_ip, log_send_port, ret);

	kfree(buf);
}

static void synclan_work_handler(struct work_struct *work)
{
	update_local_health();

	if (!role_admin)
		send_log_to_admin();

	schedule_delayed_work(&synclan_log_work, msecs_to_jiffies(LOG_PERIOD_SEC * 1000));
}

/* Heartbeat listener on server_port */
static int synclan_listener(void *data)
{
	struct sockaddr_in addr;
	struct msghdr msg;
	struct kvec vec;
	char *buf;
	int len;

	buf = kmalloc(256, GFP_KERNEL);
	if (!buf)
		return -ENOMEM;

	pr_info("SyncLAN: Listening for heartbeats on UDP port %d\n", server_port);

	while (!kthread_should_stop()) {
		memset(&msg, 0, sizeof(msg));
		memset(&addr, 0, sizeof(addr));
		memset(buf, 0, 256);

		msg.msg_name = &addr;
		msg.msg_namelen = sizeof(addr);
		vec.iov_base = buf;
		vec.iov_len = 255;

		len = kernel_recvmsg(listen_sock, &msg, &vec, 1, 255, MSG_DONTWAIT);
		if (len > 0) {
			char ip_str[16];
			buf[min(len, 255)] = '\0';
			strim(buf);
			snprintf(ip_str, sizeof(ip_str), "%pI4", &addr.sin_addr.s_addr);

			mutex_lock(&node_lock);
			find_or_add_locked(buf, ip_str);
			mutex_unlock(&node_lock);
		} else {
			schedule_timeout_interruptible(msecs_to_jiffies(200));
		}
	}

	kfree(buf);
	return 0;
}

/* Admin mode: receive client log pushes on log_send_port */
static int synclan_admin_receiver(void *data)
{
	struct sockaddr_in addr;
	struct msghdr msg;
	struct kvec vec;
	char *buf;
	int len;

	buf = kmalloc(MAX_LOG_PAYLOAD, GFP_KERNEL);
	if (!buf)
		return -ENOMEM;

	pr_info("SyncLAN: Admin receiving client logs on UDP port %d\n", log_send_port);

	while (!kthread_should_stop()) {
		memset(&msg, 0, sizeof(msg));
		memset(&addr, 0, sizeof(addr));
		memset(buf, 0, MAX_LOG_PAYLOAD);

		msg.msg_name = &addr;
		msg.msg_namelen = sizeof(addr);
		vec.iov_base = buf;
		vec.iov_len = MAX_LOG_PAYLOAD - 1;

		len = kernel_recvmsg(admin_recv_sock, &msg, &vec, 1,
				     MAX_LOG_PAYLOAD - 1, MSG_DONTWAIT);
		if (len > 0) {
			char ip_str[16];
			buf[min(len, MAX_LOG_PAYLOAD - 1)] = '\0';
			snprintf(ip_str, sizeof(ip_str), "%pI4", &addr.sin_addr.s_addr);
			record_client_log(ip_str, buf);
		} else {
			schedule_timeout_interruptible(msecs_to_jiffies(200));
		}
	}

	kfree(buf);
	return 0;
}

static int create_bound_udp_sock(int port, struct socket **out_sock)
{
	struct sockaddr_in saddr;
	int ret;

	ret = sock_create_kern(&init_net, AF_INET, SOCK_DGRAM, IPPROTO_UDP, out_sock);
	if (ret < 0)
		return ret;

	memset(&saddr, 0, sizeof(saddr));
	saddr.sin_family = AF_INET;
	saddr.sin_addr.s_addr = htonl(INADDR_ANY);
	saddr.sin_port = htons(port);

	ret = kernel_bind(*out_sock, (struct sockaddr *)&saddr, sizeof(saddr));
	if (ret < 0) {
		sock_release(*out_sock);
		*out_sock = NULL;
		return ret;
	}

	return 0;
}

static int __init synclan_init(void)
{
	int ret;

mutex_lock(&node_lock);
	find_or_add_locked(role_admin ? "admin-host" : "client-host", local_ip);
	nodes[0].mem_info = get_local_free_ram_mb();
	mutex_unlock(&node_lock);

	ret = create_bound_udp_sock(server_port, &listen_sock);
	if (ret < 0) {
		pr_err("SyncLAN: Failed to bind heartbeat port %d (%d)\n", server_port, ret);
		return ret;
	}

	if (role_admin) {
		ret = create_bound_udp_sock(log_send_port, &admin_recv_sock);
		if (ret < 0) {
			pr_err("SyncLAN: Failed to bind admin log port %d (%d)\n",
			       log_send_port, ret);
			goto err_listen;
		}
	} else {
		ret = sock_create_kern(&init_net, AF_INET, SOCK_DGRAM, IPPROTO_UDP, &send_sock);
		if (ret < 0) {
			pr_err("SyncLAN: Failed to create client sender socket (%d)\n", ret);
			goto err_listen;
		}
	}

	proc_entry = proc_create(PROC_LOG_NAME, 0444, NULL, &synclan_proc_ops);
	if (!proc_entry) {
		pr_err("SyncLAN: Failed to create /proc/%s\n", PROC_LOG_NAME);
		ret = -ENOMEM;
		goto err_sockets;
	}

	server_thread = kthread_run(synclan_listener, NULL, "synclan_listener");
	if (IS_ERR(server_thread)) {
		pr_err("SyncLAN: Failed to start listener thread\n");
		ret = PTR_ERR(server_thread);
		server_thread = NULL;
		goto err_proc;
	}

	if (role_admin) {
		admin_recv_thread = kthread_run(synclan_admin_receiver, NULL,
						"synclan_admin_rx");
		if (IS_ERR(admin_recv_thread)) {
			pr_err("SyncLAN: Failed to start admin receiver thread\n");
			ret = PTR_ERR(admin_recv_thread);
			admin_recv_thread = NULL;
			goto err_listener_thread;
		}
	} else {
		schedule_delayed_work(&synclan_log_work,
				      msecs_to_jiffies(LOG_PERIOD_SEC * 1000));
	}

	pr_info("SyncLAN: Loaded as %s (proc=/proc/%s, free_ram=%luMB)\n",
		role_admin ? "ADMIN" : "CLIENT", PROC_LOG_NAME, get_local_free_ram_mb());
	return 0;

err_listener_thread:
	kthread_stop(server_thread);
err_proc:
	proc_remove(proc_entry);
err_sockets:
	if (send_sock) {
		sock_release(send_sock);
		send_sock = NULL;
	}
	if (admin_recv_sock) {
		sock_release(admin_recv_sock);
		admin_recv_sock = NULL;
	}
err_listen:
	sock_release(listen_sock);
	listen_sock = NULL;
	return ret;
}

static void __exit synclan_exit(void)
{
	cancel_delayed_work_sync(&synclan_log_work);

	if (admin_recv_thread)
		kthread_stop(admin_recv_thread);

	if (server_thread)
		kthread_stop(server_thread);

	if (proc_entry)
		proc_remove(proc_entry);

	if (send_sock)
		sock_release(send_sock);

	if (admin_recv_sock)
		sock_release(admin_recv_sock);

	if (listen_sock)
		sock_release(listen_sock);

	pr_info("SyncLAN: Kernel module unloaded\n");
}

module_init(synclan_init);
module_exit(synclan_exit);
