#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
دیدبان پایش «ایران اکسس» — پاسارگاد میزبان.

روی یک سرور کوچک نصب می‌شود (داخل یا خارج ایران؛ موقعیت هنگام ساخت دیدبان
در پنل تعیین شده)، فهرست آی‌پی‌های تحت پایش را از پنل می‌گیرد، به همه پینگ
می‌زند و نتیجه را برمی‌گرداند. تصمیم‌گیری با پنل است، نه با این اسکریپت.

فقط کتابخانه استاندارد؛ با پایتون ۲٫۷ و ۳ کار می‌کند.

اجرا:
    python3 iran-probe.py --url https://panel.example.com --token XXXX
"""

from __future__ import print_function, division

import argparse
import json
import ssl
import subprocess
import sys
import time
from multiprocessing.dummy import Pool

try:
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError
except ImportError:  # پایتون ۲
    from urllib2 import Request, urlopen, HTTPError

VERSION = "1.0.0"


def say(message):
    print(message)
    try:
        sys.stdout.flush()
    except Exception:
        pass


def text(value):
    """تبدیل امن به رشته بومی — همان درسی که از ایجنت اصلی گرفتیم"""
    if isinstance(value, bytes):
        return value if bytes is str else value.decode("utf-8", "replace")
    try:
        return str(value)
    except Exception:
        return repr(value)


def http_json(url, token, payload=None, insecure=False, timeout=30):
    headers = {"x-probe-token": token, "user-agent": "pasargad-probe/" + VERSION}
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


def local_addresses():
    """
    آدرس‌هایی که روی همین ماشین بایند شده‌اند.

    چرا لازم است: در چیدمان دو سروری، همان وی‌پی‌اس ایران هم لنگر است هم
    دیدبان. پینگ‌زدن به آدرسی که روی خودش نشسته از لوپ‌بک رد می‌شود و
    همیشه موفق است — اگر به‌عنوان نتیجه واقعی گزارش شود، پنل فکر می‌کند
    آی‌پی زنده و در دسترس است، حتی وقتی اصلاً روت نشده.
    """
    found = set()
    try:
        proc = subprocess.Popen(["ip", "-4", "-o", "addr", "show"],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out, _ = proc.communicate()
        if proc.returncode != 0:
            return found
        for line in text(out).split(chr(10)):
            parts = line.split()
            for i, token in enumerate(parts):
                if token == "inet" and i + 1 < len(parts):
                    found.add(parts[i + 1].split("/")[0])
    except Exception:
        pass
    return found


def ping(ip, timeout_s):
    """یک پینگ؛ خروجی زمان به میلی‌ثانیه یا None"""
    try:
        proc = subprocess.Popen(
            ["ping", "-n", "-c", "1", "-W", str(timeout_s), ip],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        out, _ = proc.communicate()
        if proc.returncode != 0:
            return {"ip": ip, "ok": False, "ms": None}
        ms = None
        body = text(out)
        marker = "time="
        idx = body.find(marker)
        if idx != -1:
            tail = body[idx + len(marker):].split()[0]
            try:
                ms = float(tail.replace("ms", ""))
            except ValueError:
                ms = None
        return {"ip": ip, "ok": True, "ms": ms}
    except Exception:
        return {"ip": ip, "ok": False, "ms": None}


def main():
    ap = argparse.ArgumentParser(description="دیدبان ایران اکسس")
    ap.add_argument("--url", required=True)
    ap.add_argument("--token", required=True)
    ap.add_argument("--interval", type=int, default=600, help="فاصله هر دور بررسی، ثانیه")
    ap.add_argument("--timeout", type=int, default=2, help="مهلت هر پینگ، ثانیه")
    ap.add_argument("--concurrency", type=int, default=20)
    ap.add_argument("--insecure", action="store_true")
    args = ap.parse_args()

    base = args.url.rstrip("/")
    interval = max(60, args.interval)
    fail_streak = 0

    say("دیدبان پاسارگاد میزبان نسخه %s شروع شد. پنل: %s" % (VERSION, base))

    while True:
        started = time.time()
        try:
            listing = http_json(base + "/api/probe", args.token, insecure=args.insecure)
            ips = listing.get("ips") or []
            server_interval = listing.get("interval")
            if isinstance(server_interval, int) and 60 <= server_interval <= 3600:
                interval = server_interval

            if ips:
                local = local_addresses()
                pool = Pool(min(args.concurrency, max(1, len(ips))))
                try:
                    results = pool.map(lambda ip: ping(ip, args.timeout), ips)
                finally:
                    pool.close()
                    pool.join()

                # آدرس‌های محلی علامت می‌خورند تا پنل نتیجه‌شان را به‌عنوان
                # اثبات در دسترس بودن حساب نکند
                for item in results:
                    if item["ip"] in local:
                        item["local"] = True

                http_json(base + "/api/probe", args.token, payload={"results": results},
                          insecure=args.insecure)
                up = sum(1 for r in results if r["ok"] and not r.get("local"))
                skipped = sum(1 for r in results if r.get("local"))
                say("دور کامل شد: %d آی‌پی، %d پاسخ داد%s"
                    % (len(results), up,
                       "، %d روی همین سرور بایند است" % skipped if skipped else ""))
            else:
                say("فهرست پایش خالی است")

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
        except Exception as err:  # noqa: BLE001 — دیدبان نباید بمیرد
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
        say("دیدبان متوقف شد")
