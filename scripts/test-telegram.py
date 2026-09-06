#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون اطلاع‌رسانی تلگرام به مشتری.

پنج قاعده که شکستن هرکدام یا یک حفره امنیتی است یا یک خرابی بی‌صدا:

۱. **شناسه گفتگو از تلگرام می‌آید، نه از مرورگر.** این کل نکته امنیتی
   این بخش است. اگر مشتری شناسه را در فرم می‌نوشت، هر کسی می‌توانست
   شناسه یک نفر دیگر را بنویسد و هشدارهای او را بگیرد.

۲. **کد اتصال یکبارمصرف و منقضی‌شدنی است**، و مصرفش در همان
   به‌روزرسانی‌ای انجام می‌شود که شرط‌ها را بررسی می‌کند — وگرنه دو پیام
   همزمان یک کد را دو بار مصرف می‌کنند.

۳. **یک گفتگو به دو حساب وصل نمی‌شود.** ایندکس یکتا در دیتابیس، و
   پاک‌کردن اتصال قبلی پیش از اتصال تازه.

۴. **offset پردازش پیام‌ها ذخیره می‌شود و همیشه جلو می‌رود.** بدون آن،
   ورکر پس از هر ری‌استارت همان /start قدیمی را دوباره پردازش می‌کند؛ و
   اگر فقط هنگام موفقیت جلو می‌رفت، یک پیام خراب تا ابد تکرار می‌شد.

۵. **کانال‌های مشتری از یک جا می‌روند.** افزودن کانال تازه نباید در هر
   نقطه اطلاع‌رسانی تکرار شود؛ آن یکی که فراموش می‌شود هیچ خطایی
   نمی‌دهد، فقط مشتری خبردار نمی‌شود.

اجرا:  python3 scripts/test-telegram.py
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

LINK_TTL_MIN = 5


def claim(token, now_min):
    """
    بازسازی تصمیم مصرف کد اتصال.

    token دیکشنری است یا None. برمی‌گرداند رشته نتیجه.
    """
    if not token:
        return "unknown"
    if token.get("consumed"):
        return "consumed"
    if token["age_min"] >= LINK_TTL_MIN:
        return "expired"
    return "ok"


def next_offset(current, update_ids, failed_ids):
    """
    بازسازی محاسبه offset.

    همیشه از بزرگ‌ترین شناسه دیده‌شده جلو می‌رود، حتی اگر پردازش بعضی
    پیام‌ها شکست خورده باشد.
    """
    if not update_ids:
        return current
    return max([current - 1] + list(update_ids)) + 1


CLAIM_CASES = [
    ({"age_min": 0, "consumed": False}, "ok", "کد تازه"),
    ({"age_min": 4, "consumed": False}, "ok", "یک دقیقه مانده به انقضا"),
    ({"age_min": 5, "consumed": False}, "expired", "منقضی"),
    ({"age_min": 1, "consumed": True}, "consumed", "قبلا استفاده شده"),
    (None, "unknown", "کد وجود ندارد"),
]

OFFSET_CASES = [
    (0, [], [], 0, "هیچ پیامی نبود — offset دست‌نخورده"),
    (0, [10, 11, 12], [], 13, "سه پیام موفق"),
    (13, [13, 14], [14], 15, "یکی شکست خورد ولی offset باز هم جلو می‌رود"),
    (100, [100], [100], 101, "تنها پیام شکست خورد — تکرار نمی‌شود"),
]


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def strip_comments(src):
    """کد بدون توضیحات؛ وگرنه توضیحِ یک قاعده، خودِ بررسی را سبز می‌کند"""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)
    src = re.sub(r"^\s*--.*$", "", src, flags=re.M)
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

    for token, expected, name in CLAIM_CASES:
        check("کد اتصال: %s" % name, claim(token, 0), expected)

    print("")

    for cur, ids, failed, expected, name in OFFSET_CASES:
        check("offset: %s" % name, next_offset(cur, ids, failed), expected)

    print("")

    link = read("worker", "telegram-link.mjs")
    route = read("app", "api", "portal", "telegram", "route.ts")
    notify = read("lib", "customer-notify.ts")
    alerts = read("worker", "customer-alerts.mjs")
    tickets = read("lib", "tickets.ts")
    invoices = read("lib", "invoices.ts")
    mig = read("db", "migrations", "043_customer_telegram.sql")

    source_checks = [
        # ── قاعده ۱: شناسه از تلگرام ─────────────────────────
        (link, "telegram-link", "String(msg?.chat?.id", "شناسه گفتگو از خود پیام برداشته می‌شود"),
        (mig, "مهاجرت ۰۴۳", "telegram_chat_id", "ستون شناسه گفتگو"),

        # ── قاعده ۲: کد یکبارمصرف ────────────────────────────
        (link, "telegram-link", "consumed_at IS NULL AND expires_at > now()",
         "کد فقط اگر مصرف‌نشده و منقضی‌نشده باشد پذیرفته می‌شود"),
        (link, "telegram-link", "SET consumed_at = now()",
         "مصرف در همان به‌روزرسانی شرط‌ها انجام می‌شود"),
        (route, "portal/telegram", "expires_at", "کد تاریخ انقضا می‌گیرد"),
        (route, "portal/telegram", "randomBytes(", "کد با تصادف رمزنگاری‌شده ساخته می‌شود"),

        # ── قاعده ۳: یک گفتگو، یک حساب ───────────────────────
        (mig, "مهاجرت ۰۴۳", "customers_telegram_uq", "ایندکس یکتا روی شناسه گفتگو"),
        (link, "telegram-link", "WHERE telegram_chat_id = $1 AND id <> $2",
         "اتصال قبلی همان گفتگو پیش از اتصال تازه پاک می‌شود"),

        # ── قاعده ۴: offset ──────────────────────────────────
        (link, "telegram-link", "telegram_updates_offset", "offset ذخیره می‌شود"),
        (mig, "مهاجرت ۰۴۳", "telegram_updates_offset", "کلید offset در تنظیمات"),

        # ── قاعده ۵: یک نقطه اطلاع‌رسانی ─────────────────────
        (notify, "customer-notify", "sendSms(", "پیامک یکی از کانال‌هاست"),
        (notify, "customer-notify", "sendEmailTo(", "ایمیل یکی از کانال‌هاست"),
        (notify, "customer-notify", "sendTelegram(", "تلگرام یکی از کانال‌هاست"),
        (tickets, "tickets", "notifyCustomer(", "پاسخ تیکت از همان نقطه می‌رود"),
        (invoices, "invoices", "notifyCustomer(", "خبر پرداخت از همان نقطه می‌رود"),
        (alerts, "customer-alerts", "sendTelegram(", "هشدار سهمیه و تمدید هم تلگرام دارد"),

        # ── قابل خاموش‌کردن، و خرابی صدادار ──────────────────
        (notify, "customer-notify", "telegram_customer_enabled", "قابل خاموش‌کردن است"),
        (link, "telegram-link", "Conflict",
         "اگر وب‌هوک تنظیم باشد، ورکر صریح هشدار می‌دهد"),
        (route, "portal/telegram", "telegram_bot_username",
         "بدون نام ربات، رابط به‌جای لینک خراب پیام می‌دهد"),
    ]

    for src, label, needle, why in source_checks:
        if needle in src:
            print("گذشت  کد واقعی (%s): %s" % (label, why))
        else:
            failures += 1
            print("شکست  کد واقعی (%s): %s پیدا نشد" % (label, why))

    print("")

    # مسیر پرتال هرگز نباید شناسه گفتگو را از بدنه درخواست بپذیرد.
    # این همان حفره‌ای است که کل طراحی برای بستنش است.
    code = strip_comments(route)
    if re.search(r"\bbody\b", code) or "chat_id" in code and "telegram_chat_id = NULL" not in code:
        bad = re.search(r"\bbody\.[a-z_]+", code)
        if bad:
            failures += 1
            print("شکست  کد واقعی (portal/telegram): از بدنه درخواست ورودی می‌گیرد — %s" % bad.group(0))
        else:
            print("گذشت  کد واقعی (portal/telegram): شناسه گفتگو از بدنه درخواست نمی‌آید")
    else:
        print("گذشت  کد واقعی (portal/telegram): شناسه گفتگو از بدنه درخواست نمی‌آید")

    # مسیر پرتال نباید مستقیم telegram_chat_id را مقداردهی کند؛ فقط
    # پاک‌کردنش مجاز است.
    if re.search(r"telegram_chat_id\s*=\s*\$\d", code):
        failures += 1
        print("شکست  کد واقعی (portal/telegram): شناسه گفتگو از سمت مرورگر نوشته می‌شود")
    else:
        print("گذشت  کد واقعی (portal/telegram): شناسه گفتگو فقط در ورکر نوشته می‌شود")

    print("")

    # offset باید بیرون از حلقه و پس از آن نوشته شود، نه داخلش
    loop_at = link.find("for (const u of updates)")
    save_at = link.find("telegram_updates_offset', $1")
    if -1 < loop_at < save_at:
        print("گذشت  کد واقعی (telegram-link): offset پس از پردازش همه پیام‌ها ذخیره می‌شود")
    else:
        failures += 1
        print("شکست  کد واقعی (telegram-link): offset پیش از پردازش ذخیره می‌شود")

    # و هیچ خروجی زودهنگامی نباید بینشان باشد.
    #
    # این همان چیزی است که «offset همیشه جلو می‌رود» را واقعا تضمین
    # می‌کند. اگر ذخیره پشت شرطِ موفقیت برود، یک پیام خرابِ همیشگی
    # ورکر را در جای خودش قفل می‌کند و هیچ اتصال تازه‌ای انجام نمی‌شود.
    #
    # بازسازی پایتونی این را نمی‌گیرد: آن فقط منطق خودش را می‌آزماید.
    between = link[loop_at:save_at] if -1 < loop_at < save_at else ""
    if "return" in strip_comments(between):
        failures += 1
        print("شکست  کد واقعی (telegram-link): خروج زودهنگام پیش از ذخیره offset")
    else:
        print("گذشت  کد واقعی (telegram-link): هیچ خروج زودهنگامی پیش از ذخیره offset نیست")

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های تلگرام مشتری گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
