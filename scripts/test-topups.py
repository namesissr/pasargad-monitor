#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون ترافیک پیش‌خرید.

سرور اختصاصی سهمیه ماهانه ندارد. مشترک از همان اول ترافیک می‌خرد، و هر
وقت تمام شد دوباره می‌خرد. ترافیک خریداری‌شده انقضا ندارد.

    موجودی = مجموع خریدها − مصرف از تاریخ شروع شمارش

بازسازی تصمیم‌های app/api/topups/route.ts و worker/customer-alerts.mjs.

چرا این آزمون هست: سه اشتباه اینجا هیچ خطایی نمی‌سازد.

۱. اگر مصرف از ابتدای تاریخِ سرور شمرده شود، سروری که ماه‌ها پیش از
   شروع فروش پیش‌خرید کار می‌کرده از همان لحظه اولین خرید بدهکار به
   دنیا می‌آید — با موجودی منفی و پیامک اتمام فوری.
۲. اگر کلید یکتایی هشدار، ماه صورتحساب باشد، هشدار اتمام هر ماه از نو
   می‌آید در حالی که هیچ اتفاق تازه‌ای نیفتاده.
۳. اگر هشدار پس از خرید تازه مسلح نشود، مشتری‌ای که دوباره خریده و باز
   تمام کرده هیچ خبری نمی‌گیرد. سکوت، نه خطا.

اجرا:  python3 scripts/test-topups.py
"""

import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def balance(purchases, daily_usage, counted_from):
    """
    موجودی ترافیک.

    purchases    فهرست عددهای خرید (منفی هم مجاز است، برای اصلاح)
    daily_usage  فهرست (روز، گیگ مصرف) — روز به شکل رشته قابل مقایسه
    counted_from روز شروع شمارش؛ None یعنی هنوز خریدی نبوده

    مصرف پیش از counted_from شمرده نمی‌شود.
    """
    purchased = sum(purchases)
    if counted_from is None:
        used = 0.0
    else:
        used = sum(g for day, g in daily_usage if day >= counted_from)
    return round(purchased - used, 2)


def alert(purchased_gb, used_gb):
    """
    تصمیم هشدار.

    ترتیب مهم است: صد درصد اول بررسی می‌شود. با ترتیب برعکس، مصرفی که از
    خرید گذشته هم «۹۰ درصد» گزارش می‌شد و هشدار اتمام هرگز نمی‌رفت.
    """
    if not purchased_gb or purchased_gb <= 0:
        return None                    # چیزی نخریده، چیزی هم هشدار ندارد
    pct = (used_gb / purchased_gb) * 100
    if pct >= 100:
        return "quota_100"
    if pct >= 90:
        return "quota_90"
    return None


def validate(gb, price):
    """بازسازی اعتبارسنجی POST"""
    if gb is None or gb != gb or gb == 0:
        return "مقدار ترافیک را وارد کنید"
    if abs(gb) > 1000000:
        return "مقدار ترافیک بیش از حد بزرگ است"
    if price is not None and price < 0:
        return "مبلغ نامعتبر است"
    return None


USAGE = [
    ("1404-04-10", 300),   # پیش از شروع شمارش
    ("1404-04-25", 200),   # پیش از شروع شمارش
    ("1404-05-05", 400),
    ("1404-05-20", 350),
    ("1404-06-02", 150),
]

BALANCE_CASES = [
    ([1000], USAGE, "1404-05-01", 100, "مصرف پیش از شروع شمارش حساب نمی‌شود"),
    # همان داده، ولی از ابتدای تاریخ: مشتری بی‌دلیل بدهکار می‌شود
    ([1000], USAGE, "1404-01-01", -400, "بدون تاریخ شروع، مشتری بدهکار به دنیا می‌آید"),
    ([1000], USAGE, None, 1000, "هنوز مصرفی شمرده نشده"),
    ([1000, 500], USAGE, "1404-05-01", 600, "خرید دوم روی موجودی می‌نشیند"),
    ([1000], [], "1404-05-01", 1000, "بدون مصرف"),
    ([1000, -200], USAGE, "1404-05-01", -100, "اصلاح با ترافیک منفی"),
    ([500], USAGE, "1404-05-01", -400, "بیشتر از خرید مصرف شده — موجودی منفی"),
]

# سناریوی واقعی: می‌خرد، تمام می‌کند، دوباره می‌خرد
REBUY = [
    ([1000], 900, "quota_90", "رو به اتمام"),
    ([1000], 1000, "quota_100", "تمام شد"),
    ([1000], 1400, "quota_100", "از خرید هم گذشته"),
    ([1000, 1000], 1400, None, "بعد از خرید دوم، دوباره زیر آستانه"),
    ([1000, 1000], 1850, "quota_90", "خرید دوم هم رو به اتمام"),
    ([1000, 1000], 2000, "quota_100", "خرید دوم هم تمام شد"),
]

VALIDATE_CASES = [
    (0, None, "مقدار ترافیک را وارد کنید", "صفر پذیرفته نمی‌شود"),
    (None, None, "مقدار ترافیک را وارد کنید", "خالی پذیرفته نمی‌شود"),
    (500, None, None, "خرید عادی"),
    (-500, None, None, "منفی برای اصلاح مجاز است"),
    (2000000, None, "مقدار ترافیک بیش از حد بزرگ است", "عدد بی‌معنا"),
    (500, -1, "مبلغ نامعتبر است", "مبلغ منفی"),
    (500, 0, None, "مبلغ صفر مجاز است"),
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

    for buys, usage, start, expected, name in BALANCE_CASES:
        check("موجودی: %s" % name, balance(buys, usage, start), expected)

    print("")

    for buys, used, expected, name in REBUY:
        check("هشدار: %s" % name, alert(sum(buys), used), expected)

    print("")

    check("هشدار: چیزی نخریده", alert(0, 5000), None)
    check("هشدار: دقیقا نود درصد", alert(1000, 900), "quota_90")
    check("هشدار: زیر آستانه", alert(1000, 899), None)

    print("")

    for gb, price, expected, name in VALIDATE_CASES:
        check("اعتبارسنجی: %s" % name, validate(gb, price), expected)

    print("")

    route = read("app", "api", "topups", "route.ts")
    alerts = read("worker", "customer-alerts.mjs")
    portal = read("app", "api", "portal", "route.ts")
    srv_list = read("app", "api", "servers", "route.ts")
    srv_one = read("app", "api", "servers", "[id]", "route.ts")
    mig = read("db", "migrations", "031_prepaid_traffic.sql")

    source_checks = [
        (route, "topups", "await requireUser()", "فقط ادمین ثبت می‌کند"),
        (route, "topups", "traffic_counted_from = CURRENT_DATE", "شمارش با اولین خرید شروع می‌شود"),
        (route, "topups", "traffic_counted_from IS NULL", "تاریخ شروع فقط یک بار گذاشته می‌شود"),
        (route, "topups", "DELETE FROM customer_notices", "هشدار پس از خرید تازه از نو مسلح می‌شود"),
        (route, "topups", "kind IN ('quota_90', 'quota_100')", "فقط هشدار ترافیک پاک می‌شود، نه تمدید"),
        (route, "topups", "if (gb > 0)", "اصلاح منفی هشدار را از نو مسلح نمی‌کند"),
        (alerts, "هشدار", "if (srv.purchased_gb > 0)", "سروری که خریدی ندارد هشدار نمی‌گیرد"),
        (alerts, "هشدار", "if (pct >= 100) {", "اتمام پیش از نود درصد بررسی می‌شود"),
        (alerts, "هشدار", "} else if (pct >= 90) {", "نود درصد فقط وقتی هنوز تمام نشده"),
        (alerts, "هشدار", "srv.counted_from, detail)", "کلید یکتایی تاریخ شروع است، نه ماه"),
        (alerts, "هشدار", "ON CONFLICT (server_id, kind, period_key) DO NOTHING", "هر هشدار یک بار"),
        (mig, "مهاجرت ۰۳۱", "traffic_counted_from", "ستون تاریخ شروع شمارش"),
        (mig, "مهاجرت ۰۳۱", "DROP COLUMN IF EXISTS kind", "ماشین‌آلات تسویه برچیده شد"),
        (mig, "مهاجرت ۰۳۱", "DELETE FROM traffic_topups WHERE kind = 'settlement'",
         "ردیف‌های تسویه پاک می‌شوند وگرنه مصرف دو بار کم می‌شود"),
    ]

    for src, label, needle, why in source_checks:
        if needle in src:
            print("گذشت  کد واقعی (%s): %s" % (label, why))
        else:
            failures += 1
            print("شکست  کد واقعی (%s): %s پیدا نشد" % (label, why))

    # ثبت باید پیش از ارسال باشد، وگرنه هر خطای گذرا یعنی پیامک تکراری
    claim_at = alerts.find("if (await claim(")
    send_at = alerts.find("await dispatch(")
    if claim_at != -1 and send_at != -1 and claim_at < send_at:
        print("گذشت  کد واقعی (هشدار): ثبت پیش از ارسال")
    else:
        failures += 1
        print("شکست  کد واقعی (هشدار): ثبت باید پیش از ارسال باشد")

    # هر جایی که مصرف پیش‌خرید را می‌خواند باید تاریخ شروع را رعایت کند.
    # بدون آن، مشتری از روز اول بدهکار است.
    for src, label in [
        (alerts, "customer-alerts"),
        (portal, "portal"),
        (srv_list, "servers"),
        (srv_one, "servers/[id]"),
    ]:
        if "server_metrics_daily" not in src or "traffic_topups" not in src:
            failures += 1
            print("شکست  کد واقعی (%s): موجودی پیش‌خرید خوانده نمی‌شود" % label)
        elif "d.day >= s.traffic_counted_from" in src:
            print("گذشت  کد واقعی (%s): مصرف فقط از تاریخ شروع شمارش" % label)
        else:
            failures += 1
            print("شکست  کد واقعی (%s): مصرف بدون تاریخ شروع شمرده می‌شود" % label)

    # ماشین‌آلات تسویه نباید جایی مانده باشد
    if os.path.exists(os.path.join(ROOT, "worker", "topup-settle.mjs")):
        failures += 1
        print("شکست  کد واقعی: worker/topup-settle.mjs هنوز هست")
    else:
        print("گذشت  کد واقعی: ماشین‌آلات تسویه دوره‌ای برچیده شده")

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های ترافیک پیش‌خرید گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
