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


# ── ۲) قاعده‌ها در کد واقعی ──────────────────────────────────────

actions = read("app/api/switch-actions/route.ts")
post = actions[actions.index("export async function POST"):]
check("requireAdmin()" in post, "shut/no shut فقط از حساب مدیر")
check("is_protected" in post and "'ethernet', 'port-channel'" in post, "مسیر API محافظت و نوع پورت را بررسی می‌کند")

sw = read("worker/switches.mjs")
run = sw[sw.index("async function runAction"):]
check("isSafePortName(port.name)" in run, "ورکر نام پورت را پیش از فرمان دوباره می‌سنجد")
check("a.action === 'shutdown' && port.is_protected" in run, "ورکر محافظت را هنگام اجرا دوباره بررسی می‌کند")
check(run.index("configure(sw, lines)") < run.index("show(sw, `show interface ${port.name}`)"),
      "پس از فرمان، وضعیت واقعی از سوییچ خوانده می‌شود")

apply_ = sw[sw.index("export async function applySwitchTrafficToServers"):]
check("SUM(h.out_bytes)   AS rx_bytes" in apply_ and "SUM(h.in_bytes)    AS tx_bytes" in apply_,
      "جهت: خروجی سوییچ دانلود سرور است، ورودی سوییچ آپلودش")
check("pc.name = p.member_of" in sw, "عضو پورت‌چنل شمرده‌شده دو بار حساب نمی‌شود")

idx = read("worker/index.mjs")
order = [idx.index(s) for s in ["rollupSwitchHourly(3)", "rollupHourly(3)", "applySwitchTrafficToServers(3)", "rollupDaily(3)"]]
check(order == sorted(order), "ترتیب تجمیع: پورت، سرور، جایگزینی، روزانه")

routes = read("app/api/switches/route.ts")
check(routes.count("await requireAdmin()") == 3, "افزودن، ویرایش و حذف سوییچ فقط مدیر")
select = routes.split("const SELECT")[1].split("FROM switches")[0]
check(select.count("w.password") == 1 and "(w.password <> '') AS has_password" in select,
      "گذرواژه سوییچ هرگز برگردانده نمی‌شود، فقط «تنظیم شده یا نه»")
detail = read("app/api/switches/[id]/route.ts")
check(detail.count("w.password") == 1 and "(w.password <> '') AS has_password" in detail,
      "صفحه جزئیات سوییچ هم گذرواژه را برنمی‌گرداند")
check("گذرواژه را هم دوباره وارد کنید" in routes, "تغییر آدرس بدون گذرواژه تازه پذیرفته نمی‌شود")

mig = read("db/migrations/046_switches.sql")
check("switch_port_id" in mig and "switch_id INT REFERENCES switches" in mig, "رویداد کلید سوییچ و پورت دارد")
check("CHECK (NOT count_traffic" not in mig, "CHECK شمارش ترافیک حذف سرور را نمی‌شکند")

inc = read("worker/incidents.mjs")
check(inc.count("switch_port_id IS NOT DISTINCT FROM $5") == 2, "باز و بسته کردن رویداد کلید پورت را هم می‌سنجد")


if failed:
    print(f"\n{len(failed)} شکست از {passed + len(failed)}")
    sys.exit(1)
print(f"همه {passed} آزمون سوییچ موفق بود")
