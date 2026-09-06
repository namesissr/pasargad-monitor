#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون ورود با کد یکبارمصرف.

کد شش‌رقمی است — یک میلیون حالت. این عدد به‌تنهایی هیچ چیزی را امن
نمی‌کند؛ چیزی که امنش می‌کند **محدودکردن تعداد تلاش** است. شش قاعده که
شکستن هرکدام یعنی ورود به حساب مشتری، و هیچ‌کدام خطایی نمی‌سازد:

۱. **شمارنده تلاش روی خود کد است، نه روی درخواست‌کننده.** سقف نرخ آی‌پی
   جلوی سیل را می‌گیرد ولی حمله آهسته از چند آی‌پی را نه. با پنج تلاش
   روی ردیف کد، آن حمله هم می‌میرد.

۲. **شمارنده پیش از مقایسه بالا می‌رود.** اگر بعدش بالا می‌رفت،
   درخواست‌های موازی همگی شمارنده صفر می‌دیدند و سقف دور زده می‌شد.

۳. **کد یکبارمصرف است.** consumed_at پیش از بازشدن نشست ثبت می‌شود.

۴. **کد در دیتابیس هش می‌شود.** تا وقتی کد زنده است، هرکسی که دیتابیس
   را ببیند می‌تواند با آن وارد حساب مشتری شود.

۵. **کد با randomInt ساخته می‌شود نه Math.random.** خروجی Math.random
   قابل پیش‌بینی است، و اینجا «خروجی بعدی» کد ورود یک نفر دیگر است.

۶. **درخواست کد برای شماره بی‌حساب هم پاسخ موفق می‌گیرد.** وگرنه این
   مسیر ابزاری می‌شود برای فهمیدن اینکه کدام شماره‌ها مشتری ما هستند.

اجرا:  python3 scripts/test-otp.py
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

MAX_ATTEMPTS = 5
TTL_SEC = 180
RESEND_SEC = 90
MAX_PER_HOUR = 5


def verdict(code, now):
    """
    بازسازی تصمیم تأیید.

    code دیکشنری ردیف است، یا None اگر کدی برای آن شماره نباشد.
    برمی‌گرداند رشته نتیجه.
    """
    if not code:
        return "wrong"          # پیام یکسان با «کد اشتباه»
    if code.get("consumed"):
        return "consumed"
    if code["age"] >= TTL_SEC:
        return "expired"
    if code["attempts"] >= MAX_ATTEMPTS:
        return "locked"
    if not code["matches"]:
        return "wrong"
    return "ok"


def can_request(last_ago, count_hour):
    """بازسازی تصمیم ارسال کد تازه"""
    if last_ago is not None and last_ago < RESEND_SEC:
        return "cooldown"
    if count_hour >= MAX_PER_HOUR:
        return "hourly"
    return "ok"


VERIFY_CASES = [
    ({"age": 10, "attempts": 0, "matches": True}, "ok", "کد درست و تازه"),
    ({"age": 10, "attempts": 4, "matches": True}, "ok", "آخرین تلاش، کد درست"),
    ({"age": 10, "attempts": 0, "matches": False}, "wrong", "کد غلط"),
    ({"age": 10, "attempts": 5, "matches": True}, "locked",
     "تلاش تمام — کد درست هم دیگر کار نمی‌کند"),
    ({"age": 181, "attempts": 0, "matches": True}, "expired", "منقضی"),
    ({"age": 179, "attempts": 0, "matches": True}, "ok", "یک ثانیه مانده به انقضا"),
    ({"age": 10, "attempts": 0, "matches": True, "consumed": True}, "consumed",
     "کد مصرف‌شده دوباره کار نمی‌کند"),
    (None, "wrong", "کدی درخواست نشده — پیام یکسان با کد غلط"),
]

REQUEST_CASES = [
    (None, 0, "ok", "اولین درخواست"),
    (89, 1, "cooldown", "یک ثانیه مانده به پایان فاصله"),
    (90, 1, "ok", "فاصله تمام شد"),
    (200, 5, "hourly", "سقف ساعتی پر"),
    (200, 4, "ok", "یک جا مانده از سقف ساعتی"),
]


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def without_comments(src):
    """
    کد بدون توضیحات.

    لازم است چون بعضی قاعده‌ها در توضیح خودشان اسم چیزی را می‌برند که
    ممنوع است — مثل توضیحی که می‌گوید چرا Math.random استفاده نشده.
    بدون این، همان توضیح آزمون را رد می‌کند؛ و بررسی‌ای که با توضیحِ
    خودش می‌شکند، کاربر را یاد می‌دهد نادیده‌اش بگیرد.
    """
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)
    return src


def main():
    failures = 0

    def check(name, got, expected):
        nonlocal failures
        if got == expected:
            print("گذشت  %s" % name)
        else:
            failures += 1
            print("شکست  %s — انتظار %r، نتیجه %r" % (name, expected, got))

    for code, expected, name in VERIFY_CASES:
        check("تأیید: %s" % name, verdict(code, 0), expected)

    print("")

    for last, count, expected, name in REQUEST_CASES:
        check("درخواست: %s" % name, can_request(last, count), expected)

    print("")

    otp = read("lib", "otp.ts")
    req = read("app", "api", "auth", "otp", "request", "route.ts")
    ver = read("app", "api", "auth", "otp", "verify", "route.ts")
    mig = read("db", "migrations", "042_otp_login.sql")
    api = read("lib", "api.ts")

    source_checks = [
        # ── قاعده ۱ و ۲: سقف تلاش ────────────────────────────
        (otp, "otp", "MAX_ATTEMPTS = 5", "سقف تلاش روی هر کد"),
        (otp, "otp", "row.attempts >= MAX_ATTEMPTS", "سقف پیش از مقایسه بررسی می‌شود"),
        (mig, "مهاجرت ۰۴۲", "attempts    INT NOT NULL DEFAULT 0",
         "شمارنده تلاش روی خود ردیف کد است"),

        # ── قاعده ۳: یکبارمصرف ───────────────────────────────
        (otp, "otp", "SET consumed_at = now() WHERE id = $1", "کد مصرف می‌شود"),
        (otp, "otp", "row.consumed", "کد مصرف‌شده رد می‌شود"),

        # ── قاعده ۴: هش ──────────────────────────────────────
        (otp, "otp", "createHmac('sha256', secret)", "کد با HMAC هش می‌شود"),
        (otp, "otp", "timingSafeEqual", "مقایسه بدون نشت زمانی"),
        (mig, "مهاجرت ۰۴۲", "code_hash", "ستون هش است نه خود کد"),

        # ── قاعده ۵: تصادف امن ───────────────────────────────
        (otp, "otp", "randomInt(0, 1_000_000)", "کد با تصادف رمزنگاری‌شده ساخته می‌شود"),

        # ── قاعده ۶: پاسخ خنثی ───────────────────────────────
        (otp, "otp", "return { ok: true };", "شماره بی‌حساب هم پاسخ موفق می‌گیرد"),

        # ── سقف نرخ در مسیرها ────────────────────────────────
        (req, "otp/request", "rateLimit(", "درخواست کد سقف نرخ آی‌پی دارد"),
        (ver, "otp/verify", "rateLimit(", "تأیید کد سقف نرخ آی‌پی دارد"),

        # ── نشست از همان جای همیشگی ──────────────────────────
        (ver, "otp/verify", "startSession(", "نشست از تابع مشترک باز می‌شود"),

        # ── قابل خاموش‌کردن ──────────────────────────────────
        (otp, "otp", "otp_login_enabled", "ورود با کد قابل خاموش‌کردن است"),

        # ── ریدایرکت ۴۰۱ نباید کاربر را از فرم بیرون بیندازد ─
        (api, "api", "url.startsWith('/api/auth/')",
         "۴۰۱ روی مسیرهای ورود کاربر را به صفحه ورود نمی‌فرستد"),
    ]

    for src, label, needle, why in source_checks:
        if needle in src:
            print("گذشت  کد واقعی (%s): %s" % (label, why))
        else:
            failures += 1
            print("شکست  کد واقعی (%s): %s پیدا نشد" % (label, why))

    print("")

    # Math.random هیچ‌جای این مسیر نباید باشد — در کد، نه در توضیح
    for label, src in (("otp", otp), ("otp/request", req), ("otp/verify", ver)):
        if "Math.random" in without_comments(src):
            failures += 1
            print("شکست  کد واقعی (%s): Math.random برای کد استفاده شده" % label)
        else:
            print("گذشت  کد واقعی (%s): Math.random استفاده نشده" % label)

    print("")

    # خود کد هرگز نباید در ستونی جز هش برود
    inserts = re.findall(r"INSERT INTO otp_codes[^`]*", otp)
    if any(re.search(r"\bcode\b(?!_hash)", i) for i in inserts):
        failures += 1
        print("شکست  کد واقعی (otp): خود کد در دیتابیس درج می‌شود")
    else:
        print("گذشت  کد واقعی (otp): فقط هش در دیتابیس درج می‌شود")

    # شمارنده باید پیش از مقایعه هش بالا برود
    bump_at = otp.find("SET attempts = attempts + 1")
    compare_at = otp.find("sameHash(row.code_hash")
    if -1 < bump_at < compare_at:
        print("گذشت  کد واقعی (otp): شمارنده پیش از مقایسه بالا می‌رود")
    else:
        failures += 1
        print("شکست  کد واقعی (otp): شمارنده بعد از مقایسه بالا می‌رود — سقف دور زده می‌شود")

    # مصرف باید پیش از برگرداندن حساب باشد
    consume_at = otp.rfind("SET consumed_at = now() WHERE id = $1")
    return_at = otp.find("return { ok: true, user };")
    if -1 < consume_at < return_at:
        print("گذشت  کد واقعی (otp): کد پیش از بازگرداندن حساب مصرف می‌شود")
    else:
        failures += 1
        print("شکست  کد واقعی (otp): کد پس از بازگرداندن حساب مصرف می‌شود")

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های کد یکبارمصرف گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
