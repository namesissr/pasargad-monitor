#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون فروشگاه: بسته ترافیک و محصول.

هر دو از همان خط لوله فاکتور و پرداخت رد می‌شوند، پس قاعده‌های آنجا
اینجا هم برقرارند. سه چیز تازه که شکستنشان بی‌صداست:

۱. **قیمت و مقدار هرگز از بدنه درخواست خوانده نمی‌شوند.** فقط شناسه
   بسته یا محصول از مشتری می‌آید. اگر قیمت از درخواست بیاید، مشتری با
   عوض‌کردن یک عدد سرور را هزار تومان می‌خرد.

۲. **سرور مقصد باید مال همان مشتری باشد.** بدون این بررسی، مشتری با
   عوض‌کردن یک عدد ترافیک خریداری‌شده را روی سرور کس دیگری می‌ریزد.

۳. **مقدار گیگ روی خود فاکتور کپی می‌شود.** اگر فقط ارجاع به بسته بود،
   ویرایش بسته پس از صدور فاکتور، شرایط فاکتور پرداخت‌نشده را عوض
   می‌کرد — مشتری چیزی می‌دید و چیز دیگری می‌گرفت.

اجرا:  python3 scripts/test-shop.py
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


def package_total(price_toman):
    """بسته ترافیک هزینه راه‌اندازی ندارد"""
    return round(float(price_toman))


def product_total(price_toman, setup_toman):
    """محصول: قیمت دوره به‌علاوه هزینه راه‌اندازی یک‌باره"""
    return round(float(price_toman) + float(setup_toman or 0))


def can_buy(stock):
    """
    تهی یعنی نامحدود.

    بررسی هنگام ساخت فاکتور است، نه رزرو. رزرو یعنی فاکتور رهاشده
    موجودی را تا ابد قفل کند.
    """
    if stock is None:
        return True
    return stock > 0


def decrement(stock):
    """
    کم‌کردن موجودی هنگام پرداخت.

    کمینه با صفر لازم است: دو نفر می‌توانند همزمان فاکتور یک محصول
    تک‌موجودی را ساخته باشند. موجودی منفی بی‌معنی است، و رد کردن پولی
    که گرفته شده بدتر از یک هشدار به ادمین است.
    """
    if stock is None:
        return None
    return max(stock - 1, 0)


def balance_after(current_gb, package_gb):
    """موجودی ترافیک پس از اعمال بسته"""
    return round(float(current_gb) + float(package_gb), 2)


TOTAL_CASES = [
    (500000, 0, 500000, "بدون هزینه راه‌اندازی"),
    (500000, 200000, 700000, "با هزینه راه‌اندازی"),
    (500000, None, 500000, "هزینه راه‌اندازی تهی"),
    (1200000, 0, 1200000, "قیمت بزرگ‌تر"),
]

STOCK_CASES = [
    (None, True, None, "نامحدود"),
    (5, True, 4, "موجودی عادی"),
    (1, True, 0, "آخرین عدد"),
    (0, False, 0, "تمام شده — خرید نمی‌شود"),
]

BALANCE_CASES = [
    (0, 1024, 1024, "سرور بدون ترافیک، یک ترابایت خرید"),
    (200, 1024, 1224, "روی موجودی قبلی می‌نشیند"),
    (-500, 1024, 524, "موجودی منفی جبران می‌شود"),
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

    for price, setup, expected, name in TOTAL_CASES:
        check("مبلغ: %s" % name, product_total(price, setup), expected)

    check("مبلغ: بسته ترافیک", package_total(750000), 750000)

    print("")

    for stock, buyable, after, name in STOCK_CASES:
        check("موجودی: %s (خرید)" % name, can_buy(stock), buyable)
        check("موجودی: %s (پس از پرداخت)" % name, decrement(stock), after)

    print("")

    for current, pack, expected, name in BALANCE_CASES:
        check("ترافیک: %s" % name, balance_after(current, pack), expected)

    print("")

    buy = read("app", "api", "portal", "shop", "buy", "route.ts")
    shop = read("app", "api", "portal", "shop", "route.ts")
    inv = read("lib", "invoices.ts")
    packages = read("app", "api", "packages", "route.ts")
    products = read("app", "api", "products", "route.ts")
    orders = read("app", "api", "orders", "route.ts")
    mig = read("db", "migrations", "036_shop.sql")

    source_checks = [
        # ── قاعده ۱: قیمت از دیتابیس ──────────────────────────
        (buy, "buy", "Math.round(Number(pack.price_toman))",
         "قیمت بسته از دیتابیس می‌آید"),
        (buy, "buy", "Number(product.price_toman) + Number(product.setup_toman)",
         "قیمت محصول از دیتابیس می‌آید"),

        # ── قاعده ۲: مالکیت سرور ─────────────────────────────
        (buy, "buy", "AND customer_id = $2 AND is_active",
         "سرور مقصد باید مال همان مشتری باشد"),

        # ── قاعده ۳: کپی شرایط روی فاکتور ────────────────────
        (buy, "buy", "traffic_gb", "مقدار گیگ روی فاکتور کپی می‌شود"),
        (buy, "buy", "Number(pack.gb)", "مقدار از بسته خوانده می‌شود، نه از درخواست"),
        (mig, "مهاجرت ۰۳۶", "traffic_gb NUMERIC", "ستون مقدار روی فاکتور"),
        (mig, "مهاجرت ۰۳۶", "product_name TEXT NOT NULL",
         "نام محصول روی سفارش کپی می‌شود تا حذف محصول سابقه را نبرد"),

        # ── تحویل ────────────────────────────────────────────
        (inv, "invoices", "INSERT INTO traffic_topups",
         "بسته پس از پرداخت روی سرور اعمال می‌شود"),
        (inv, "invoices", "Number(inv.traffic_gb)",
         "مقدار اعمال‌شده از فاکتور می‌آید نه از بسته"),
        (inv, "invoices", "kind IN ('quota_90', 'quota_100')",
         "هشدار اتمام ترافیک پس از خرید از نو مسلح می‌شود"),
        (inv, "invoices", "traffic_counted_from = CURRENT_DATE",
         "شمارش مصرف با اولین خرید شروع می‌شود"),
        (inv, "invoices", "GREATEST(p.stock - 1, 0)",
         "موجودی منفی نمی‌شود"),
        (inv, "invoices", "status = 'paid', paid_at = now()",
         "سفارش پس از پرداخت به صف تحویل می‌رود"),

        # ── فروشگاه مشتری ────────────────────────────────────
        (shop, "shop", "WHERE is_active", "فقط ردیف فعال به مشتری نشان داده می‌شود"),
        (shop, "shop", "(stock IS NULL OR stock > 0) AS in_stock",
         "عدد دقیق موجودی به مشتری نمی‌رود"),

        # ── ادمین ────────────────────────────────────────────
        (packages, "packages", "await requireUser()", "فقط ادمین بسته می‌سازد"),
        (products, "products", "await requireUser()", "فقط ادمین محصول می‌سازد"),
        (orders, "orders", "await requireUser()", "فقط ادمین سفارش را می‌بیند"),
        (orders, "orders", "AND customer_id = $2",
         "سرور تحویل باید مال همان مشتری باشد"),
        (packages, "packages", "SET is_active = FALSE",
         "بسته‌ای که فاکتور دارد حذف نمی‌شود، غیرفعال می‌شود"),
        (products, "products", "SET is_active = FALSE, updated_at = now()",
         "محصولی که سفارش دارد حذف نمی‌شود"),
    ]

    for src, label, needle, why in source_checks:
        if needle in src:
            print("گذشت  کد واقعی (%s): %s" % (label, why))
        else:
            failures += 1
            print("شکست  کد واقعی (%s): %s پیدا نشد" % (label, why))

    print("")

    # قیمت و مقدار هرگز نباید از بدنه درخواست خوانده شوند. این بررسی
    # صریح است چون همان حفره‌ای است که بیشترین ضرر را می‌زند.
    for field in ("price_toman", "amount_toman", "gb", "setup_toman", "traffic_gb"):
        bad = re.search(r"\bbody\.%s\b" % field, buy)
        if bad:
            failures += 1
            print("شکست  کد واقعی (buy): «%s» از بدنه درخواست خوانده می‌شود" % field)
        else:
            print("گذشت  کد واقعی (buy): «%s» از بدنه درخواست خوانده نمی‌شود" % field)

    print("")

    # تحویل باید داخل همان تراکنش قفل‌شده باشد، وگرنه رفرش صفحه بازگشت
    # دو بار ترافیک می‌دهد یا دو بار موجودی کم می‌کند
    lock_at = inv.find("FOR UPDATE OF i")
    topup_at = inv.find("INSERT INTO traffic_topups")
    commit_at = inv.find("await client.query('COMMIT')")
    if -1 < lock_at < topup_at < commit_at:
        print("گذشت  کد واقعی (invoices): تحویل داخل تراکنش قفل‌شده است")
    else:
        failures += 1
        print("شکست  کد واقعی (invoices): تحویل بیرون از تراکنش قفل‌شده است")

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های فروشگاه گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
