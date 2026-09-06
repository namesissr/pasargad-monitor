#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون پشتیبانی و تیکت.

پنج قاعده که شکستن هرکدام هزینه دارد و هیچ‌کدام خطایی نمی‌سازد:

۱. **وضعیت از دید ماست، نه از دید مشتری.** open یعنی نوبت پاسخ ماست.
   با این تعریف فهرست open دقیقا همان صف کار است. اگر برعکس نوشته شود،
   پشتیبان باید هر بار حساب کند کدام تیکت نوبت اوست — و تیکت‌ها جا
   می‌مانند بی‌آنکه کسی بفهمد.

۲. **پیام مشتری تیکت بسته را دوباره باز می‌کند.** وگرنه مشتری‌ای که
   پیگیری می‌کند مجبور است تیکت تازه بسازد و سابقه از هم می‌پاشد.

۳. **مشتری فقط تیکت خودش را می‌بیند.** هر مسیر پرتال از
   requireOwnedTicket رد می‌شود که مالکیت را با customer_id تأیید
   می‌کند. پیام رد هم «پیدا نشد» است نه «دسترسی ندارید» — وگرنه وجود
   تیکت دیگران لو می‌رود.

۴. **شکست اطلاع‌رسانی هرگز جلوی ثبت پیام را نمی‌گیرد.** پیام اول ثبت
   می‌شود و بعد خبر می‌رود. خبرندادن بد است، گم‌شدن پیام بدتر.

۵. **سروری که به تیکت وصل می‌شود باید مال همان مشتری باشد.** شناسه سرور
   از مرورگر می‌آید؛ بدون تطبیق، تیکت به سرور کس دیگری می‌چسبد.

اجرا:  python3 scripts/test-tickets.py
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


def next_status(author):
    """
    بازسازی تصمیم وضعیت.

    وضعیت فقط با نویسنده پیام عوض می‌شود — نه با وضعیت قبلی. همین است
    که تیکت بسته با پیام مشتری دوباره باز می‌شود.
    """
    return "open" if author == "customer" else "answered"


def can_reply(status):
    """تیکت بسته هم پاسخ می‌پذیرد؛ پاسخ بازش می‌کند"""
    return status in ("open", "answered", "closed")


def queue_order(tickets):
    """
    بازسازی ترتیب صف پنل.

    اول باز، بعد پاسخ‌داده‌شده، آخر بسته؛ و بین هم‌وضعیت‌ها اولویت بالا
    جلوتر.
    """
    rank_status = {"open": 0, "answered": 1, "closed": 2}
    rank_priority = {"high": 0, "normal": 1, "low": 2}
    return sorted(
        tickets,
        key=lambda t: (rank_status[t["status"]], rank_priority[t["priority"]], t["id"]),
    )


STATUS_CASES = [
    ("customer", "open", "پیام مشتری — نوبت ماست"),
    ("admin", "answered", "پاسخ ما — نوبت مشتری"),
]

REOPEN_CASES = [
    ("closed", "customer", "open", "پاسخ مشتری تیکت بسته را باز می‌کند"),
    ("answered", "customer", "open", "پیگیری مشتری تیکت را برمی‌گرداند به صف کار"),
    ("open", "admin", "answered", "پاسخ ما تیکت باز را می‌بندد از صف کار"),
    ("closed", "admin", "answered", "پاسخ ما به تیکت بسته هم آن را باز نگه می‌دارد"),
]

QUEUE = [
    {"id": 1, "status": "closed", "priority": "high"},
    {"id": 2, "status": "answered", "priority": "high"},
    {"id": 3, "status": "open", "priority": "low"},
    {"id": 4, "status": "open", "priority": "high"},
    {"id": 5, "status": "open", "priority": "normal"},
]


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def main():
    failures = 0

    def check(name, got, expected):
        nonlocal failures
        if got == expected:
            print("گذشت  %s" % name)
        else:
            failures += 1
            print("شکست  %s — انتظار %r، نتیجه %r" % (name, expected, got))

    for author, expected, name in STATUS_CASES:
        check("وضعیت: %s" % name, next_status(author), expected)

    print("")

    for _before, author, expected, name in REOPEN_CASES:
        check("بازشدن: %s" % name, next_status(author), expected)

    print("")

    for status in ("open", "answered", "closed"):
        check("پاسخ‌پذیری: تیکت %s" % status, can_reply(status), True)

    print("")

    check(
        "ترتیب صف: باز و اولویت بالا جلوتر",
        [t["id"] for t in queue_order(QUEUE)],
        [4, 5, 3, 2, 1],
    )

    print("")

    lib = read("lib", "tickets.ts")
    guard = read("lib", "portal-guard.ts")
    plist = read("app", "api", "portal", "tickets", "route.ts")
    pthread = read("app", "api", "portal", "tickets", "[id]", "route.ts")
    admin = read("app", "api", "tickets", "route.ts")
    mig = read("db", "migrations", "039_tickets.sql")

    source_checks = [
        # ── قاعده ۱ و ۲: وضعیت با نویسنده عوض می‌شود ─────────
        (lib, "tickets", "author === 'customer' ? 'open' : 'answered'",
         "وضعیت فقط از نویسنده پیام می‌آید"),
        (mig, "مهاجرت ۰۳۹", "CHECK (status IN ('open', 'answered', 'closed'))",
         "وضعیت‌های مجاز در دیتابیس قفل شده‌اند"),
        (mig, "مهاجرت ۰۳۹", "last_reply_by",
         "نویسنده آخرین پیام روی تیکت نگه داشته می‌شود"),

        # ── قاعده ۳: مالکیت ──────────────────────────────────
        (guard, "portal-guard", "requireOwnedTicket", "نگهبان مالکیت تیکت هست"),
        (pthread, "portal/[id]", "await requireOwnedTicket(params.id)",
         "گفتگوی تیکت از نگهبان مالکیت رد می‌شود"),
        (plist, "portal", "await requireCustomer()", "فهرست تیکت‌ها نگهبان دارد"),
        (admin, "admin", "await requireUser()", "مسیر پنل نگهبان ادمین دارد"),

        # ── قاعده ۴: ثبت پیش از خبر ──────────────────────────
        (lib, "tickets", "INSERT INTO ticket_messages", "پیام ثبت می‌شود"),
        (lib, "tickets", "console.error", "شکست اطلاع‌رسانی لاگ می‌شود"),

        # ── قاعده ۵: سرور مال همان مشتری ─────────────────────
        (plist, "portal", "FROM servers WHERE id = $1 AND customer_id = $2",
         "سرور تیکت با مالکیت مشتری تطبیق داده می‌شود"),

        # ── اطلاع‌رسانی، همان چیزی که خواسته شده ─────────────
        (lib, "tickets", "notify(message)", "تیکت مشتری به ادمین خبر می‌دهد"),
        (lib, "tickets", "sendEmailTo(", "پاسخ ما به مشتری ایمیل می‌شود"),
        (lib, "tickets", "if (!res.ok)",
         "ایمیلی که نرفته لاگ می‌شود — sendEmailTo خطا پرتاب نمی‌کند"),
        (lib, "tickets", "customer_email", "ایمیل مشتری از دیتابیس خوانده می‌شود"),

        # ── شماره یکتا ───────────────────────────────────────
        (mig, "مهاجرت ۰۳۹", "TEXT NOT NULL UNIQUE", "شماره تیکت یکتاست"),
        (mig, "مهاجرت ۰۳۹", "ticket_number_seq", "شماره از دنباله دیتابیس می‌آید"),
        (lib, "tickets", "nextval('ticket_number_seq')",
         "شماره در دیتابیس ساخته می‌شود نه با شمردن ردیف‌ها"),

        # ── پاک‌شدن آبشاری ───────────────────────────────────
        (mig, "مهاجرت ۰۳۹", "REFERENCES customers(id) ON DELETE CASCADE",
         "حذف مشتری تیکت‌هایش را هم می‌برد"),
        (mig, "مهاجرت ۰۳۹", "REFERENCES servers(id) ON DELETE SET NULL",
         "حذف سرور تیکت را نمی‌برد، فقط پیوندش را باز می‌کند"),
    ]

    for src, label, needle, why in source_checks:
        if needle in src:
            print("گذشت  کد واقعی (%s): %s" % (label, why))
        else:
            failures += 1
            print("شکست  کد واقعی (%s): %s پیدا نشد" % (label, why))

    print("")

    # پیام رد نباید وجود تیکت دیگران را لو بدهد. فقط متن پرتاب‌شده مهم
    # است، نه توضیحی که دلیلش را می‌گوید — وگرنه همین توضیح آزمون را رد
    # می‌کند.
    thrown = re.findall(r"ForbiddenError\(\s*'([^']*)'\s*\)", guard)
    if any("دسترسی" in m for m in thrown):
        failures += 1
        print("شکست  کد واقعی (portal-guard): پیام رد وجود تیکت را لو می‌دهد")
    else:
        print("گذشت  کد واقعی (portal-guard): پیام رد وجود تیکت را لو نمی‌دهد")

    # مسیرهای پرتال هرگز نباید customer_id را از بدنه درخواست بخوانند
    for src, label in ((plist, "portal"), (pthread, "portal/[id]")):
        if re.search(r"\bbody\.customer_id\b", src):
            failures += 1
            print("شکست  کد واقعی (%s): مشتری از بدنه درخواست خوانده می‌شود" % label)
        else:
            print("گذشت  کد واقعی (%s): مشتری از نشست می‌آید نه از بدنه" % label)

    print("")

    # ثبت پیام باید پیش از اطلاع‌رسانی باشد — در هر دو مسیر
    for src, label in ((plist, "portal"), (pthread, "portal/[id]"), (admin, "admin")):
        add_at = src.find("addMessage(")
        tell_at = max(src.find("announceCustomerMessage("), src.find("announceAdminReply("))
        if -1 < add_at < tell_at:
            print("گذشت  کد واقعی (%s): پیام پیش از خبر ثبت می‌شود" % label)
        else:
            failures += 1
            print("شکست  کد واقعی (%s): خبر پیش از ثبت پیام فرستاده می‌شود" % label)

    print("")

    # نویسنده فقط دو مقدار می‌گیرد و در دیتابیس هم قفل است
    if "CHECK (author IN ('customer', 'admin'))" in mig:
        print("گذشت  کد واقعی (مهاجرت ۰۳۹): نویسنده پیام فقط مشتری یا ادمین است")
    else:
        failures += 1
        print("شکست  کد واقعی (مهاجرت ۰۳۹): نویسنده پیام محدود نشده")

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های تیکت گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
