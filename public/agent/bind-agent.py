#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ایجنت لنگر — پاسارگاد میزبان.

آی‌پی بیکار به هیچ ماشینی وصل نیست و از هیچ‌جا به پینگ جواب نمی‌دهد، پس
وضعیت اکسسش قابل سنجش نیست. این ایجنت روی سروری که ادمین معرفی کرده اجرا
می‌شود، فهرست آی‌پی‌های سپرده به این سرور را از پنل می‌گیرد و رویش بایند
می‌کند تا زنده شوند و دیدبان‌ها بتوانند بسنجندشان.

آدرس با /32 روی رابط مسیر پیش‌فرض می‌نشیند و گیت‌وی جداگانه لازم ندارد:
سرور از قبل مسیر پیش‌فرض دارد و پاسخ پینگ از همان برمی‌گردد. با /32 کرنل به
ARP آن آدرس جواب می‌دهد، که همان چیزی است که روتر بالادست می‌خواهد. دادن
ماسک واقعی یک مسیر متصل تکراری می‌سازد و می‌تواند با مسیر آی‌پی اصلی سرور
تداخل کند — پس پرفیکس فقط وقتی عوض می‌شود که ادمین در پنل صریح خواسته باشد.

نکته مهم: آی‌پی‌هایی که خودش قبلاً بایند کرده و دیگر در فهرست نیستند را
جدا می‌کند — فهرستشان در یک فایل حالت محلی نگه داشته می‌شود تا هرگز به
آی‌پی‌هایی که خود سرور از قبل داشته دست نزند.

احراز با همان agent_token سرور در پنل. با پایتون ۲٫۷ و ۳ کار می‌کند.

اجرا (روت لازم است — بایند آی‌پی دستکاری شبکه است):
    python3 bind-agent.py --url https://panel.example.com --token XXXX
"""

from __future__ import print_function, division

import argparse
import json
import os
import ssl
import subprocess
import sys
import time

try:
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError
except ImportError:  # پایتون ۲
    from urllib2 import Request, urlopen, HTTPError

VERSION = "1.0.0"
STATE_FILE = "/var/lib/pasargad-bind/state.json"


def say(message):
    print(message)
    try:
        sys.stdout.flush()
    except Exception:
        pass


def text(value):
    if isinstance(value, bytes):
        return value if bytes is str else value.decode("utf-8", "replace")
    try:
        return str(value)
    except Exception:
        return repr(value)


def http_json(url, token, payload=None, insecure=False, timeout=30):
    headers = {"x-agent-token": token, "user-agent": "pasargad-bind/" + VERSION}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["content-type"] = "application/json"
    req = Request(url, data=data, headers=headers)

    ctx = None
    if url.startswith("https") and insecure:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    if ctx is not None:
        res = urlopen(req, timeout=timeout, context=ctx)
    else:
        res = urlopen(req, timeout=timeout)
    try:
        return json.loads(res.read().decode("utf-8"))
    finally:
        res.close()


def default_iface():
    """رابط مسیر پیش‌فرض — همان‌جایی که آی‌پی‌ها باید بنشینند"""
    try:
        with open("/proc/net/route") as f:
            for line in f.read().split("\n")[1:]:
                cols = line.split()
                if len(cols) >= 8 and cols[1] == "00000000" and cols[7] == "00000000":
                    return cols[0]
    except (IOError, OSError):
        pass
    return None


def run_ip(args_list):
    proc = subprocess.Popen(["ip"] + args_list, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, err = proc.communicate()
    return proc.returncode, text(out) + text(err)


def ip_to_int(ip):
    parts = ip.split(".")
    if len(parts) != 4:
        return None
    try:
        nums = [int(x) for x in parts]
    except ValueError:
        return None
    if any(n < 0 or n > 255 for n in nums):
        return None
    return (nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]


def primary_address(iface, ours):
    """
    آدرس اصلی رابط و پرفیکسش.

    آدرس‌هایی که خودمان بایند کرده‌ایم و هر /32 دیگری کنار گذاشته می‌شوند:
    آدرس اصلی همیشه پرفیکس واقعی ساب‌نت را دارد.
    """
    code, out = run_ip(["-4", "addr", "show", "dev", iface])
    if code != 0:
        return None, None
    for line in out.split("\n"):
        line = line.strip()
        if not line.startswith("inet "):
            continue
        cidr = line.split()[1]
        if "/" not in cidr:
            continue
        addr, prefix = cidr.split("/", 1)
        try:
            prefix = int(prefix)
        except ValueError:
            continue
        if prefix >= 32 or addr in ours:
            continue
        return addr, prefix
    return None, None


def same_subnet(ip, base_ip, base_prefix):
    """آیا این آی‌پی با آدرس اصلی سرور در یک ساب‌نت است؟"""
    if not base_ip or not base_prefix:
        return None
    a = ip_to_int(ip)
    b = ip_to_int(base_ip)
    if a is None or b is None:
        return None
    mask = (0xFFFFFFFF << (32 - base_prefix)) & 0xFFFFFFFF
    return (a & mask) == (b & mask)


def current_prefix(iface, ip):
    """
    پرفیکسی که این آدرس همین حالا با آن روی رابط نشسته، یا None اگر نیست.

    برای حذف لازم است: «ip addr del» آدرس و پرفیکس را با هم تطبیق می‌دهد.
    آدرسی که با /۲۴ بایند شده با «del ip/32» حذف نمی‌شود و خطای
    «Cannot assign requested address» می‌دهد.
    """
    try:
        proc = subprocess.Popen(["ip", "-4", "-o", "addr", "show", "dev", iface],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out, _ = proc.communicate()
        if proc.returncode != 0:
            return None
        for line in text(out).split(chr(10)):
            parts = line.split()
            for i, token in enumerate(parts):
                if token == "inet" and i + 1 < len(parts):
                    addr = parts[i + 1]
                    if addr.split("/")[0] == ip:
                        bits = addr.split("/")
                        return int(bits[1]) if len(bits) > 1 else 32
    except Exception:
        pass
    return None


def ping_from(source, target):
    """پینگ به مقصد با مبدأ مشخص؛ سه تلاش، چون یک بسته گمشده نتیجه را عوض نکند"""
    try:
        proc = subprocess.Popen(
            ["ping", "-n", "-c", "3", "-W", "2", "-I", source, target],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        proc.communicate()
        return proc.returncode == 0
    except Exception:
        return None


def routing_test(ip, gateway, shares_subnet, base_ip):
    """
    آیا این آدرس واقعاً روی شبکه شناخته شده است؟

    True یعنی روت شده، False یعنی نشده، None یعنی تست نتیجه نداد.
    تفکیک None از False مهم است: گزارش «روت نشده» برای آدرسی که سالم
    است، ادمین را دنبال مشکلی می‌فرستد که وجود ندارد.

    هم‌ساب‌نت‌بودن اثبات نیست — این را یک بار اشتباه فرض کردیم. در
    دیتاسنترهای ایرانی هر آی‌پی معمولاً به پورت و مک یک سرور مشخص بایند
    است؛ آدرسی از همان بلوک که به سرور دیگری تخصیص یافته، حتی وقتی روی
    کارت می‌نشیند، بسته‌ای دریافت نمی‌کند. پس تست همیشه اجرا می‌شود.

    از shares_subnet فقط برای توضیح خطا استفاده می‌شود، نه برای تصمیم.

    پینگ به گیت‌وی با مبدأ همین آدرس می‌زنیم. ولی جواب‌ندادن گیت‌وی دو
    معنی دارد: یا آدرس روت نشده، یا گیت‌وی اصلاً به پینگ جواب نمی‌دهد —
    که در دیتاسنترها رایج است. پس یک پینگ شاهد از آدرس اصلی سرور هم
    می‌زنیم. اگر آن هم جواب نگیرد، گیت‌وی ساکت است و تست بی‌نتیجه است،
    نه منفی.
    """
    if not gateway:
        return None

    if ping_from(ip, gateway):
        return True

    # پینگ شاهد: آیا این گیت‌وی اصلاً به کسی جواب می‌دهد؟
    if base_ip and ping_from(base_ip, gateway) is False:
        return None

    return False


def load_state():
    try:
        with open(STATE_FILE) as f:
            data = json.load(f)
            return set(data.get("bound", []))
    except Exception:
        return set()


def save_state(bound):
    try:
        directory = os.path.dirname(STATE_FILE)
        if not os.path.isdir(directory):
            os.makedirs(directory)
        with open(STATE_FILE, "w") as f:
            json.dump({"bound": sorted(bound)}, f)
    except Exception as err:
        say("ذخیره فایل حالت ناموفق: %s" % text(err))


def main():
    ap = argparse.ArgumentParser(description="ایجنت لنگر آی‌پی")
    ap.add_argument("--url", required=True)
    ap.add_argument("--token", required=True)
    ap.add_argument("--iface", default="", help="رابط شبکه؛ خالی یعنی رابط مسیر پیش‌فرض")
    ap.add_argument("--interval", type=int, default=300)
    ap.add_argument("--insecure", action="store_true")
    args = ap.parse_args()

    if hasattr(os, "geteuid") and os.geteuid() != 0:
        say("این ایجنت باید با روت اجرا شود — بایند آی‌پی بدون روت ممکن نیست.")
        sys.exit(1)

    iface = args.iface or default_iface()
    if not iface:
        say("رابط شبکه پیدا نشد. با --iface صریح بدهید.")
        sys.exit(1)

    base = args.url.rstrip("/")
    interval = max(60, args.interval)
    fail_streak = 0

    say("ایجنت لنگر نسخه %s شروع شد. رابط: %s" % (VERSION, iface))

    while True:
        started = time.time()
        try:
            listing = http_json(base + "/api/bind", args.token, insecure=args.insecure)

            # نگاشت آی‌پی به پرفیکس. «addresses» شکل تازه است؛ اگر پنل
            # قدیمی بود، «ips» با پرفیکس ۳۲ استفاده می‌شود.
            addresses = {}
            gateways = {}
            for row in (listing.get("addresses") or []):
                ip_text = str(row.get("ip") or "").strip()
                if ip_text:
                    try:
                        addresses[ip_text] = int(row.get("prefix") or 32)
                    except (TypeError, ValueError):
                        addresses[ip_text] = 32
                    gateways[ip_text] = str(row.get("gateway") or "").strip() or None
            if not addresses:
                for ip_text in (listing.get("ips") or []):
                    addresses[str(ip_text).strip()] = 32
            wanted = set(addresses)
            server_interval = listing.get("interval")
            if isinstance(server_interval, int) and 60 <= server_interval <= 3600:
                interval = server_interval

            state = load_state()
            results = []

            # آدرس اصلی رابط، برای تشخیص اینکه آی‌پی از رنج دیگری است یا نه.
            # اگر رنج فرق کند و آی‌پی از هیچ‌جا در دسترس نباشد، تقریباً همیشه
            # یعنی دیتاسنتر بلوک را به این سرور روت نکرده.
            base_ip, base_prefix = primary_address(iface, state)

            # جداکردن آی‌پی‌هایی که ما بایند کردیم و دیگر خواسته نیستند.
            # فقط از روی فایل حالت — هرگز به آدرس‌های خود سرور دست نمی‌زنیم.
            for ip in sorted(state - wanted):
                # پرفیکس واقعی را از خود رابط می‌خوانیم. قبلاً «/32» ثابت
                # فرستاده می‌شد با این فرض که کرنل آدرس را خودش پیدا می‌کند —
                # ولی «ip addr del» آدرس و پرفیکس را با هم تطبیق می‌دهد. برای
                # آدرسی که با /۲۴ بایند شده، حذف شکست می‌خورد و چون
                # «Cannot assign» موفقیت حساب می‌شد، ایجنت آن را از حالت پاک
                # می‌کرد و «جدا شد» می‌گفت — در حالی که آدرس روی کارت می‌ماند
                # و هیچ‌وقت برای سرور دیگری آزاد نمی‌شد.
                have = current_prefix(iface, ip)
                if have is None:
                    state.discard(ip)
                    say("جدا شد: %s (از قبل روی رابط نبود)" % ip)
                    continue
                code, out = run_ip(["addr", "del", "%s/%d" % (ip, have), "dev", iface])
                if code == 0 and current_prefix(iface, ip) is None:
                    state.discard(ip)
                    say("جدا شد: %s" % ip)
                else:
                    say("جداکردن %s ناموفق: %s" % (ip, out.strip()[:120] or "هنوز روی رابط است"))

            # بایند خواسته‌ها
            for ip in sorted(wanted):
                cidr = "%s/%d" % (ip, addresses.get(ip, 32))
                code, out = run_ip(["addr", "add", cidr, "dev", iface])
                shares = same_subnet(ip, base_ip, base_prefix)
                if code == 0 or "File exists" in out:
                    state.add(ip)
                    routed = routing_test(ip, gateways.get(ip), shares, base_ip)
                    if code == 0:
                        note = ""
                        if shares is False:
                            note = "  (رنج متفاوت)"
                        if routed is False:
                            note += "  (روت نشده)"
                        say("بایند شد: %s%s" % (ip, note))
                    results.append({
                        "ip": ip, "bound": True, "same_subnet": shares, "routed": routed,
                    })
                else:
                    results.append({
                        "ip": ip, "bound": False, "same_subnet": shares,
                        "error": out.strip()[:200],
                    })
                    say("بایند %s ناموفق: %s" % (ip, out.strip()[:120]))

            save_state(state)

            if results:
                http_json(base + "/api/bind", args.token, payload={"results": results},
                          insecure=args.insecure)

            if fail_streak:
                say("ارتباط با پنل دوباره برقرار شد")
                fail_streak = 0

        except HTTPError as err:
            fail_streak += 1
            detail = ""
            try:
                detail = text(err.read())[:200]
            except Exception:
                pass
            say("خطای پنل (کد %s): %s" % (err.code, detail))
        except Exception as err:  # noqa: BLE001
            fail_streak += 1
            if fail_streak in (1, 5, 30) or fail_streak % 60 == 0:
                say("دور ناموفق (%s بار پیاپی): %s" % (fail_streak, text(err)))

        sleep_for = interval - (time.time() - started)
        if sleep_for > 0:
            time.sleep(sleep_for)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        say("ایجنت لنگر متوقف شد")
