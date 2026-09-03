#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ایجنت پایش پاسارگاد میزبان.

فقط از کتابخانه استاندارد پایتون استفاده می‌کند — هیچ pip install لازم نیست.
روی پایتون ۲٫۷ به بعد و ۳٫۶ به بعد کار می‌کند، چون خیلی از نودهای
مجازی‌ساز هنوز سنت‌اواس ۷ اند و آن فقط پایتون ۲٫۷ دارد.

اجرا:
    python3 pasargad-agent.py --url https://panel.example.com --token XXXX
    python2 pasargad-agent.py --url https://panel.example.com --token XXXX

نکته مهم درباره ترافیک: شمارنده‌های /proc/net/dev تجمعی‌اند و با ریبوت صفر
می‌شوند. ایجنت خودش دلتا می‌گیرد و اگر مقدار جدید از قبلی کمتر بود (ریبوت یا
سرریز شمارنده) آن بازه را صفر حساب می‌کند، نه یک عدد نجومی.

اگر ارسال به پنل شکست بخورد، حجم همان بازه در حافظه نگه داشته می‌شود و به
بازه بعدی اضافه می‌شود. پس یک قطعی کوتاه شبکه، آمار ماهانه را کم نمی‌کند.
(اگر خود ایجنت ری‌استارت شود آن حجم از دست می‌رود — تعمدی است، چون نوشتن
مداوم روی دیسک برای یک ابزار پایش هزینه بیهوده‌ای است.)
"""

from __future__ import print_function, division

import argparse
import json
import os
import socket
import ssl
import sys
import time

# سنت‌اواس ۷ و سرورهای قدیمی فقط پایتون ۲٫۷ دارند و از ژوئن ۲۰۲۴ که به پایان
# پشتیبانی رسیده، نصب پایتون ۳ روی آن‌ها دردسر دارد. ایجنت با هر دو کار می‌کند.
try:
    from urllib.request import Request, urlopen          # پایتون ۳
    from urllib.error import HTTPError
except ImportError:                                       # پایتون ۲
    from urllib2 import Request, urlopen, HTTPError

VERSION = "1.2.1"


def text(value):
    """
    هر مقدار را به رشته بومی همین نسخه پایتون تبدیل می‌کند.

    چرا لازم است: در پایتون ۲ متن‌های فارسی این فایل بایت‌اند (پیشوند u
    ندارند) ولی چیزی که از شبکه می‌آید یونیکد است. قالب‌بندی «بایت ٪ یونیکد»
    پایتون ۲ را وادار به رمزگشایی اسکی می‌کند و روی اولین حرف فارسی
    UnicodeDecodeError می‌دهد.

    این دقیقاً یک بار ایجنت را در حلقه ری‌استارت انداخت، و بدترین جایش این
    بود که فقط در مسیر گزارش خطا رخ می‌داد: ایجنت تا وقتی همه‌چیز درست بود
    کار می‌کرد و دقیقاً وقتی می‌خواست بگوید چه اشکالی هست، می‌مرد.
    """
    if isinstance(value, bytes):
        return value if bytes is str else value.decode("utf-8", "replace")
    try:
        return str(value)
    except Exception:
        try:
            return value.encode("utf-8")
        except Exception:
            return repr(value)


def say(message):
    """
    چاپ با تخلیه فوری بافر.

    گزینه flush در print پایتون ۳ اضافه شده و در ۲٫۷ وجود ندارد؛ بدون تخلیه،
    لاگ ایجنت در journald تا پر شدن بافر دیده نمی‌شود و عیب‌یابی سخت می‌شود.
    """
    print(text(message))
    try:
        sys.stdout.flush()
    except Exception:
        pass


SYS_NET = "/sys/class/net"

# رابط‌های مهمان روی نود مجازی‌ساز. اگر اینها شمرده شوند، ترافیک هر وی‌پی‌اس
# دو بار حساب می‌شود: یک بار روی tap خودش و یک بار روی کارت شبکه فیزیکی.
#
# این فهرست فقط شبکه ایمنی است، نه راه اصلی. هر پنل مجازی‌سازی نام‌گذاری
# خودش را دارد — libvirt از vnet، ویرچوالایزر از viifv، پروکسموکس از tap و
# fwbr، زن از vif — و چنین فهرستی هیچ‌وقت کامل نمی‌شود. تشخیص اصلی با
# is_physical انجام می‌شود که به نام تکیه نمی‌کند.
GUEST_PREFIXES = (
    "vnet", "tap", "vif", "viif", "vps", "macvtap", "veth", "vmtab", "vb-",
    "venet", "fwbr", "fwpr", "fwln", "vmtap",
)

# رابط‌هایی که در حالت واپسین (بدون مسیر پیش‌فرض) شمرده نمی‌شوند
SKIP_PREFIXES = GUEST_PREFIXES + (
    "lo", "docker", "br", "virbr", "vmbr", "xenbr", "tun", "wg",
    "cni", "flannel", "kube", "dummy", "sit", "gre", "ip6tnl", "ifb", "teql",
)

# دستگاه‌هایی که در آمار دیسک شمرده نمی‌شوند
SKIP_DISKS = ("loop", "ram", "dm-", "sr", "md", "zram")


# ─────────────────────────── خواندن اطلاعات سیستم ───────────────────────────

def read_file(path):
    try:
        with open(path, "r") as f:
            return f.read()
    except (IOError, OSError):
        return ""


def cpu_times():
    """مجموع زمان پردازنده و زمان بیکاری از /proc/stat"""
    line = read_file("/proc/stat").split("\n")[0]
    if not line.startswith("cpu "):
        return None
    try:
        parts = [float(x) for x in line.split()[1:]]
    except ValueError:
        return None
    if len(parts) < 4:
        return None

    # فقط هشت فیلد اول: user, nice, system, idle, iowait, irq, softirq, steal
    #
    # فیلدهای نهم و دهم (guest و guest_nice) عمداً کنار گذاشته می‌شوند چون
    # کرنل آن‌ها را از قبل داخل user و nice شمرده است. اگر دوباره جمع شوند،
    # مخرج بزرگ‌تر از واقع می‌شود و درصد پردازنده کمتر از واقع نشان داده
    # می‌شود — روی نود مجازی‌ساز که بیشتر وقت پردازنده صرف مهمان‌هاست،
    # این خطا می‌تواند به چند ده درصد برسد.
    core = parts[:8]
    idle = core[3] + (core[4] if len(core) > 4 else 0.0)  # idle + iowait
    return sum(core), idle


def mem_info():
    info = {}
    for line in read_file("/proc/meminfo").split("\n"):
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields = value.strip().split()
        if fields:
            try:
                info[key] = int(fields[0]) * 1024  # کیلوبایت به بایت
            except ValueError:
                pass

    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable")
    if available is None:
        # کرنل‌های قدیمی‌تر از ۳٫۱۴ فیلد MemAvailable ندارند
        available = info.get("MemFree", 0) + info.get("Buffers", 0) + info.get("Cached", 0)

    swap_total = info.get("SwapTotal", 0)
    swap_free = info.get("SwapFree", 0)

    return {
        "total": total,
        "used": max(0, total - available),
        "swap_total": swap_total,
        "swap_used": max(0, swap_total - swap_free),
    }


def disk_info(path):
    """
    فضای پارتیشن، با همان تعریفی که df می‌دهد.
    بلوک‌های رزروشده روت جزو «استفاده‌شده» حساب می‌شوند، چون کاربر عادی
    نمی‌تواند از آن‌ها استفاده کند و df هم همین را نشان می‌دهد.
    """
    try:
        st = os.statvfs(path)
    except (IOError, OSError):
        return {"total": 0, "used": 0}

    total = st.f_blocks * st.f_frsize
    available = st.f_bavail * st.f_frsize
    return {"total": total, "used": max(0, total - available)}


def is_physical(name):
    """
    کارت فیزیکی است یا مجازی؟

    در sysfs فقط دستگاه‌های واقعی پیوند device دارند که به دستگاه PCI یا USB
    اشاره می‌کند. بریج، باند، ولن و تپ مهمان‌ها ندارند.

    این نشانه از تطبیق نام قابل اعتمادتر است و به همین دلیل مبنای انتخاب
    است: فهرست پیشوندها با هر پنل مجازی‌سازی تازه‌ای ناقص می‌شود، ولی این
    قاعده روی همه‌شان یکسان کار می‌کند. (روی وی‌پی‌اس هم درست است: کارت
    مجازی virtio خودش یک دستگاه است و پیوند device دارد.)
    """
    return os.path.exists(os.path.join(SYS_NET, name, "device"))


def lower_ifaces(name):
    """رابط‌های زیرین: عضوهای بریج، اسلیوهای باند، والد ولن"""
    try:
        entries = os.listdir(os.path.join(SYS_NET, name))
    except OSError:
        return []
    return [e[len("lower_"):] for e in entries if e.startswith("lower_")]


def default_route_iface():
    """رابطی که مسیر پیش‌فرض از آن می‌گذرد"""
    for line in read_file("/proc/net/route").split("\n")[1:]:
        cols = line.split()
        if len(cols) >= 8 and cols[1] == "00000000" and cols[7] == "00000000":
            return cols[0]
    return None


def detect_uplink(max_depth=4):
    """
    پیدا کردن رابطی که ترافیک واقعی نود از آن می‌گذرد.

    روی نود مجازی‌ساز (SolusVM یا Virtualizor با KVM) آی‌پی خود نود معمولاً
    روی بریج است نه روی کارت شبکه. شمردن بریج، ترافیک وی‌پی‌اس‌ها را جا
    می‌اندازد و شمردن همه رابط‌ها آن را چند بار حساب می‌کند.

    راه درست: از رابط مسیر پیش‌فرض شروع می‌کنیم و با lower_* در sysfs به
    لایه پایین می‌رویم تا به کارت فیزیکی برسیم، و رابط‌های مهمان را کنار
    می‌گذاریم:
        br0  → eth0                     (بریج KVM)
        br0  → bond0 → eth0, eth1       (بریج روی باند)
        eth0.100 → eth0                 (ولن)
        eth0 → eth0                     (نود ساده)

    کارت فیزیکی همان چیزی است که دیتاسنتر بر مبنایش صورتحساب می‌دهد.
    """
    start = default_route_iface()
    if not start:
        return None

    frontier = [start]
    for _ in range(max_depth):
        expanded = []
        descended = False
        for name in frontier:
            lowers = lower_ifaces(name)
            if not lowers:
                expanded.append(name)
                continue

            # اگر بین زیرین‌ها کارت فیزیکی هست، فقط همان‌ها. بریج نود
            # مجازی‌ساز دقیقاً همین شکل است: یک کارت فیزیکی به‌علاوه ده‌ها
            # تپ مهمان.
            picked = [x for x in lowers if is_physical(x)]
            if not picked:
                # کارت فیزیکی مستقیم نیست؛ شاید یک لایه پایین‌تر است
                # (بریج روی باند). اینجا فهرست پیشوند کار را راه می‌اندازد.
                picked = [x for x in lowers if not x.startswith(GUEST_PREFIXES)]

            if picked:
                descended = True
                expanded.extend(picked)
            else:
                expanded.append(name)
        # حذف تکراری با حفظ ترتیب. dict در پایتون ۲ ترتیب درج را نگه
        # نمی‌دارد، پس نمی‌شود به dict.fromkeys تکیه کرد.
        seen = set()
        frontier = []
        for name in expanded:
            if name not in seen:
                seen.add(name)
                frontier.append(name)
        if not descended:
            break

    return frontier or [start]


def read_net_dev():
    """همه رابط‌ها با شمارنده دریافت و ارسال"""
    out = {}
    for line in read_file("/proc/net/dev").split("\n")[2:]:
        if ":" not in line:
            continue
        name, rest = line.split(":", 1)
        cols = rest.split()
        if len(cols) < 9:
            continue
        try:
            out[name.strip()] = (int(cols[0]), int(cols[8]))
        except ValueError:
            pass
    return out


def net_counters(ifaces=None):
    """
    مجموع بایت دریافتی و ارسالی.

    اگر فهرست رابط داده شود فقط همان‌ها شمرده می‌شوند. وگرنه به روش واپسین
    همه رابط‌های غیرمجازی جمع می‌شوند — که روی نود مجازی‌ساز دقیق نیست و
    برای همین detect_uplink پیش از آن امتحان می‌شود.
    """
    rx = tx = 0
    for name, (r, t) in read_net_dev().items():
        if ifaces is not None:
            if name not in ifaces:
                continue
        elif name.startswith(SKIP_PREFIXES):
            continue
        rx += r
        tx += t
    return rx, tx


def is_whole_disk(name):
    """
    آیا این نام یک دیسک کامل است یا پارتیشن؟
    پارتیشن‌ها نباید شمرده شوند وگرنه ترافیک دیسک دوبار حساب می‌شود.
      sda → بله، sda1 → خیر
      nvme0n1 → بله، nvme0n1p1 → خیر
    """
    if name.startswith(SKIP_DISKS):
        return False
    if name.startswith("nvme"):
        return "p" not in name.split("n")[-1] if "n" in name else True
    return not name[-1].isdigit()


def disk_counters():
    """مجموع بایت خوانده و نوشته‌شده از /proc/diskstats"""
    read_b = write_b = 0
    for line in read_file("/proc/diskstats").split("\n"):
        cols = line.split()
        if len(cols) < 10:
            continue
        if not is_whole_disk(cols[2]):
            continue
        try:
            read_b += int(cols[5]) * 512   # سکتورهای خوانده‌شده
            write_b += int(cols[9]) * 512  # سکتورهای نوشته‌شده
        except ValueError:
            pass
    return read_b, write_b


def load_avg():
    parts = read_file("/proc/loadavg").split()
    try:
        return [float(parts[0]), float(parts[1]), float(parts[2])]
    except (IndexError, ValueError):
        return [0.0, 0.0, 0.0]


def uptime_seconds():
    try:
        return int(float(read_file("/proc/uptime").split()[0]))
    except (IndexError, ValueError):
        return None


def process_count():
    try:
        return sum(1 for name in os.listdir("/proc") if name.isdigit())
    except OSError:
        return None


def tcp_connection_count():
    total = 0
    for path in ("/proc/net/tcp", "/proc/net/tcp6"):
        data = read_file(path).strip()
        if data:
            total += max(0, len(data.split("\n")) - 1)  # منهای سطر عنوان
    return total


def cpu_details():
    model = ""
    cores = 0
    for line in read_file("/proc/cpuinfo").split("\n"):
        if not model and (line.startswith("model name") or line.startswith("Model")):
            if ":" in line:
                model = line.split(":", 1)[1].strip()
        if line.startswith("processor"):
            cores += 1
    if not cores:
        # os.cpu_count فقط در پایتون ۳ هست
        counter = getattr(os, "cpu_count", None)
        cores = (counter() if counter else None) or 1
    return model, cores


def os_name():
    for line in read_file("/etc/os-release").split("\n"):
        if line.startswith("PRETTY_NAME="):
            return line.split("=", 1)[1].strip().strip('"')
    return sys.platform


# ─────────────────────────────── ارسال به پنل ───────────────────────────────

def post(url, token, payload, insecure=False, timeout=15):
    body = json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={
            "content-type": "application/json",
            "x-agent-token": token,
            "user-agent": "pasargad-agent/" + VERSION,
        },
    )
    ctx = None
    if url.startswith("https") and insecure:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    # آرگومان context در پایتون ۲٫۷ قدیمی وجود ندارد، پس فقط وقتی لازم است
    # پاس داده می‌شود
    if ctx is not None:
        response = urlopen(req, timeout=timeout, context=ctx)
    else:
        response = urlopen(req, timeout=timeout)
    try:
        return json.loads(response.read().decode("utf-8"))
    finally:
        response.close()


# ─────────────────────────────── ابزار تشخیص ───────────────────────────────

def human(n):
    """بایت به شکل خوانا با واحد لاتین تا ستون‌ها به هم نریزد"""
    value = float(n)
    for unit in ("B", "K", "M", "G", "T", "P"):
        if value < 1024 or unit == "P":
            return "%.1f%s" % (value, unit)
        value /= 1024.0


def list_ifaces(manual=""):
    """
    نمایش رابط‌های شبکه و اینکه کدام‌ها شمرده می‌شوند.

    روی نود مجازی‌ساز اول این را اجرا کنید. اگر رابط انتخاب‌شده کارت فیزیکی
    نبود، هنگام نصب با --iface صریح مشخصش کنید.

    رابط‌های مهمان جمع می‌شوند نه فهرست: روی نودی با چهل وی‌پی‌اس، چهل ردیف
    اضافه فقط جدول را ناخوانا می‌کند و چیزی به تصمیم اضافه نمی‌کند.
    """
    chosen = [x.strip() for x in manual.split(",") if x.strip()] if manual else detect_uplink()
    chosen = chosen or []
    default_if = default_route_iface()
    counters = read_net_dev()

    say("مسیر پیش‌فرض از روی: %s" % (default_if or "پیدا نشد"))
    say("شمرده می‌شود:        %s" % (", ".join(chosen) if chosen else "همه رابط‌های غیرمجازی"))
    say("")
    say("%-14s %18s %18s  %s" % ("iface", "rx", "tx", "وضعیت"))
    say("-" * 72)

    hidden = []
    hidden_rx = hidden_tx = 0

    for name in sorted(counters):
        rx, tx = counters[name]
        lowers = lower_ifaces(name)
        physical = is_physical(name)

        if name in chosen:
            state = "شمرده" + ("" if physical else "  ← مجازی است، اشتباه به نظر می‌رسد")
        elif name == "lo":
            state = "لوپ‌بک"
        elif lowers:
            members = [x for x in lowers if is_physical(x)]
            state = "بریج روی %s و %s رابط دیگر" % (
                ", ".join(members) or "؟", len(lowers) - len(members))
        elif physical:
            state = "کارت فیزیکی، شمرده نمی‌شود"
        else:
            hidden.append(name)
            hidden_rx += rx
            hidden_tx += tx
            continue

        say("%-14s %18s %18s  %s" % (name, human(rx), human(tx), state))

    if hidden:
        say("")
        say("%s رابط مهمان نشان داده نشد (مجموع: دریافت %s، ارسال %s)."
            % (len(hidden), human(hidden_rx), human(hidden_tx)))
        say("اینها عمداً شمرده نمی‌شوند؛ ترافیکشان از قبل روی کارت فیزیکی هست.")

    say("")
    bad = [x for x in chosen if not is_physical(x)]
    if bad:
        say("هشدار: %s رابط فیزیکی نیست." % ", ".join(bad))
        say("نصب را با «--iface <نام کارت فیزیکی>» تکرار کنید، وگرنه ترافیک و")
        say("هزینه چند برابر واقعی ثبت می‌شود.")
    elif not chosen:
        say("هشدار: هیچ رابطی انتخاب نشد و روش واپسین استفاده می‌شود.")
        say("روی نود مجازی‌ساز حتماً --iface را دستی بدهید.")
    return 0


# ──────────────────────────────── حلقه اصلی ────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="ایجنت پایش پاسارگاد میزبان")
    ap.add_argument("--url", help="آدرس پنل، مثلا https://panel.example.com")
    ap.add_argument("--token", help="توکن ایجنت این سرور")
    ap.add_argument("--interval", type=int, default=10, help="فاصله ارسال به ثانیه")
    ap.add_argument("--disk", default="/", help="مسیر پارتیشنی که فضایش گزارش شود")
    ap.add_argument("--iface", default="",
                    help="رابط شبکه‌ای که شمرده شود؛ چند تا را با کاما جدا کنید. "
                         "خالی یعنی خودکار از روی مسیر پیش‌فرض")
    ap.add_argument("--insecure", action="store_true", help="گواهی TLS بررسی نشود (برای گواهی خودامضا)")
    ap.add_argument("--list-ifaces", action="store_true",
                    help="نمایش رابط‌های شبکه و اینکه کدام‌ها شمرده می‌شوند، بعد خروج")
    args = ap.parse_args()

    if args.list_ifaces:
        return list_ifaces(args.iface)

    if not args.url or not args.token:
        ap.error("گزینه‌های --url و --token لازم‌اند")

    endpoint = args.url.rstrip("/") + "/api/ingest"
    interval = max(5, args.interval)

    # انتخاب رابط: دستی، بعد تشخیص خودکار، بعد روش واپسین
    if args.iface:
        iface = [x.strip() for x in args.iface.split(",") if x.strip()]
        source = "دستی"
    else:
        iface = detect_uplink()
        source = "خودکار از مسیر پیش‌فرض"
        if not iface:
            source = "واپسین — همه رابط‌های غیرمجازی"

    say("رابط شبکه شمرده‌شده (%s): %s"
          % (source, ", ".join(iface) if iface else "همه"))

    hostname = socket.gethostname()
    cpu_model, cpu_cores = cpu_details()
    system = os_name()

    prev_cpu = cpu_times()
    prev_net = net_counters(iface)
    prev_disk = disk_counters()
    prev_time = time.time()

    # حجمی که به‌خاطر شکست ارسال هنوز گزارش نشده — به بازه بعدی اضافه می‌شود
    pending_rx = 0
    pending_tx = 0
    fail_streak = 0

    say("ایجنت پاسارگاد میزبان نسخه %s شروع شد. مقصد: %s" % (VERSION, endpoint))

    # اولین بازه فقط مبنای دلتا را می‌سازد و چیزی نمی‌فرستد
    time.sleep(interval)

    while True:
        started = time.time()
        d_rx = d_tx = 0
        sent = False

        try:
            now = time.time()
            elapsed = max(0.001, now - prev_time)

            # پردازنده
            cur_cpu = cpu_times()
            cpu_percent = 0.0
            if cur_cpu and prev_cpu:
                d_total = cur_cpu[0] - prev_cpu[0]
                d_idle = cur_cpu[1] - prev_cpu[1]
                if d_total > 0:
                    cpu_percent = max(0.0, min(100.0, (1.0 - d_idle / d_total) * 100.0))
            if cur_cpu:
                prev_cpu = cur_cpu

            # شبکه — منفی یعنی ریبوت یا سرریز شمارنده، پس صفر حساب می‌شود
            cur_net = net_counters(iface)
            d_rx = max(0, cur_net[0] - prev_net[0])
            d_tx = max(0, cur_net[1] - prev_net[1])
            prev_net = cur_net

            # ورودی و خروجی دیسک
            cur_disk = disk_counters()
            d_read = max(0, cur_disk[0] - prev_disk[0])
            d_write = max(0, cur_disk[1] - prev_disk[1])
            prev_disk = cur_disk

            prev_time = now

            payload = {
                "token": args.token,
                "hostname": hostname,
                "os": system,
                "agent_version": VERSION,
                "cpu": {"percent": round(cpu_percent, 2), "cores": cpu_cores, "model": cpu_model},
                "load": load_avg(),
                "mem": mem_info(),
                "disk": disk_info(args.disk),
                "net": {
                    "rx_bytes": d_rx + pending_rx,
                    "tx_bytes": d_tx + pending_tx,
                    # سرعت لحظه‌ای فقط از همین بازه می‌آید، نه از حجم معوق
                    "rx_bps": int(d_rx * 8 / elapsed),
                    "tx_bps": int(d_tx * 8 / elapsed),
                    # پنل نشان می‌دهد کدام رابط شمرده شده، تا انتخاب اشتباه
                    # روی نود مجازی‌ساز پنهان نماند
                    "iface": ",".join(iface) if iface else "auto",
                },
                "diskio": {
                    "read_bps": int(d_read * 8 / elapsed),
                    "write_bps": int(d_write * 8 / elapsed),
                },
                "uptime": uptime_seconds(),
                "procs": process_count(),
                "conns": tcp_connection_count(),
            }

            result = post(endpoint, args.token, payload, insecure=args.insecure)
            sent = True

            server_interval = result.get("interval") if isinstance(result, dict) else None
            if isinstance(server_interval, int) and 5 <= server_interval <= 300:
                interval = server_interval

        except HTTPError as err:
            detail = ""
            try:
                detail = text(err.read())[:200]
            except Exception:
                pass
            fail_streak += 1
            if err.code in (401, 403):
                say("توکن پذیرفته نشد (کد %s): %s" % (err.code, detail))
                time.sleep(60)  # با توکن غلط، تلاش سریع فایده‌ای ندارد
            else:
                say("خطای پنل (کد %s): %s" % (err.code, detail))

        except Exception as err:  # noqa: BLE001 — ایجنت هرگز نباید بمیرد
            fail_streak += 1
            if fail_streak in (1, 5, 30) or fail_streak % 60 == 0:
                say("ارسال ناموفق (%s بار پیاپی): %s" % (fail_streak, text(err)))

        if sent:
            pending_rx = 0
            pending_tx = 0
            if fail_streak:
                say("ارتباط با پنل دوباره برقرار شد")
                fail_streak = 0
        else:
            # حجم این بازه به دفعه بعد منتقل می‌شود تا از آمار ماهانه کم نشود
            pending_rx += d_rx
            pending_tx += d_tx

        sleep_for = interval - (time.time() - started)
        if sleep_for > 0:
            time.sleep(sleep_for)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        say("ایجنت متوقف شد")
