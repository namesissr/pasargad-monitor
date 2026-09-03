#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ایجنت لنگر — پاسارگاد میزبان.

آی‌پی بیکار به هیچ ماشینی وصل نیست و از هیچ‌جا به پینگ جواب نمی‌دهد، پس
وضعیت اکسسش قابل سنجش نیست. این ایجنت روی سروری که ادمین معرفی کرده اجرا
می‌شود، فهرست آی‌پی‌های سپرده به این سرور را از پنل می‌گیرد و رویش بایند
می‌کند تا زنده شوند و دیدبان‌ها بتوانند بسنجندشان.

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
            wanted = set(listing.get("ips") or [])
            server_interval = listing.get("interval")
            if isinstance(server_interval, int) and 60 <= server_interval <= 3600:
                interval = server_interval

            state = load_state()
            results = []

            # جداکردن آی‌پی‌هایی که ما بایند کردیم و دیگر خواسته نیستند.
            # فقط از روی فایل حالت — هرگز به آدرس‌های خود سرور دست نمی‌زنیم.
            for ip in sorted(state - wanted):
                code, out = run_ip(["addr", "del", ip + "/32", "dev", iface])
                if code == 0 or "Cannot assign" in out:
                    state.discard(ip)
                    say("جدا شد: %s" % ip)
                else:
                    say("جداکردن %s ناموفق: %s" % (ip, out.strip()[:120]))

            # بایند خواسته‌ها
            for ip in sorted(wanted):
                code, out = run_ip(["addr", "add", ip + "/32", "dev", iface])
                if code == 0:
                    state.add(ip)
                    say("بایند شد: %s" % ip)
                    results.append({"ip": ip, "bound": True})
                elif "File exists" in out:
                    # از قبل هست — چه توسط ما چه خود سرور؛ زنده است
                    state.add(ip)
                    results.append({"ip": ip, "bound": True})
                else:
                    results.append({"ip": ip, "bound": False, "error": out.strip()[:200]})
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
