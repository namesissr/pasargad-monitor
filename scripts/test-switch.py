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
set_sn = sn[sn.index("async setAdmin(sw, port, up)"):]
check(set_sn.index("names.includes(expected)") < set_sn.index("O.ifAdminStatus"),
      "SNMP: پیش از SET، نام همان ifIndex با نام پورت مقایسه می‌شود")
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


if failed:
    print(f"\n{len(failed)} شکست از {passed + len(failed)}")
    sys.exit(1)
print(f"همه {passed} آزمون سوییچ موفق بود")
