#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون اطلاعیه و ارسال همگانی.

شش قاعده که شکستن هرکدام یا پیام را به آدم اشتباه می‌رساند یا اصلا
نمی‌رساند — و هیچ‌کدام خطایی نمی‌سازد:

۱. **خوانده‌شدن برای هر مشتری جداست.** با یک ستون روی خود اطلاعیه،
   اولین کسی که «متوجه شدم» را می‌زد آن را برای همه می‌بست.

۲. **فیلتر بازه و فعال‌بودن در کوئری است، نه در رابط.** اگر رابط فیلتر
   می‌کرد، اطلاعیه منقضی هم به مرورگر می‌رفت.

۳. **پاپ‌آپ فقط با دکمه بسته می‌شود.** نه با کلیک بیرون، نه با Escape.
   اطلاعیه‌ای که اتفاقی بسته شود، هم خوانده نشده و هم دیگر برنمی‌گردد.

۴. **اگر ثبت «متوجه شدم» شکست بخورد، پنجره بسته نمی‌شود.** بستنش یعنی
   کاربر فکر می‌کند تمام شده ولی دفعه بعد همان اطلاعیه دوباره می‌آید.

۵. **ارسال همگانی در صف می‌رود، نه در همان درخواست.** چند صد ارسال در
   یک درخواست HTTP تایم‌اوت می‌شود و معلوم نمی‌ماند چند نفر پیام
   گرفته‌اند — و ادمین دوباره می‌فرستد.

۶. **ایمیل و پیامک جدا هستند.** پیامک هزینه دارد؛ با یک فرم مشترک، کسی
   که عجله دارد بدون اینکه بخواهد چند صد پیامک می‌فرستد.

اجرا:  python3 scripts/test-announcements.py
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

NOW = 100


def visible(ann, read_by_me, now=NOW):
    """بازسازی تصمیم نمایش یک اطلاعیه به یک مشتری"""
    if not ann.get("is_active", True):
        return False
    if read_by_me:
        return False
    if ann.get("starts_at") is not None and ann["starts_at"] > now:
        return False
    if ann.get("ends_at") is not None and ann["ends_at"] <= now:
        return False
    return True


def order_key(ann):
    """اطلاعیه مهم‌تر اول؛ بین هم‌رتبه‌ها تازه‌تر اول"""
    rank = {"danger": 0, "warn": 1, "info": 2}
    return (rank[ann["severity"]], -ann["created"])


def reachable(customers, channel):
    """گیرنده‌های یک کانال. مشتری بدون آن کانال اصلا ردیف نمی‌گیرد."""
    key = "email" if channel == "email" else "phone"
    return [c for c in customers if c.get(key)]


VISIBLE_CASES = [
    ({"is_active": True}, False, True, "فعال و خوانده‌نشده"),
    ({"is_active": True}, True, False, "خوانده شده"),
    ({"is_active": False}, False, False, "غیرفعال"),
    ({"is_active": True, "starts_at": 150}, False, False, "هنوز شروع نشده"),
    ({"is_active": True, "starts_at": 100}, False, True, "دقیقا لحظه شروع"),
    ({"is_active": True, "ends_at": 100}, False, False, "دقیقا لحظه پایان — تمام"),
    ({"is_active": True, "ends_at": 101}, False, True, "یک واحد مانده به پایان"),
    ({"is_active": True, "starts_at": 50, "ends_at": 150}, False, True, "وسط بازه"),
    ({"is_active": False, "starts_at": 50, "ends_at": 150}, False, False,
     "وسط بازه ولی خاموش"),
]

CUSTOMERS = [
    {"id": 1, "name": "الف", "email": "a@x.com", "phone": "09120000001"},
    {"id": 2, "name": "ب", "email": None, "phone": "09120000002"},
    {"id": 3, "name": "پ", "email": "c@x.com", "phone": None},
    {"id": 4, "name": "ت", "email": None, "phone": None},
]

REACH_CASES = [
    ("email", [1, 3], "فقط کسانی که ایمیل دارند"),
    ("sms", [1, 2], "فقط کسانی که شماره دارند"),
]


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def strip_comments(src):
    """کد بدون توضیحات؛ وگرنه توضیحِ یک قاعده، خودِ بررسی را سبز می‌کند"""
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

    for ann, was_read, expected, name in VISIBLE_CASES:
        check("نمایش: %s" % name, visible(ann, was_read), expected)

    print("")

    ordered = sorted(
        [
            {"severity": "info", "created": 30},
            {"severity": "danger", "created": 10},
            {"severity": "warn", "created": 20},
            {"severity": "danger", "created": 40},
        ],
        key=order_key,
    )
    check(
        "ترتیب: مهم‌تر اول، بین هم‌رتبه‌ها تازه‌تر اول",
        [(a["severity"], a["created"]) for a in ordered],
        [("danger", 40), ("danger", 10), ("warn", 20), ("info", 30)],
    )

    print("")

    for channel, expected, name in REACH_CASES:
        check(
            "گیرنده: %s" % name,
            [c["id"] for c in reachable(CUSTOMERS, channel)],
            expected,
        )

    print("")

    portal = read("app", "api", "portal", "announcements", "route.ts")
    admin = read("app", "api", "announcements", "route.ts")
    modal = read("components", "AnnouncementModal.tsx")
    bcast = read("app", "api", "broadcasts", "route.ts")
    worker = read("worker", "broadcasts.mjs")
    panel = read("app", "(panel)", "settings", "broadcast.tsx")
    mig = read("db", "migrations", "045_announcements.sql")

    source_checks = [
        # ── قاعده ۱: خوانده‌شدن برای هر مشتری ────────────────
        (mig, "مهاجرت ۰۴۵", "PRIMARY KEY (announcement_id, customer_id)",
         "خوانده‌شدن کلید مرکب دارد"),
        (portal, "portal", "r.customer_id IS NULL",
         "فقط اطلاعیه‌هایی که همین مشتری نخوانده"),
        (portal, "portal", "ON CONFLICT (announcement_id, customer_id) DO NOTHING",
         "زدن دوباره دکمه خطا نمی‌دهد"),

        # ── قاعده ۲: فیلتر در کوئری ─────────────────────────
        (portal, "portal", "a.starts_at IS NULL OR a.starts_at <= now()",
         "شرط شروع در کوئری است"),
        (portal, "portal", "a.ends_at   IS NULL OR a.ends_at   >  now()",
         "شرط پایان در کوئری است"),
        (portal, "portal", "WHERE a.is_active", "اطلاعیه خاموش اصلا برنمی‌گردد"),

        # ── قاعده ۳ و ۴: رفتار پاپ‌آپ ───────────────────────
        (modal, "modal", "متوجه شدم", "دکمه بستن"),
        (modal, "modal", "aria-modal", "پنجره برای صفحه‌خوان هم پنجره است"),
        (modal, "modal", "setItems((list) => list.slice(1))",
         "پنجره فقط پس از ثبت موفق بسته می‌شود"),
        (modal, "modal", "document.body.style.overflow",
         "صفحه پشت پنجره اسکرول نمی‌شود"),

        # ── قاعده ۵: صف ─────────────────────────────────────
        (bcast, "broadcasts", "INSERT INTO broadcast_recipients",
         "گیرنده‌ها در لحظه صف ثبت می‌شوند"),
        (bcast, "broadcasts", "ON CONFLICT (broadcast_id, customer_id) DO NOTHING",
         "یک مشتری در یک ارسال فقط یک بار"),
        (worker, "worker", "LIMIT $2", "ارسال دسته‌دسته انجام می‌شود"),
        (worker, "worker", "BATCH = 20", "اندازه دسته محدود است"),
        (worker, "worker", "still.status === 'canceled'",
         "لغو وسط کار فورا اثر می‌کند"),
        (mig, "مهاجرت ۰۴۵", "broadcast_recipient_once",
         "یکتایی گیرنده در دیتابیس هم هست"),

        # ── قاعده ۶: جدایی ایمیل و پیامک ────────────────────
        (bcast, "broadcasts", "channel !== 'email' && channel !== 'sms'",
         "کانال فقط یکی از این دو"),
        (panel, "panel", 'channel="email"', "کارت ایمیل جداست"),
        (panel, "panel", 'channel="sms"', "کارت پیامک جداست"),
        (panel, "panel", "پیامک هزینه دارد", "هزینه پیامک پیش از ارسال گفته می‌شود"),

        # ── سابقه، و نشانی کپی‌شده ──────────────────────────
        (bcast, "broadcasts", "address", "نشانی در لحظه صف کپی می‌شود"),
        (admin, "announcements", "این اطلاعیه را مشتری‌ها دیده‌اند و حذف نمی‌شود",
         "اطلاعیه دیده‌شده حذف نمی‌شود"),
    ]

    for src, label, needle, why in source_checks:
        if needle in src:
            print("گذشت  کد واقعی (%s): %s" % (label, why))
        else:
            failures += 1
            print("شکست  کد واقعی (%s): %s پیدا نشد" % (label, why))

    print("")

    # پاپ‌آپ نباید با کلیک بیرون یا Escape بسته شود
    code = strip_comments(modal)
    if re.search(r"onKeyDown|Escape|onClick=\{[^}]*close", code):
        failures += 1
        print("شکست  کد واقعی (modal): راهی جز دکمه برای بستن هست")
    else:
        print("گذشت  کد واقعی (modal): تنها راه بستن، دکمه است")

    # پرده نباید onClick داشته باشد.
    #
    # کل تگ بررسی می‌شود، از <div تا بسته‌شدنش. نسخه اول از روی نام
    # کلاس به جلو می‌رفت و onClickی که پیش از className نوشته شده بود
    # را نمی‌دید — یعنی بررسی‌ای که هیچ‌وقت شکست نمی‌خورد.
    def enclosing_tag(src, needle):
        at = src.find(needle)
        if at == -1:
            return ""
        start = src.rfind("<", 0, at)
        end = src.find(">", at)
        return src[start : end + 1] if start != -1 and end != -1 else ""

    backdrop = enclosing_tag(code, "bg-rack/80")
    if not backdrop:
        failures += 1
        print("شکست  کد واقعی (modal): پرده پنجره پیدا نشد")
    elif "onClick" in backdrop:
        failures += 1
        print("شکست  کد واقعی (modal): کلیک روی پرده پنجره را می‌بندد")
    else:
        print("گذشت  کد واقعی (modal): کلیک روی پرده کاری نمی‌کند")

    print("")

    # مسیر ارسال همگانی نباید خودش پیام بفرستد
    bc = strip_comments(bcast)
    for fn in ("sendSms(", "sendEmailTo("):
        if fn in bc:
            failures += 1
            print("شکست  کد واقعی (broadcasts): «%s» در مسیر ای‌پی‌آی صدا زده می‌شود" % fn)
        else:
            print("گذشت  کد واقعی (broadcasts): «%s» در مسیر ای‌پی‌آی نیست" % fn)

    print("")

    # وضعیت گیرنده باید پیش از افزایش شمارنده نوشته شود: اگر پروسه وسط
    # کار بمیرد، شمارنده‌ای که جلوتر از واقعیت باشد گمراه‌کننده است
    row_at = worker.find("UPDATE broadcast_recipients")
    counter_at = worker.find("SET sent = sent + 1")
    if -1 < row_at < counter_at:
        print("گذشت  کد واقعی (worker): وضعیت گیرنده پیش از شمارنده نوشته می‌شود")
    else:
        failures += 1
        print("شکست  کد واقعی (worker): شمارنده پیش از وضعیت گیرنده نوشته می‌شود")

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های اطلاعیه و ارسال همگانی گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
