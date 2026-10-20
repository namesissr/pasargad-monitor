#!/usr/bin/env python3
"""
آزمون سوییچ‌ها (Cisco Nexus / NX-API).

برخلاف بیشتر آزمون‌های این پوشه، اینجا آینه پایتونی نیست: تجزیه‌گرهای
واقعی worker/nxapi.mjs با node اجرا می‌شوند و خروجی‌شان روی نمونه‌های
خروجی NX-OS سنجیده می‌شود. بعد چند قاعده امنیتی با جست‌وجو در کد واقعی
بررسی می‌شود.

اجرا:  python3 scripts/test-switch.py
نیاز:  node 18 یا بالاتر
"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
passed = 0
failed = []


def check(cond, msg):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(msg)
        print("✗", msg)


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


# ── ۱) تجزیه‌گرها، اجرای واقعی ──────────────────────────────────────

NODE_SCRIPT = r"""
const m = await import(process.argv[1]);
const out = {};

// show interface: اترنت، پورت‌چنل با فهرست عضو، mgmt0 با کلید vdc_lvl، ویلن
const iface = {
  TABLE_interface: { ROW_interface: [
    { interface: 'Ethernet1/1', state: 'up', admin_state: 'up', desc: 'web-01', eth_speed: '10 Gb/s',
      eth_bw: 10000000, eth_mode: 'access', eth_mtu: '9216', eth_inbytes: 1000, eth_outbytes: '2000',
      eth_inerr: '3', eth_crc: '1', eth_hw_addr: '00a6.cafe.0001' },
    { interface: 'Ethernet1/2', state: 'down', state_rsn_desc: 'Administratively down', admin_state: 'down',
      eth_speed: 'auto-speed', eth_bw: 25000000, eth_inbytes: 0, eth_outbytes: 0 },
    { interface: 'Ethernet1/3', state: 'down', state_rsn_desc: 'Link not connected', admin_state: 'up',
      eth_speed: '1000 Mb/s' },
    { interface: 'Ethernet1/49/1', state: 'up', admin_state: 'up', eth_speed: '25 Gb/s', eth_inbytes: 5, eth_outbytes: 6 },
    { interface: 'port-channel10', state: 'up', admin_state: 'up', eth_members: 'Eth1/1, Eth1/49/1',
      eth_speed: '10 Gb/s', eth_inbytes: 1005, eth_outbytes: 2006 },
    { interface: 'mgmt0', state: 'up', admin_state: 'up', eth_speed: '1000 Mb/s', vdc_lvl_in_bytes: 77, vdc_lvl_out_bytes: 88 },
    { interface: 'Vlan10', svi_admin_state: 'up', svi_line_proto: 'down', svi_rsn_desc: 'VLAN/BD is down' },
  ] },
};
out.ports = m.parseInterfaces(iface);
// تک‌ردیف: NX-API برای یک ردیف شیء می‌دهد نه آرایه
out.single = m.parseInterfaces({ TABLE_interface: { ROW_interface: { interface: 'Ethernet1/7', state: 'up', admin_state: 'up' } } });

out.status = Object.fromEntries(m.parseInterfaceStatus({ TABLE_interface: { ROW_interface: [
  { interface: 'Eth1/1', state: 'connected', vlan: '10', type: '10Gbase-SR' },
  { interface: 'Po10', state: 'connected', vlan: 'trunk', type: null },
] } }));

out.res = m.parseResources({ cpu_state_idle: '87.5', memory_usage_total: 1000, memory_usage_used: 250, load_avg_1min: '0.5' });
out.resNoIdle = m.parseResources({ cpu_state_user: '3', cpu_state_kernel: '2' });
out.ver = m.parseVersion({ chassis_id: 'Nexus9000 C93180YC-FX chassis', sys_ver_str: '7.0(3)I7(9)', host_name: 'sw1',
  proc_board_id: 'FDO1', kern_uptm_days: 1, kern_uptm_hrs: 2, kern_uptm_mins: 3, kern_uptm_secs: 4 });

// محیط: فن در ریشه (نه زیر fandetails)، کلید psu_status، یک تغذیه بی‌برق، یک دما بالای حد
out.env = m.parseEnvironment({
  temperature: { TABLE_tempinfo: { ROW_tempinfo: [
    { tempmod: '1', sensor: 'FRONT', majthres: '80', curtemp: '35', alarmstatus: 'Normal' },
    { tempmod: '1', sensor: 'ASIC', majthres: '90', curtemp: '95', alarmstatus: 'Normal' },
  ] } },
  fan: { TABLE_faninfo: { ROW_faninfo: [
    { fanname: 'Fan1', fanstatus: 'Ok' }, { fanname: 'Fan2', fanstatus: 'Absent' },
  ] } },
  power: { powersup: { TABLE_psinfo: { ROW_psinfo: [
    { psnum: 1, psu_status: 'Ok', actual_out: '120 W' }, { psnum: 2, psu_status: 'Fail/Shutdown' },
  ] } } },
});
out.envOk = m.parseEnvironment({ temperature: null, fan: { fandetails: { TABLE_faninfo: { ROW_faninfo: { fanname: 'F', fanstatus: 'ok' } } } }, power: null });

out.xcvr = Object.fromEntries(m.parseTransceivers({ TABLE_interface: { ROW_interface: [
  { interface: 'Ethernet1/49', sfp: 'present', type: 'QSFP-100G-SR4', name: 'CISCO',
    TABLE_lane: { ROW_lane: [
      { temperature: '40', rx_pwr: '-1.0', tx_pwr: '-0.5', rx_pwr_warn_lo: '-10.0' },
      { rx_pwr: '-12.5', tx_pwr: '-0.7' },
    ] } },
  { interface: 'Ethernet1/50', sfp: 'not present' },
  { interface: 'Ethernet1/51', sfp: 'present', type: '10Gbase-LR', temperature: '30', rx_pwr: '-4', tx_pwr: '-2', rx_pwr_warn_lo: '-14' },
] } }));

out.delta = [m.counterDelta(100, 150), m.counterDelta(150, 100), m.counterDelta(null, 5), m.counterDelta('100', '250')];
out.speed = [m.parseSpeedMbps('100 Gb/s'), m.parseSpeedMbps('auto-speed', 10000000), m.parseSpeedMbps('100 Mb/s'), m.parseSpeedMbps(null, null)];
out.safe = ['Ethernet1/1', 'Ethernet1/49/1', 'port-channel10', 'mgmt0', 'Vlan10', 'Ethernet1/1 ;reload',
            'Ethernet1/1\nreload', 'ethernet1/1', 'Ethernet1/1;shutdown'].map((n) => [n, m.isSafePortName(n)]);
out.full = [m.fullPortName('Eth1/2'), m.fullPortName('Po100'), m.fullPortName('Ethernet1/2'), m.fullPortName('mgmt0')];
out.explain = [
  m.explainError({ status: 401 }), m.explainError({ code: 'ECONNREFUSED' }),
  m.explainError({ code: 'TIMEOUT' }), m.explainError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
];

// خط پیکربندی با جداکننده نباید هرگز فرستاده شود
let rejected = 0;
for (const bad of [['interface Ethernet1/1 ;reload'], ['shutdown\nreload'], ['']]) {
  try { await m.configure({ url: 'https://127.0.0.1:1', username: 'x', password: 'y' }, bad); }
  catch (e) { if (/نامعتبر/.test(e.message)) rejected++; }
}
out.rejected = rejected;
try { await m.show({ url: 'https://127.0.0.1:1' }, 'show version ; reload'); out.showRejected = false; }
catch (e) { out.showRejected = /نامعتبر/.test(e.message); }


// کشف: جدول MAC، ARP، LLDP، CDP
out.macs = m.parseMacTable({ TABLE_mac_address: { ROW_mac_address: [
  { disp_mac_addr: '0050.56A1.0001', disp_port: 'Eth1/1', disp_vlan: '10' },
  { disp_mac_addr: '0050.56a1.0002', disp_port: 'Po10', disp_vlan: 20 },
  { disp_mac_addr: '0050.56a1.0003', disp_port: 'sup-eth1(R)', disp_vlan: '-' },
  { disp_mac_addr: 'bad', disp_port: 'Eth1/2', disp_vlan: '10' },
] } });
out.arp = m.parseArp({ TABLE_vrf: { ROW_vrf: [{ vrf_name_out: 'default', TABLE_adj: { ROW_adj: [
  { 'ip-addr-out': '10.0.0.5', mac: '0050.56a1.0001', 'phy-intf': 'Ethernet1/1' },
  { 'ip-addr-out': '10.0.0.6', mac: 'INCOMPLETE' },
] } }] } });
out.lldp = m.parseLldp({ TABLE_nbor_detail: { ROW_nbor_detail: [
  { l_port_id: 'Eth1/1', sys_name: 'web-01.example.com', port_id: 'eno1', port_desc: 'eno1', sys_desc: 'Ubuntu 22.04',
    mgmt_addr: '10.0.0.5', chassis_id: '0050.56a1.0001', enabled_capability: 'B, R' },
] } });
out.cdp = m.parseCdp({ TABLE_cdp_neighbor_detail_info: { ROW_cdp_neighbor_detail_info: {
  intf_id: 'Ethernet1/49', sysname: 'core-sw(FDO1234)', port_id: 'Ethernet1/1', platform_id: 'N9K-C9336C-FX2',
  v4mgmtaddr: '10.0.0.1', capability: ['router', 'switch'] } } });
out.mac = ['0050.56A1.0001', '00-50-56-a1-00-01', Buffer.from([0, 0x50, 0x56, 0xa1, 0, 1]), 'zz', null].map(m.normalizeMac);
out.host = ['Web-01.Example.com', 'core-sw(FDO1)', null].map(m.shortHostName);

// پشتیبان پیکربندی: خط‌های زمان‌دار حذف می‌شوند تا هر پشتیبان «تغییر» نباشد
out.cfg = m.cleanConfig('!Command: show running-config\r\n!Running configuration last done at: Mon Oct 20 10:00:00 2026\r\n!Time: Mon Oct 20 10:05:00 2026\r\n\r\nversion 9.3(8)\r\nhostname n9k\r\n');

// محدودیت سرعت و توضیح
const pol = m.parseServicePolicies('interface Ethernet1/1\n  description x\n  service-policy type qos input PANEL-RL-100M\n  service-policy type qos output CUSTOMER-QOS\n');
out.pol = [pol.input, pol.output, m.rateFromPolicy(pol.input), m.rateFromPolicy(pol.output), m.rateFromPolicy(null), m.ratePolicyName(250)];
out.desc = ['  web-01 rack 3  ', 'a;reload', 'a\nb', 'x'.repeat(255), '\x07bell', ''].map((v) => m.cleanDescription(v));
out.desc64 = m.cleanDescription('x'.repeat(65), 64).ok;

// پیکربندی کامل ← بلوک یک اینترفیس، و تکه محدودیت برای SNMP
const full = 'hostname x\ninterface Ethernet1/1\n  description a\n  service-policy type qos input PANEL-RL-100M\ninterface Ethernet1/10\n  description b\n';
out.block = [m.interfaceBlock(full, 'Ethernet1/1'), m.interfaceBlock(full, 'Ethernet1/10'), m.interfaceBlock(full, 'Ethernet1/2')];
out.snip = [
  m.rateLimitSnippet('Ethernet1/1', { input: null, output: null }, 100),
  m.rateLimitSnippet('Ethernet1/1', { input: 'PANEL-RL-100M', output: 'PANEL-RL-100M' }, 250),
  m.rateLimitSnippet('Ethernet1/1', { input: 'PANEL-RL-100M', output: null }, 0),
];

// فرمان‌های نوشتنی با سوییچ ساختگی: پورت ناامن، سرعت نامعتبر و policy بیگانه پیش از هر تغییری رد می‌شوند
const calls = [];
const origFetch = globalThis.fetch;
const fakeSw = { id: 1, url: 'https://192.0.2.1', username: 'u', password: 'p', insecure_tls: true };
out.guard = [];
for (const [fn, args] of [
  ['setDescription', [{ name: 'mgmt0' }, 'x']],
  ['setDescription', [{ name: 'Ethernet1/1' }, 'a;reload']],
  ['setRateLimit', [{ name: 'Vlan10' }, 100]],
  ['setRateLimit', [{ name: 'Ethernet1/1' }, 1.5]],
  ['setRateLimit', [{ name: 'Ethernet1/1' }, -1]],
]) {
  try { await m.nxapiDriver[fn](fakeSw, ...args); out.guard.push('ran'); } catch (e) { out.guard.push('rejected'); }
}
console.log(JSON.stringify(out));
"""

node = shutil.which("node")
if not node:
    print("node پیدا نشد؛ این آزمون بدون node اجرا نمی‌شود")
    sys.exit(1)

proc = subprocess.run(
    [node, "--input-type=module", "-e", NODE_SCRIPT, os.path.join(ROOT, "worker", "nxapi.mjs")],
    capture_output=True, text=True, timeout=60,
)
if proc.returncode != 0:
    print(proc.stderr)
    sys.exit(1)
r = json.loads(proc.stdout.strip().splitlines()[-1])

P = {p["name"]: p for p in r["ports"]}
check(len(P) == 7, "همه هفت اینترفیس خوانده شدند")
e1 = P["Ethernet1/1"]
check(e1["kind"] == "ethernet" and e1["admin_up"] is True and e1["oper_up"] is True, "Ethernet1/1 بالا")
check(e1["speed_mbps"] == 10000 and e1["mtu"] == 9216 and e1["mode"] == "access", "سرعت، MTU و حالت")
check(e1["in_bytes"] == 1000 and e1["out_bytes"] == 2000, "شمارنده عددی و رشته‌ای هر دو خوانده می‌شوند")
check(e1["in_errors"] == 3 and e1["crc_errors"] == 1, "شمارنده خطا")
check(e1["member_of"] == "port-channel10", "عضویت از فهرست eth_members با نام کوتاه")
check(P["Ethernet1/49/1"]["member_of"] == "port-channel10", "عضویت پورت بریک‌اوت")
e2 = P["Ethernet1/2"]
check(e2["admin_up"] is False and e2["oper_up"] is False, "پورت shut: مدیریتی و عملیاتی هر دو پایین")
check(e2["speed_mbps"] == 25000, "سرعت auto-speed از eth_bw")
e3 = P["Ethernet1/3"]
check(e3["admin_up"] is True and e3["oper_up"] is False and e3["oper_reason"] == "Link not connected",
      "پورت قطع ولی shut نشده، با علت")
check(e3["in_bytes"] is None, "نبود شمارنده تهی است نه صفر")
check(P["port-channel10"]["kind"] == "port-channel", "نوع پورت‌چنل")
check(P["mgmt0"]["kind"] == "mgmt" and P["mgmt0"]["in_bytes"] == 77, "mgmt0 با کلید vdc_lvl")
v10 = P["Vlan10"]
check(v10["kind"] == "vlan" and v10["admin_up"] is True and v10["oper_up"] is False, "اینترفیس ویلن با کلیدهای svi")
check(len(r["single"]) == 1 and r["single"][0]["name"] == "Ethernet1/7", "جدول تک‌ردیفی (شیء نه آرایه)")

check(r["status"].get("Ethernet1/1", {}).get("vlan") == "10", "show interface status با نام کوتاه به نام کامل")
check(r["status"].get("port-channel10", {}).get("vlan") == "trunk", "Po10 به port-channel10")

check(abs(r["res"]["cpu_percent"] - 12.5) < 1e-9, "پردازنده = ۱۰۰ منهای idle")
check(r["res"]["mem_total_bytes"] == 1000 * 1024 and r["res"]["mem_used_bytes"] == 250 * 1024, "حافظه از کیلوبایت به بایت")
check(r["resNoIdle"]["cpu_percent"] == 5, "بدون idle: user + kernel")

ver = r["ver"]
check(ver["model"] == "Nexus9000 C93180YC-FX", "مدل بدون «chassis»")
check(ver["os_version"] == "7.0(3)I7(9)", "نسخه از sys_ver_str در NX-OS قدیمی")
check(ver["uptime_sec"] == 86400 + 2 * 3600 + 3 * 60 + 4, "آپ‌تایم")

env = r["env"]
check(len(env["fans"]) == 2 and env["fans"][1]["absent"] is True and env["fans"][1]["ok"] is True,
      "فن خالی مشکل نیست و جدول فن در ریشه هم پیدا می‌شود")
check(env["psus"][1]["ok"] is False and env["psus"][0]["output_w"] == 120, "منبع تغذیه بی‌برق مشکل است؛ کلید psu_status")
check(env["temps"][1]["ok"] is False, "دمای بالای حد بحرانی مشکل است حتی با alarmstatus عادی")
check(len(env["problems"]) == 2 and env["max_temp_c"] == 95, "فهرست مشکلات و بیشترین دما")
check(r["envOk"]["problems"] == [] and len(r["envOk"]["fans"]) == 1, "محیط سالم با ردیف تک")

x49 = r["xcvr"].get("Ethernet1/49")
check(x49 and x49["rx_dbm"] == -12.5 and x49["rx_low"] is True, "ماژول چندخطی: ضعیف‌ترین lane و هشدار توان پایین")
check("Ethernet1/50" not in r["xcvr"], "ماژول نصب‌نشده رد می‌شود")
x51 = r["xcvr"].get("Ethernet1/51")
check(x51 and x51["rx_dbm"] == -4 and x51["rx_low"] is False and x51["temp_c"] == 30, "ماژول تک‌خطی بدون TABLE_lane")

check(r["delta"] == [50, 0, None, 150], "دلتا: عادی، ری‌استارت شمارنده صفر، بدون پایه تهی، رشته")
check(r["speed"] == [100000, 10000, 100, None], "تبدیل سرعت لینک")
safe = dict(r["safe"])
check(safe["Ethernet1/1"] and safe["Ethernet1/49/1"] and safe["port-channel10"], "نام‌های مجاز فرمان")
check(not any(safe[n] for n in ["mgmt0", "Vlan10", "Ethernet1/1 ;reload", "Ethernet1/1\nreload",
                                "ethernet1/1", "Ethernet1/1;shutdown"]),
      "mgmt، ویلن و هر نامی با جداکننده هرگز به خط فرمان نمی‌رسد")
check(r["full"] == ["Ethernet1/2", "port-channel100", "Ethernet1/2", "mgmt0"], "نام کوتاه به کامل")
check("۴۰۱" in r["explain"][0] and "feature nxapi" in r["explain"][1], "پیام خطای قابل اقدام")
check("دسترسی ندارد" in r["explain"][2] and "خودامضا" in r["explain"][3], "پیام تایم‌اوت و گواهی")
check(r["rejected"] == 3 and r["showRejected"] is True, "فرمان با جداکننده پیش از ارسال رد می‌شود")


# ── کشف، پشتیبان و فرمان‌های تازه ─────────────────────────────
check([x["port"] for x in r["macs"]] == ["Ethernet1/1", "port-channel10"], "جدول MAC: نام کامل؛ پورت داخلی و MAC خراب رد می‌شود")
check(r["macs"][0]["mac"] == "00:50:56:a1:00:01" and r["macs"][1]["vlan"] == "20", "MAC یکسان‌شده و ویلن عددی به متن")
check(r["arp"] == [{"ip": "10.0.0.5", "mac": "00:50:56:a1:00:01", "iface": "Ethernet1/1"}], "ARP تودرتو در vrf؛ INCOMPLETE رد می‌شود")
l0 = r["lldp"][0]
check(l0["port"] == "Ethernet1/1" and l0["sys_name"] == "web-01.example.com" and l0["caps"] == ["b", "r"], "LLDP: پورت محلی کامل و قابلیت‌ها")
c0 = r["cdp"][0]
check(c0["sys_name"] == "core-sw" and c0["mgmt_ip"] == "10.0.0.1" and c0["caps"] == ["router", "switch"], "CDP: سریال پرانتزی از نام حذف می‌شود")
check(r["mac"] == ["00:50:56:a1:00:01"] * 3 + [None, None], "MAC سیسکو، هوآوی و بافر SNMP یک شکل می‌شوند")
check(r["host"] == ["web-01", "core-sw", ""], "نام کوتاه میزبان برای مقایسه")
check(r["cfg"] == "version 9.3(8)\nhostname n9k", "پیکربندی بدون خط‌های زمان‌دار و CRLF")
check(r["pol"] == ["PANEL-RL-100M", "CUSTOMER-QOS", 100, None, None, "PANEL-RL-250M"], "policy پنل از بیگانه جداست")
D = r["desc"]
check(D[0] == {"ok": True, "value": "web-01 rack 3"} and D[5] == {"ok": True, "value": ""}, "توضیح عادی و خالی پذیرفته می‌شود")
check(not any(d["ok"] for d in D[1:5]), "توضیح با «;»، خط تازه، بیش از ۲۵۴ نویسه یا نویسه کنترلی رد می‌شود")
check(r["desc64"] is False, "سقف ۶۴ نویسه ifAlias")
check(r["guard"] == ["rejected"] * 5, "mgmt/ویلن، توضیح ناامن، سرعت اعشاری یا منفی پیش از تماس با سوییچ رد می‌شود")


check(r["block"][0] == "interface Ethernet1/1\n  description a\n  service-policy type qos input PANEL-RL-100M"
      and r["block"][1] == "interface Ethernet1/10\n  description b" and r["block"][2] == "",
      "بلوک اینترفیس از کل پیکربندی؛ Ethernet1/1 با Ethernet1/10 قاطی نمی‌شود")
check(r["snip"][0] == "policy-map type qos PANEL-RL-100M\n  class class-default\n    police cir 100 mbps bc 200 ms conform transmit violate drop\n"
      "interface Ethernet1/1\n  service-policy type qos input PANEL-RL-100M\n  service-policy type qos output PANEL-RL-100M\n",
      "تکه محدودیت: policy-map، سپس ورودی و در آخر خروجی")
check("no service-policy type qos input PANEL-RL-100M" in r["snip"][1] and r["snip"][1].endswith("output PANEL-RL-250M\n"),
      "عوض کردن سقف: policy قبلی پنل برداشته و تازه گذاشته می‌شود")
check(r["snip"][2] == "interface Ethernet1/1\n  no service-policy type qos input PANEL-RL-100M\n", "سقف صفر: فقط برداشتن")


# ── ۱ب) درایور SNMP، اجرای واقعی ───────────────────────────────

SNMP_SCRIPT = r"""
const m = await import(process.argv[1]);
const nx = await import(process.argv[2]);
const out = {};
const M = (o) => new Map(Object.entries(o));
const c64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };

// IF-MIB: پورت اترنت HC، پورت قدیمی فقط ۳۲ بیتی، LAG، ویلن، mgmt، نام تکراری
const cols = {
  ifDescr: M({ 1: 'GigabitEthernet0/1', 2: 'GigabitEthernet0/2', 3: 'Port-channel1', 4: 'Vlan10', 5: 'mgmt0', 6: 'lo', 7: 'lo', 8: 'ether1' }),
  ifName: M({ 1: 'Gi0/1', 2: 'Gi0/2', 3: 'Po1', 4: 'Vl10', 5: 'mgmt0', 6: 'lo', 7: 'lo', 8: 'ether1' }),
  ifType: M({ 1: 6, 2: 6, 3: 161, 4: 53, 5: 6, 6: 24, 7: 24, 8: 6 }),
  ifAdminStatus: M({ 1: 1, 2: 2, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1 }),
  ifOperStatus: M({ 1: 1, 2: 2, 3: 7, 4: 1, 5: 1, 6: 1, 7: 1, 8: 6 }),
  ifHighSpeed: M({ 1: 1000, 2: 1000, 3: 2000, 8: 0 }),
  ifSpeed: M({ 8: 100000000 }),
  ifHCInOctets: M({ 1: c64(9007199254740000), 2: c64(5), 3: c64(10) }),
  ifHCOutOctets: M({ 1: c64(20), 2: c64(6), 3: c64(11) }),
  ifInOctets: M({ 1: 1, 2: 1, 3: 1, 8: 4294967000 }),
  ifOutOctets: M({ 1: 1, 2: 1, 3: 1, 8: 7 }),
  ifAlias: M({ 1: Buffer.from('srv-01'), 2: Buffer.from('') }),
  ifPhysAddress: M({ 1: Buffer.from([0, 1, 2, 3, 4, 255]) }),
  ifLastChange: M({ 1: 1000 }),
  ifInErrors: M({ 1: 7 }),
};
const lag = M({ 1: 3, 2: 0, 3: 0 });
const vlans = new Map([['1', { vlan: '10', mode: 'access' }]]);
out.ports = m.buildPorts(cols, 361000, { lag, vlans });

out.kinds = [['ge-0/0/0', 6], ['ae0', 161], ['bond0', 6], ['ether1', 6], ['sfp-sfpplus1', 6], ['Vlan100', 6],
  ['fxp0', 6], ['Eth-Trunk1', 53], ['vlan20', 135], ['lo0', 24], ['swp1', 6], ['bridge', 209], ['Vlanif10', 136]].map(([n, t]) => [n, m.snmpPortKind(n, t)]);

out.num = [m.num(c64(12345678901)), m.num(Buffer.alloc(0)), m.num(42), m.num(null), m.num(Buffer.from([1, 0]))];
out.str = [m.str(Buffer.from('ab\0c ')), m.str(''), m.str(null)];

out.vendor = ['1.3.6.1.4.1.9.12.3.1.3.1812', '1.3.6.1.4.1.14988.1', '1.3.6.1.4.1.2636.1.1.1.2.1', '1.3.6.1.4.1.99999.1', null]
  .map(m.vendorOf);
out.version = [
  'Cisco NX-OS(tm) n9000, Software (n9000-dk9), Version 9.3(8), RELEASE SOFTWARE',
  'Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E4, RELEASE SOFTWARE (fc2)',
  'RouterOS CRS326-24G-2S+',
  'RouterOS 7.14.3 (stable)',
  'Juniper Networks, Inc. ex4300-48t Ethernet Switch, kernel JUNOS 21.4R3-S5.4, Build date',
  'Huawei Versatile Routing Platform Software VRP (R) software, Version 5.170 (S5735 V200R021C00SPC100)',
].map(m.versionFromDescr);

// منابع: سیسکو، استخر حافظه سیسکو، HOST-RESOURCES (میکروتیک)
out.resCisco = m.buildResources({ cpm1min: M({ 1: 20, 2: 40 }), cpmMemUsed: M({ 1: 100 }), cpmMemFree: M({ 1: 300 }) });
out.resPool = m.buildResources({ cpm5sec: M({ 1: 7 }), poolUsed: M({ 1: 1000, 2: 500 }), poolFree: M({ 1: 2500 }) });
out.resHr = m.buildResources({
  hrProcessorLoad: M({ 1: 10, 2: 30 }),
  hrStorageType: M({ 65536: '1.3.6.1.2.1.25.2.1.2', 131072: '1.3.6.1.2.1.25.2.1.4' }),
  hrStorageUnits: M({ 65536: 1024, 131072: 512 }),
  hrStorageSize: M({ 65536: 1000, 131072: 99 }),
  hrStorageUsed: M({ 65536: 250, 131072: 9 }),
});
out.resNone = m.buildResources({});

// سخت‌افزار: ENVMON، و نکسوس با FRU و حسگر سیسکو، و ENTITY-SENSOR استاندارد، و میکروتیک
out.envmon = m.buildEnvironment({
  envTempValue: M({ 1: 30, 2: 95 }), envTempThreshold: M({ 1: 80, 2: 90 }), envTempState: M({ 1: 1, 2: 1 }),
  envTempDescr: M({ 1: 'Inlet', 2: 'CPU' }),
  envFanState: M({ 1: 1, 2: 5 }), envFanDescr: M({ 1: 'Fan1', 2: 'Fan2' }),
  envSupplyState: M({ 1: 1, 2: 4 }), envSupplyDescr: M({ 1: 'PS1', 2: 'PS2' }),
});
out.fru = m.buildEnvironment({
  fanTray: M({ 534: 2, 535: 3 }), fruPower: M({ 470: 2, 471: 3, 472: 5 }),
  ciscoSensorType: M({ 21590: 8, 21591: 12 }), ciscoSensorScale: M({ 21590: 9 }), ciscoSensorPrecision: M({ 21590: 0 }),
  ciscoSensorValue: M({ 21590: 41, 21591: 1 }), ciscoSensorStatus: M({ 21590: 1 }),
  entName: M({ 534: 'Fan Module-1', 535: 'Fan Module-2', 470: 'PowerSupply-1', 471: 'PowerSupply-2', 472: 'PowerSupply-3', 21590: 'module-1 FRONT' }),
});
out.entSensor = m.buildEnvironment({
  sensorType: M({ 5: 8 }), sensorScale: M({ 5: 9 }), sensorPrecision: M({ 5: 1 }), sensorValue: M({ 5: 451 }), sensorStatus: M({ 5: 3 }),
  entName: M({ 5: 'Board' }),
});
out.mikrotik = m.buildEnvironment({ mtxrTemp: 415, mtxrCpuTemp: 0 });
out.envNone = m.buildEnvironment({});

out.sensor = [m.sensorValue(41, 9, 0), m.sensorValue(4512, 9, 2), m.sensorValue(5, 10, 0), m.sensorValue(null, 9, 0), m.sensorValue(4512, 8, 1)];

// سطح امنیت v3 از روی گذرواژه‌های داده‌شده
const lv = (o) => m.v3User({ snmp_user: 'u', ...o }).level;
out.levels = [
  lv({ snmp_auth_proto: 'sha', snmp_auth_pass: 'x'.repeat(8), snmp_priv_proto: 'aes', snmp_priv_pass: 'y'.repeat(8) }),
  lv({ snmp_auth_proto: 'sha', snmp_auth_pass: 'x'.repeat(8), snmp_priv_proto: 'none', snmp_priv_pass: '' }),
  lv({ snmp_auth_proto: 'none', snmp_auth_pass: '', snmp_priv_proto: 'none' }),
];

// شمارنده ۳۲ بیتی: سرریز به‌جای ری‌استارت
out.delta32 = [nx.counterDelta(4294967000, 200, 32), nx.counterDelta(4294967000, 200, 64), nx.counterDelta(10, 30, 32)];

out.write = [
  m.snmpDriver.canWrite({ snmp_version: '2c', snmp_write_community: '' }),
  m.snmpDriver.canWrite({ snmp_version: '2c', snmp_write_community: 'private' }),
  m.snmpDriver.canWrite({ snmp_version: '3', snmp_write: false, snmp_write_community: 'leftover' }),
  m.snmpDriver.canWrite({ snmp_version: '3', snmp_write: true }),
  m.snmpDriver.canSave({ vendor: 'cisco' }), m.snmpDriver.canSave({ vendor: 'mikrotik' }),
];

// کشف با SNMP: LLDP با شماره پورت محلی جدا، CDP، جدول MAC از Q-BRIDGE و ARP
const nameOf = new Map([['1', 'Gi0/1'], ['2', 'Gi0/2'], ['3', 'Po1']]);
out.disc = m.buildDiscovery({
  lldpLocPortId: M({ 5: Buffer.from('Gi0/2') }),
  lldpRemSysName: M({ '0.1.1': Buffer.from('web-01'), '0.5.2': Buffer.from('db-01'), '0.9.3': Buffer.from('ghost') }),
  lldpRemPortId: M({ '0.1.1': Buffer.from([0, 0x50, 0x56, 0xa1, 0, 1]), '0.5.2': Buffer.from('eth0') }),
  cdpCacheDeviceId: M({ '3.1': Buffer.from('core(FDO1)') }),
  cdpCacheAddress: M({ '3.1': Buffer.from([10, 0, 0, 1]) }),
  cdpCacheDevicePort: M({ '3.1': Buffer.from('Ethernet1/1') }),
  basePortIfIndex: M({ 11: 1, 12: 2 }),
  qFdbPort: M({ '10.0.80.86.161.0.1': 11, '20.0.80.86.161.0.2': 12, '10.0.80.86.161.0.3': 0 }),
  arpPhys: M({ '1.10.0.0.5': Buffer.from([0, 0x50, 0x56, 0xa1, 0, 1]), '1.10.0.0.9': Buffer.alloc(6) }),
}, nameOf);
out.osf = ['Cisco NX-OS(tm) n9000, Software (n9000-dk9), Version 9.3(8)', 'Cisco IOS Software [Cupertino], Catalyst L3 Switch Software, IOS-XE', 'Cisco IOS Software, C2960X Software', 'RouterOS'].map(m.osFamilyOf);
const vb = (vbs) => vbs.map((v) => [v.oid.split('.').slice(-2)[0], v.type, Buffer.isBuffer(v.value) ? [...v.value] : v.value]);
out.cc = {
  sftp: vb(m.copyVarbinds(7, { protocol: 'sftp', source: 1, dest: 4, server: '10.0.0.10', fileName: '/files/pm-a.cfg', user: 'u', pass: 'p' }, 'rev1')),
  tftp: vb(m.copyVarbinds(7, { protocol: 'tftp', source: 4, dest: 1, server: '10.0.0.10', fileName: 'pm-b.cfg' }, 'legacy')),
  save: vb(m.copyVarbinds(7, { source: 4, dest: 3 }, null)),
};
const cap = (o) => [m.snmpDriver.canBackup(o), m.snmpDriver.canRateLimit(o)];
const nxs = { vendor: 'cisco', os_family: 'nxos', snmp_version: '3', snmp_write: true, config_transfer: 'sftp' };
out.cap = [cap(nxs), cap({ ...nxs, config_transfer: 'none' }), cap({ ...nxs, snmp_write: false }), cap({ ...nxs, os_family: 'ios' }), cap({ ...nxs, vendor: 'juniper' }),
  cap({ ...nxs, snmp_version: '2c', snmp_write: false, snmp_write_community: 'private', config_transfer: 'tftp' })];
out.discBridge = m.buildDiscovery({ dFdbPort: M({ '0.80.86.161.0.9': 2 }) }, nameOf).macs;
console.log(JSON.stringify(out));
"""

proc = subprocess.run(
    [node, "--input-type=module", "-e", SNMP_SCRIPT,
     os.path.join(ROOT, "worker", "snmp.mjs"), os.path.join(ROOT, "worker", "nxapi.mjs")],
    capture_output=True, text=True, timeout=60, cwd=ROOT,
)
if proc.returncode != 0:
    print(proc.stderr)
    sys.exit(1)
r = json.loads(proc.stdout.strip().splitlines()[-1])

SP = {p["name"]: p for p in r["ports"]}
check(set(SP) == {"Gi0/1", "Gi0/2", "Po1", "Vl10", "mgmt0", "lo", "lo #7", "ether1"},
      "نام از ifName؛ نام تکراری شماره می‌گیرد تا کلید یکتا نشکند: %s" % sorted(SP))
g1 = SP["Gi0/1"]
check(g1["kind"] == "ethernet" and g1["if_index"] == 1 and g1["counter_bits"] == 64, "Gi0/1: اترنت، ifIndex و شمارنده ۶۴ بیتی")
check(g1["in_bytes"] == 9007199254740000 and g1["out_bytes"] == 20, "Counter64 بزرگ از بافر خوانده شد")
check(g1["member_of"] == "Po1" and g1["vlan"] == "10" and g1["mode"] == "access", "عضویت LAG و ویلن")
check(g1["description"] == "srv-01" and g1["mac"] == "00:01:02:03:04:ff" and g1["in_errors"] == 7, "توضیح، MAC و خطا")
check(g1["speed_mbps"] == 1000 and g1["last_flap"] and g1["last_flap"].endswith("پیش"), "سرعت و آخرین تغییر")
g2 = SP["Gi0/2"]
check(g2["admin_up"] is False and g2["oper_up"] is False and g2["oper_reason"] == "Administratively down", "پورت shut")
check(SP["Po1"]["kind"] == "port-channel" and SP["Po1"]["oper_reason"] == "lowerLayerDown", "پورت‌چنل و علت lowerLayerDown")
check(SP["Vl10"]["kind"] == "vlan" and SP["mgmt0"]["kind"] == "mgmt" and SP["lo"]["kind"] == "loopback", "ویلن، mgmt و لوپ‌بک")
e1 = SP["ether1"]
check(e1["counter_bits"] == 32 and e1["in_bytes"] == 4294967000, "بدون ifHC: شمارنده ۳۲ بیتی")
check(e1["speed_mbps"] == 100 and e1["oper_reason"] == "notPresent", "ifHighSpeed صفر ← ifSpeed؛ notPresent")

K = dict(r["kinds"])
check(K["ge-0/0/0"] == "ethernet" and K["ae0"] == "port-channel" and K["bond0"] == "port-channel", "نام‌های جونیپر و لینوکس")
check(K["ether1"] == "ethernet" and K["sfp-sfpplus1"] == "ethernet" and K["bridge"] != "ethernet", "نام‌های میکروتیک")
check(K["Vlan100"] == "vlan" and K["vlan20"] == "vlan" and K["fxp0"] == "mgmt" and K["Eth-Trunk1"] == "port-channel",
      "ویلن، مدیریت جونیپر و ترانک هوآوی")
check(K["lo0"] == "loopback" and K["swp1"] == "ethernet" and K["Vlanif10"] == "vlan", "لوپ‌بک، پورت Cumulus و ویلن هوآوی")

check(r["num"] == [12345678901, 0, 42, None, 256], "تبدیل عدد از Counter64، عدد و تهی")
check(r["str"] == ["abc", None, None], "تبدیل متن")
check(r["vendor"] == ["cisco", "mikrotik", "juniper", "enterprise-99999", None], "برند از sysObjectID")
check(r["version"] == ["9.3(8)", "15.2(7)E4", None, "7.14.3", "21.4R3-S5.4", "5.170"], "نسخه از sysDescr: %s" % r["version"])

check(r["resCisco"]["cpu_percent"] == 30 and r["resCisco"]["mem_used_bytes"] == 100 * 1024
      and r["resCisco"]["mem_total_bytes"] == 400 * 1024, "منابع سیسکو (کیلوبایت)")
check(r["resPool"]["cpu_percent"] == 7 and r["resPool"]["mem_total_bytes"] == 4000, "استخر حافظه سیسکو (بایت)")
check(r["resHr"]["cpu_percent"] == 20 and r["resHr"]["mem_total_bytes"] == 1024000 and r["resHr"]["mem_used_bytes"] == 256000,
      "HOST-RESOURCES: فقط ردیف RAM")
check(r["resNone"] is None, "بدون MIB منابع: تهی، نه صفر")

em = r["envmon"]
check([t["ok"] for t in em["temps"]] == [True, False], "ENVMON: دمای بالای آستانه مشکل است")
check(em["fans"][1]["absent"] is True and em["fans"][1]["ok"] is True, "ENVMON: فن notPresent مشکل نیست")
check(em["psus"][1]["ok"] is False and len(em["problems"]) == 2, "ENVMON: تغذیه shutdown مشکل است")
fr = r["fru"]
check([f["ok"] for f in fr["fans"]] == [True, False] and fr["fans"][1]["name"] == "Fan Module-2", "FRU: سینی فن پایین، با نام ENTITY")
check([p["ok"] for p in fr["psus"]] == [True, True, False], "FRU: offAdmin عمدی است، offEnvPower مشکل")
check(len(fr["temps"]) == 1 and fr["temps"][0]["current"] == 41, "حسگر سیسکو: فقط نوع سلسیوس")
es = r["entSensor"]
check(es["temps"][0]["current"] == 45.1 and es["temps"][0]["ok"] is False, "ENTITY-SENSOR: دقت یک رقم اعشار، nonoperational مشکل است")
check(r["mikrotik"]["temps"][0]["current"] == 41.5 and len(r["mikrotik"]["temps"]) == 1, "میکروتیک: دمای برد؛ صفر نادیده")
check(r["envNone"] is None, "بدون MIB سخت‌افزار: تهی")
check(r["sensor"][:4] == [41, 45.12, 5000, None] and abs(r["sensor"][4] - 0.4512) < 1e-9, "مقیاس و دقت حسگر")

check(r["levels"] == [3, 2, 1], "سطح امنیت v3: authPriv، authNoPriv، noAuthNoPriv")
check(r["delta32"] == [496, 0, 20], "شمارنده ۳۲ بیتی سرریز می‌شود، ۶۴ بیتی ری‌استارت حساب می‌شود")
check(r["write"] == [False, True, False, True, True, False],
      "اجازه نوشتن: v2c فقط با کامیونیتی نوشتنی، v3 فقط با تیک؛ ذخیره فقط سیسکو")


dn = r["disc"]["neighbors"]
check([(n["port"], n["proto"], n["sys_name"]) for n in dn] == [("Gi0/1", "lldp", "web-01"), ("Gi0/2", "lldp", "db-01"), ("Po1", "cdp", "core")],
      "SNMP LLDP: پورت محلی از ifIndex یا lldpLocPortId؛ پورت ناشناخته رد؛ CDP بی سریال")
check(dn[0]["port_id"] == "00:50:56:a1:00:01" and dn[1]["port_id"] == "eth0" and dn[2]["mgmt_ip"] == "10.0.0.1",
      "شناسه پورت MAC یا متن؛ آی‌پی مدیریت CDP")
check(r["disc"]["macs"] == [{"port": "Gi0/1", "mac": "00:50:56:a1:00:01", "vlan": "10"}, {"port": "Gi0/2", "mac": "00:50:56:a1:00:02", "vlan": "20"}],
      "Q-BRIDGE: پورت پل به ifIndex، ویلن از اندیس؛ پورت صفر رد می‌شود")
check(r["discBridge"] == [{"port": "Gi0/2", "mac": "00:50:56:a1:00:09", "vlan": None}], "BRIDGE-MIB بدون basePort: شماره پورت پل همان ifIndex")
check(r["disc"]["arp"] == [{"ip": "10.0.0.5", "mac": "00:50:56:a1:00:01", "iface": "Gi0/1"}], "ARP از ipNetToMedia؛ MAC صفر رد می‌شود")


check(r["osf"] == ["nxos", "iosxe", "ios", None], "خانواده سیستم‌عامل از sysDescr")
C = r["cc"]
check([c[0] for c in C["sftp"]] == ["2", "3", "4", "15", "16", "6", "7", "8"] and C["sftp"][0][2] == 5 and C["sftp"][4][2] == [10, 0, 0, 10],
      "ccCopy با SFTP: پروتکل ۵، آدرس Rev1 چهاربایتی، نام فایل، کاربر و گذرواژه")
check([c[0] for c in C["tftp"]] == ["2", "3", "4", "5", "6"] and C["tftp"][0][2] == 1 and C["tftp"][3][2] == "10.0.0.10",
      "ccCopy با TFTP: آدرس قدیمی IpAddress، بی‌کاربر و گذرواژه")
check([c[0] for c in C["save"]] == ["3", "4"], "ذخیره startup-config همان دو ستون قبلی")
check(r["cap"] == [[True, True], [False, False], [False, False], [True, False], [False, False], [True, True]],
      "SNMP: پشتیبان فقط سیسکو با روش انتقال و اجازه نوشتن؛ محدودیت فقط نکسوس: %s" % r["cap"])


# ── ۱ج) پیشنهاد اتصال، تفاوت و پوشاندن رازها ─────────────────

MATCH_SCRIPT = r"""
const { suggestLinks } = await import(process.argv[1]);
const servers = [
  { id: 1, name: 'web-01', hostname: 'web-01.example.com', main_ip: '10.0.0.5', ips: ['10.0.0.50'] },
  { id: 2, name: 'db-01', hostname: null, main_ip: '10.0.0.6', ips: [] },
  { id: 3, name: 'web-1', hostname: null, main_ip: '10.0.0.7', ips: [] },
  { id: 4, name: 'kvm-node', hostname: 'kvm-node', main_ip: '10.0.0.8', ips: [] },
];
const arp = [
  { ip: '10.0.0.6', mac: 'aa:aa:aa:aa:aa:06' },
  { ip: '10.0.0.50', mac: 'aa:aa:aa:aa:aa:50' },
  { ip: '10.0.0.7', mac: 'aa:aa:aa:aa:aa:07' },
];
const base = { kind: 'ethernet', server_id: null, is_protected: false, member_of: null, mac_count: 1, macs: [], neighbors: [],
  description: null, suggest_dismissed_server_id: null };
const mac = (x) => [{ mac: x }];
const ports = [
  // LLDP با نام کامل دامنه؛ S در LLDP یعنی Station نه Switch
  { ...base, id: 10, neighbors: [{ proto: 'lldp', sys_name: 'WEB-01.example.com', caps: ['s'] }] },
  // MAC → ARP → آی‌پی دوم سرور
  { ...base, id: 11, macs: mac('aa:aa:aa:aa:aa:50') },
  { ...base, id: 12, macs: mac('aa:aa:aa:aa:aa:06') },
  // توضیح: web-1 نباید با web-10 جور شود
  { ...base, id: 13, description: 'uplink web-10' },
  { ...base, id: 14, description: 'srv web-1 rack2' },
  // دو سرور: مبهم
  { ...base, id: 15, mac_count: 2, macs: [{ mac: 'aa:aa:aa:aa:aa:06' }, { mac: 'aa:aa:aa:aa:aa:07' }] },
  // شبیه آپلینک: MAC زیاد، یا همسایه سوییچ ناشناخته
  { ...base, id: 16, mac_count: 40, macs: mac('aa:aa:aa:aa:aa:06') },
  { ...base, id: 17, macs: mac('aa:aa:aa:aa:aa:06'), neighbors: [{ proto: 'lldp', sys_name: 'core', caps: ['b', 'r'] }] },
  { ...base, id: 18, macs: mac('aa:aa:aa:aa:aa:06'), neighbors: [{ proto: 'cdp', sys_name: 'core', caps: [] }] },
  // نود مجازی‌سازی: MAC زیاد ولی نامش در LLDP
  { ...base, id: 19, mac_count: 60, neighbors: [{ proto: 'lldp', sys_name: 'kvm-node', caps: ['b', 'r'] }] },
  // رد شده، وصل شده، محافظت‌شده، عضو پورت‌چنل، ویلن
  { ...base, id: 20, macs: mac('aa:aa:aa:aa:aa:06'), suggest_dismissed_server_id: 2 },
  { ...base, id: 21, macs: mac('aa:aa:aa:aa:aa:06'), server_id: 2 },
  { ...base, id: 22, macs: mac('aa:aa:aa:aa:aa:06'), is_protected: true },
  { ...base, id: 23, macs: mac('aa:aa:aa:aa:aa:06'), member_of: 'port-channel1' },
  { ...base, id: 24, macs: mac('aa:aa:aa:aa:aa:06'), kind: 'vlan' },
  // نشانه قوی بر توضیح کهنه مقدم است
  { ...base, id: 25, macs: mac('aa:aa:aa:aa:aa:06'), description: 'web-01' },
];
const res = suggestLinks({ ports, servers, arp });
console.log(JSON.stringify(Object.fromEntries([...res].map(([k, v]) => [k, v.server_id]))));
"""

proc = subprocess.run(
    [node, "--input-type=module", "-e", MATCH_SCRIPT, os.path.join(ROOT, "worker", "switch-match.mjs")],
    capture_output=True, text=True, timeout=60,
)
if proc.returncode != 0:
    print(proc.stderr)
    sys.exit(1)
sg = json.loads(proc.stdout.strip().splitlines()[-1])
check(sg.get("10") == 1, "LLDP: نام کامل دامنه با نام سرور جور می‌شود (S در LLDP ایستگاه است)")
check(sg.get("11") == 1 and sg.get("12") == 2, "MAC روی پورت ← ARP ← آی‌پی اصلی یا دوم سرور")
check("13" not in sg and sg.get("14") == 3, "توضیح با مرز کلمه: web-1 با web-10 جور نمی‌شود")
check("15" not in sg, "دو سرور روی یک پورت: پیشنهادی نیست")
check(not any(k in sg for k in ["16", "17", "18"]), "MAC زیاد یا همسایه سوییچ/CDP ناشناخته: آپلینک، پیشنهادی نیست")
check(sg.get("19") == 4, "نود مجازی‌سازی با MAC زیاد با نام LLDP پیدا می‌شود")
check(not any(k in sg for k in ["20", "21", "22", "23", "24"]), "رد شده، وصل، محافظت‌شده، عضو پورت‌چنل و ویلن پیشنهاد نمی‌گیرند")
check(sg.get("25") == 2, "نشانه قوی (ARP) بر توضیح دستی مقدم است")

# کتابخانه‌های تایپ‌اسکریپتی با کامپایلر خود پروژه ترجمه و اجرا می‌شوند
TS_SCRIPT = r"""
const { createRequire } = await import('node:module');
const fs = await import('node:fs');
const require = createRequire(process.argv[1] + '/package.json');
const ts = require('typescript');
const load = async (rel) => {
  const src = fs.readFileSync(process.argv[1] + '/' + rel, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
};
const d = await load('lib/diff.ts');
const mk = await load('lib/config-mask.ts');
const out = {};
const A = 'a\nb\nc\nd\ne\nf\ng';
const B = 'a\nb\nX\nd\ne\nf\ng\nh';
out.diff = d.diffLines(A, B).map((l) => l.op + l.text);
out.same = d.diffLines(A, A).every((l) => l.op === '=');
out.stats = d.diffStats(d.diffLines(A, B));
// بازسازی: خط‌های قدیم و تازه از دل تفاوت درمی‌آیند — روی متن تصادفی
let rebuilt = true;
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let t = 0; t < 200; t++) {
  const gen = () => Array.from({ length: Math.floor(rnd() * 30) }, () => 'l' + Math.floor(rnd() * 6)).join('\n');
  const x = gen(), y = gen();
  const ls = d.diffLines(x, y);
  const old = ls.filter((l) => l.op !== '+').map((l) => l.text).join('\n');
  const neu = ls.filter((l) => l.op !== '-').map((l) => l.text).join('\n');
  if (old !== x || neu !== y) { rebuilt = false; break; }
}
out.rebuilt = rebuilt;
const big = Array.from({ length: 5000 }, (_, i) => 'line ' + i).join('\n');
const big2 = big.replace('line 2500', 'line 2500 changed');
const h = d.diffHunks(d.diffLines(big, big2), 3);
out.hunks = [h.hunks.length, h.hunks[0].lines.length, h.hunks[0].skippedBefore, h.skippedAfter];
const t0 = Date.now();
d.diffLines(big, Array.from({ length: 5000 }, (_, i) => 'other ' + i).join('\n'));
out.fast = Date.now() - t0 < 5000;

const cfg = [
  'username admin password 5 $5$abc$hash  role network-admin',
  'snmp-server user mon network-operator auth sha 0xAAAA priv aes-128 0xBBBB localizedkey',
  'snmp-server user mon2 network-operator auth md5 0xCCCC priv 0xDDDD localizedkey',
  'snmp-server community s3cret group network-operator',
  'snmp-server host 10.0.0.9 traps version 2c trapcomm',
  'tacacs-server key 7 "tackey"',
  'tacacs-server host 10.0.0.2 key 7 "hostkey"',
  'radius-server key 7 radkey',
  'ip ospf message-digest-key 1 md5 3 ospfkey',
  'ntp authentication-key 1 md5 ntpkey 7',
  'key chain KC1',
  'key-string 7 kskey',
  'neighbor 10.0.0.1 password 3 bgpkey',
  'hsrp 10',
  'authentication text hsrpkey',
  '!Command: password in a comment stays',
  'no password strength-check',
  'hostname n9k',
].join('\n');
const masked = mk.maskConfig(cfg);
out.masked = masked.text.split('\n');
out.maskedCount = masked.masked;
out.leak = ['$5$abc$hash', '0xAAAA', '0xBBBB', '0xCCCC', '0xDDDD', 's3cret', 'trapcomm', 'tackey', 'hostkey', 'radkey', 'ospfkey',
  'ntpkey', 'kskey', 'bgpkey', 'hsrpkey'].filter((x) => masked.text.includes(x));
out.idem = mk.maskConfig(masked.text).text === masked.text;
console.log(JSON.stringify(out));
"""

proc = subprocess.run([node, "--input-type=module", "-e", TS_SCRIPT, ROOT], capture_output=True, text=True, timeout=120, cwd=ROOT)
if proc.returncode != 0:
    print(proc.stderr)
    sys.exit(1)
r = json.loads(proc.stdout.strip().splitlines()[-1])
check(r["diff"] == ["=a", "=b", "-c", "+X", "=d", "=e", "=f", "=g", "+h"], "تفاوت خط‌به‌خط: %s" % r["diff"])
check(r["same"] is True and r["stats"] == {"added": 2, "removed": 1}, "متن یکسان بی‌تفاوت؛ شمارش اضافه و حذف")
check(r["rebuilt"] is True, "روی ۲۰۰ جفت متن تصادفی، هر دو نسخه از دل تفاوت بازسازی می‌شوند")
check(r["hunks"] == [1, 8, 2497, 2496], "فقط تکه تغییرکرده (حذف و اضافه) با سه خط اطراف: %s" % r["hunks"])
check(r["fast"] is True, "دو پیکربندی کاملا متفاوت پنج‌هزارخطی زیر پنج ثانیه")
check(r["leak"] == [], "هیچ رازی پس از پوشاندن دیده نمی‌شود: %s" % r["leak"])
M_ = r["masked"]
check(M_[0].startswith("username admin password 5 ••••••") and M_[0].endswith("role network-admin"), "نوع رمز و بقیه خط می‌ماند")
check(M_[10] == "key chain KC1" and M_[15] == "!Command: password in a comment stays", "key chain و توضیح «!» دست نمی‌خورد")
check(M_[16] == "no password strength-check" and M_[17] == "hostname n9k", "password strength-check و خط عادی دست نمی‌خورد")
check(r["maskedCount"] == 15 and r["idem"] is True, "شمار رازهای پوشیده؛ پوشاندن دوباره چیزی را عوض نمی‌کند (%s)" % r["maskedCount"])


# ── ۱د) سرور TFTP ورکر، با کلاینت واقعی روی UDP ────────────────

TFTP_SCRIPT = r"""
const dgram = (await import('node:dgram')).default;
process.env.SWITCH_TFTP_PORT = '0';
const t = await import(process.argv[1]);
""" + r"""function tftp({ host, port, op, file, data, mode = 'octet', dropFirstAck = false, dropFirstData = false }) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    const req = Buffer.concat([Buffer.from([0, op === 'get' ? 1 : 2]), Buffer.from(`${file}\0${mode}\0`, 'latin1')]);
    let peer = null; let chunks = []; let sent = 0; let block = 0; let droppedAck = false; let droppedData = false;
    const t = setTimeout(() => { s.close(); reject(new Error('timeout')); }, 20000);
    let fin = false; const done = (v) => { if (fin) return; fin = true; clearTimeout(t); s.close(); resolve(v); };
    s.on('message', (m, r) => {
      peer = r;
      const opc = m.readUInt16BE(0); const b = m.readUInt16BE(2);
      if (opc === 5) { clearTimeout(t); s.close(); return reject(new Error('ERR ' + b + ' ' + m.subarray(4).toString().replace(/\0/g, ''))); }
      if (op === 'get' && opc === 3) {
        if (b === block + 1) { chunks.push(m.subarray(4)); block = b; }
        if (dropFirstAck && !droppedAck) { droppedAck = true; return; }
        const ack = Buffer.alloc(4); ack.writeUInt16BE(4, 0); ack.writeUInt16BE(b, 2); s.send(ack, r.port, r.address);
        if (m.length - 4 < 512 && b === block) done(Buffer.concat(chunks));
      } else if (op === 'put' && opc === 4) {
        if (b !== sent) return;
        const start = b * 512; if (start > data.length) return done(true);
        const chunk = data.subarray(start, start + 512);
        const pkt = Buffer.alloc(4 + chunk.length); pkt.writeUInt16BE(3, 0); pkt.writeUInt16BE(b + 1, 2); chunk.copy(pkt, 4);
        sent = b + 1;
        if (dropFirstData && !droppedData && b === 1) { droppedData = true; setTimeout(() => s.send(pkt, r.port, r.address), 2500); return; }
        s.send(pkt, r.port, r.address);
        if (chunk.length < 512) setTimeout(() => done(true), 50);
      }
    });
    s.send(req, port, host);
  });
}
""" + r"""
await t.ensureTftp(0);
const port = t.tftpAddress().port;
const out = {};
const big = Array.from({ length: 300 }, (_, i) => `interface Ethernet1/${i}`).join('\n') + '\n';
const o = await t.offerFile('tftp', {}, big);
out.get = (await tftp({ host: '127.0.0.1', port, op: 'get', file: o.fileName, dropFirstAck: true })).toString() === big;
out.getAscii = (await tftp({ host: '127.0.0.1', port, op: 'get', file: '/x/' + o.fileName, mode: 'netascii' })).toString() === big.replace(/\n/g, '\r\n');
out.unknown = await tftp({ host: '127.0.0.1', port, op: 'get', file: 'pm-guess.cfg' }).then(() => 'ok', (e) => e.message);
const e = await t.expectFile('tftp', {});
out.readSlot = await tftp({ host: '127.0.0.1', port, op: 'get', file: e.fileName }).then(() => 'ok', (e2) => e2.message);
out.putOther = await tftp({ host: '127.0.0.1', port, op: 'put', file: 'pm-other.cfg', data: Buffer.from('x') }).then(() => 'ok', (e2) => e2.message);
await tftp({ host: '127.0.0.1', port, op: 'put', file: e.fileName, data: Buffer.from(big), dropFirstData: true });
out.put = (await e.read()) === big;
await o.cleanup();
out.afterCleanup = await tftp({ host: '127.0.0.1', port, op: 'get', file: o.fileName }).then(() => 'ok', (e2) => e2.message);
out.netascii = [t.toNetascii(Buffer.from('a\nb\rc')).toString('latin1'), t.fromNetascii(Buffer.from('a\r\nb\r\0c', 'latin1')).toString()];
t.closeTftp();
console.log(JSON.stringify(out));
process.exit(0);
"""

proc = subprocess.run([node, "--input-type=module", "-e", TFTP_SCRIPT, os.path.join(ROOT, "worker", "transfer.mjs")],
                      capture_output=True, text=True, timeout=120)
if proc.returncode != 0:
    print(proc.stderr)
    sys.exit(1)
r = json.loads(proc.stdout.strip().splitlines()[-1])
check(r["get"] and r["getAscii"], "TFTP: دانلود چندبلوکی با ACK گم‌شده، و netascii با مسیر")
check(r["unknown"].startswith("ERR 1") and r["readSlot"].startswith("ERR 1"), "TFTP: نام ناشناخته یا جای آپلود قابل دانلود نیست")
check(r["putOther"].startswith("ERR 2"), "TFTP: آپلود فقط به نام تصادفی که پنل منتظرش است")
check(r["put"], "TFTP: آپلود چندبلوکی با بلوک دیررسیده")
check(r["afterCleanup"].startswith("ERR 1"), "TFTP: فایل پس از کار دیگر در دسترس نیست")
check(r["netascii"] == ["a\r\nb\r\0c", "a\nb\rc"], "تبدیل netascii دو طرف")


# ── ۲) قاعده‌ها در کد واقعی ──────────────────────────────────────

actions = read("app/api/switch-actions/route.ts")
post = actions[actions.index("export async function POST"):]
check("requireAdmin()" in post, "shut/no shut فقط از حساب مدیر")
check("is_protected" in post and "'ethernet', 'port-channel'" in post, "مسیر API محافظت و نوع پورت را بررسی می‌کند")

sw = read("worker/switches.mjs")
run = sw[sw.index("async function runAction"):]
check("['ethernet', 'port-channel'].includes(port.kind)" in run, "ورکر نوع پورت را پیش از فرمان دوباره می‌سنجد (mgmt و ویلن هرگز)")
check("a.action === 'shutdown' && port.is_protected" in run, "ورکر محافظت را هنگام اجرا دوباره بررسی می‌کند")
check("driver.canWrite(sw)" in run, "ورکر اجازه نوشتن سوییچ را هنگام اجرا دوباره بررسی می‌کند")
check(run.index("driver.setAdmin(") < run.index("driver.readPort("), "پس از فرمان، وضعیت واقعی از سوییچ خوانده می‌شود")

nx = read("worker/nxapi.mjs")
set_nx = nx[nx.index("async setAdmin(sw, port, up)"):]
check(set_nx.index("isSafePortName(port.name)") < set_nx.index("configure("), "NX-API: نام پورت پیش از خط فرمان سنجیده می‌شود")

sn = read("worker/snmp.mjs")
assert_fn = sn[sn.index("async function assertIfName"):]
check("names.includes(expected)" in assert_fn[:assert_fn.index("\n}\n")] and "throw" in assert_fn[:assert_fn.index("\n}\n")],
      "SNMP: assertIfName نام همان ifIndex را با نام پورت مقایسه و در ناهمخوانی خطا می‌دهد")
for meth, oid in [("async setAdmin(sw, port, up)", "O.ifAdminStatus"), ("async setDescription(sw, port, text)", "O.ifAlias")]:
    body = sn[sn.index(meth):]
    check(body.index("assertIfName(") < body.index(oid), "SNMP %s: پیش از SET نام ifIndex سنجیده می‌شود" % meth.split("(")[0])
check("session.on('error'" in sn, "SNMP: خطای سوکت UDP ورکر را نمی‌کشد")

apply_ = sw[sw.index("export async function applySwitchTrafficToServers"):]
check("SUM(h.out_bytes)   AS rx_bytes" in apply_ and "SUM(h.in_bytes)    AS tx_bytes" in apply_,
      "جهت: خروجی سوییچ دانلود سرور است، ورودی سوییچ آپلودش")
check("pc.name = p.member_of" in sw, "عضو پورت‌چنل شمرده‌شده دو بار حساب نمی‌شود")

idx = read("worker/index.mjs")
order = [idx.index(s) for s in ["rollupSwitchHourly(3)", "rollupHourly(3)", "applySwitchTrafficToServers(3)", "rollupDaily(3)"]]
check(order == sorted(order), "ترتیب تجمیع: پورت، سرور، جایگزینی، روزانه")

routes = read("app/api/switches/route.ts")
check(routes.count("await requireAdmin()") == 3, "افزودن، ویرایش و حذف سوییچ فقط مدیر")
pub = read("lib/switches.ts")
pub_cols = pub.split("export const SWITCH_PUBLIC_COLUMNS")[1]
SECRETS = ["password", "snmp_community", "snmp_write_community", "snmp_auth_pass", "snmp_priv_pass"]
import re as _re
leaks = [c for c in SECRETS if _re.search(r"w\.%s\b(?!, '')" % c, pub_cols)]
check(not leaks, "هیچ رازی (گذرواژه، کامیونیتی، گذرواژه v3) در ستون‌های عمومی سوییچ نیست: %s" % leaks)
for c in SECRETS:
    check("COALESCE(w.%s, '') <> ''" % c in pub_cols, "فقط «تنظیم شده یا نه» برای %s" % c)
check("SWITCH_PUBLIC_COLUMNS" in routes and "SWITCH_PUBLIC_COLUMNS" in read("app/api/switches/[id]/route.ts"),
      "فهرست و جزئیات سوییچ فقط ستون‌های عمومی را برمی‌گردانند")
check("NOTHING_STORED" in routes and "targetChanged" in routes, "با تغییر مقصد، رازها باید دوباره وارد شوند")
check("رازها باید دوباره وارد شوند" in routes, "تغییر آدرس بدون راز تازه پذیرفته نمی‌شود")

mig = read("db/migrations/046_switches.sql")
check("switch_port_id" in mig and "switch_id INT REFERENCES switches" in mig, "رویداد کلید سوییچ و پورت دارد")
check("CHECK (NOT count_traffic" not in mig, "CHECK شمارش ترافیک حذف سرور را نمی‌شکند")

inc = read("worker/incidents.mjs")
check(inc.count("switch_port_id IS NOT DISTINCT FROM $5") == 2, "باز و بسته کردن رویداد کلید پورت را هم می‌سنجد")


# فرمان‌های تازه و پشتیبان پیکربندی
check("cleanDescription(body.value" in post and "can_rate_limit" in post and "port.is_protected" in post[post.index("action === 'rate_limit'"):],
      "API: توضیح پاک‌سازی می‌شود؛ محدودیت فقط NX-API و نه روی پورت محافظت‌شده")
check("can_backup" in post[post.index("async function queueBackup"):], "API: پشتیبان‌گیری فقط برای سوییچی که پشتیبانی می‌کند")
check(run.index("driver.canWrite(sw)") < run.index("runDescription(") and run.index("driver.canWrite(sw)") < run.index("runRateLimit("),
      "ورکر: نوع پورت و اجازه نوشتن پیش از توضیح و محدودیت سنجیده می‌شود")
rl = sw[sw.index("async function runRateLimit"):]
check(rl.index("port.is_protected") < rl.index("driver.setRateLimit("), "ورکر: پورت محافظت‌شده محدود نمی‌شود")
check(rl.index("driver.setRateLimit(") < rl.index("driver.readRateLimit("), "ورکر: پس از محدودیت، وضعیت واقعی از running-config خوانده می‌شود")
set_rl = nx[nx.index("async setRateLimit(sw, port, mbps)"):]
check(set_rl.index("rateFromPolicy(current[dir]) === null") < set_rl.index("configure("),
      "NX-API: policy بیگانه روی پورت پیش از هر تغییری فرمان را رد می‌کند")
set_d = nx[nx.index("async setDescription(sw, port, text)"):]
check(set_d.index("isSafePortName(port.name)") < set_d.index("configure(") and set_d.index("cleanDescription(") < set_d.index("configure("),
      "NX-API: نام پورت و متن توضیح پیش از خط فرمان سنجیده می‌شوند")

for rel in ["app/api/switches/[id]/configs/route.ts", "app/api/switches/[id]/configs/[cid]/route.ts"]:
    check("await requireAdmin()" in read(rel) and "requireUser" not in read(rel), "پیکربندی سوییچ فقط مدیر: %s" % rel)
cfg_route = read("app/api/switches/[id]/configs/[cid]/route.ts")
check("reveal ? { text: row.config, masked: 0 } : maskConfig(row.config)" in cfg_route, "متن پیکربندی پیش‌فرض پوشیده است، دانلود هم")
check("maskLine(l.text)" in cfg_route, "تفاوت دو نسخه هم خط‌به‌خط پوشیده می‌شود")
check("config" not in read("app/api/switches/[id]/configs/route.ts").split("FROM switch_configs")[0].split("SELECT id, taken_at")[1],
      "فهرست نسخه‌ها متن پیکربندی را برنمی‌گرداند")
check(not _re.search(r"\bconfig\b", pub_cols), "ستون‌های عمومی سوییچ متن پیکربندی ندارند")
rep = read("app/api/switches/report/route.ts")
check("/^[=+\\-@\\t\\r]/" in rep and "`'${s}`" in rep, "CSV گزارش: فرمول اکسل در توضیح پورت خنثی می‌شود")
ports_api = read("app/api/switch-ports/route.ts")
check("alert_util    = COALESCE($7, alert_util)" in ports_api, "فرم قدیمی بدون alert_util مقدار فعلی را پاک نمی‌کند")
mig48 = read("db/migrations/048_switch_insight.sql")
check("'description', 'rate_limit', 'backup'" in mig48 and "switch_actions_one_backup" in mig48, "۰۴۸: فرمان‌های تازه و یک پشتیبان‌گیری باز برای هر سوییچ")
check(mig48.count("IF NOT EXISTS") >= 20 and "DROP CONSTRAINT IF EXISTS switch_actions_action_check" in mig48, "۰۴۸ دوباره‌اجراپذیر است")
check("'([0-9]+)'" in read("app/api/switches/[id]/route.ts") and "(\\d+)" not in read("app/api/switches/[id]/route.ts"),
      "مرتب‌سازی عددی پورت: \\d در رشته الگویی جاوااسکریپت به d تبدیل می‌شد")


# انتقال پیکربندی با SNMP
set_snmp = sn[sn.index("async setRateLimit(sw, port, mbps)"):]
check(set_snmp.index("pullRunning(sw)") < set_snmp.index("pushRunning(sw") and set_snmp.index("before.raw[dir] && before[dir] === null") < set_snmp.index("pushRunning(sw"),
      "SNMP: پیش از اعمال، running-config خوانده و policy بیگانه رد می‌شود")
check(set_snmp.rindex("pullRunning(sw)") > set_snmp.index("pushRunning(sw"), "SNMP: پس از اعمال، وضعیت واقعی دوباره خوانده می‌شود")
check("configPortName(port)" in set_snmp and "isSafePortName(name)" in sn[sn.index("function configPortName"):][:400],
      "SNMP: نام پورت پیش از رفتن به تکه پیکربندی سنجیده می‌شود")
check(sw.count("withTransfer(") >= 4, "ورکر تنظیمات انتقال را به سوییچ SNMP می‌چسباند (فرمان، پشتیبان خودکار، پس از فرمان)")
st_api = read("app/api/settings/route.ts")
check("'switch_sftp_pass'" in st_api.split("const SECRET")[1].split("]")[0], "گذرواژه SFTP فقط‌نوشتنی است")
check("ADMIN_ONLY" in st_api and "'switch_transfer_host'" in st_api.split("const ADMIN_ONLY")[1].split("]")[0] and "user.role !== 'admin'" in st_api,
      "نشانی سرور انتقال را فقط مدیر عوض می‌کند (وگرنه پیکربندی به سرور دیگری فرستاده می‌شد)")
compose = read("docker-compose.yml")
check('"${SWITCH_TFTP_BIND:-127.0.0.1}:69:69/udp"' in compose, "TFTP پیش‌فرض فقط روی localhost منتشر می‌شود")
setup = read("scripts/setup-switch-sftp.sh")
check("ChrootDirectory" in setup and "ForceCommand internal-sftp" in setup and "AllowTcpForwarding no" in setup,
      "کاربر SFTP زندانی، فقط SFTP، بدون تونل")
check(setup.index("sshd -t") < setup.index("systemctl reload") and "sshd_config.d" not in setup.split("cat >>")[1],
      "پیکربندی sshd پیش از reload سنجیده می‌شود و Match در انتهای sshd_config است")
mig49 = read("db/migrations/049_switch_snmp_transfer.sql")
check("CHECK (config_transfer IN ('none', 'sftp', 'tftp'))" in mig49 and "DROP CONSTRAINT IF EXISTS" in mig49, "۰۴۹ دوباره‌اجراپذیر است")


if failed:
    print(f"\n{len(failed)} شکست از {passed + len(failed)}")
    sys.exit(1)
print(f"همه {passed} آزمون سوییچ موفق بود")
