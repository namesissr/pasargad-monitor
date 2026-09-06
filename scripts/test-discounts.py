#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون کد تخفیف.

تخفیف **مبلغی** است نه درصدی: مبلغ ثابت از فاکتور کم می‌شود.

چهار قاعده که شکستن هرکدام هزینه دارد و هیچ‌کدام خطایی نمی‌سازد:

۱. **کد فقط پس از پرداخت موفق مصرف می‌شود.** اگر هنگام ساخت فاکتور
   مصرف شود، هر کسی با شروع و لغو مکرر خرید ظرفیت کد را می‌سوزاند بدون
   اینکه یک ریال بدهد.

۲. **مبلغ تخفیف سمت سرور محاسبه می‌شود.** فقط متن کد از مرورگر می‌آید.
   اگر مبلغ از درخواست بیاید، مشتری با عوض‌کردن یک عدد هر چیزی را
   رایگان می‌خرد.

۳. **تخفیف هرگز از مبلغ خرید بیشتر نمی‌شود.** وگرنه فاکتور مبلغ منفی
   می‌گیرد و درگاه هم آن را نمی‌پذیرد.

۴. **مبلغ تخفیف روی خود فاکتور کپی می‌شود.** ویرایش کد پس از صدور
   فاکتور نباید مبلغ فاکتور پرداخت‌نشده را عوض کند.

۵. **کد هدف‌دار فقط روی همان محصول یا همان بسته کار می‌کند.** کدی که
   برای یک محصول ساخته شده نباید روی محصول گران‌تر خرج شود — و چون
   شناسه محصول از مرورگر می‌آید، تطبیق باید سمت سرور انجام شود.

اجرا:  python3 scripts/test-discounts.py
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

TODAY = "2026-09-06"


def normalize(raw):
    """حروف بزرگ و بدون فاصله؛ وگرنه «tp» و «TP » دو کد متفاوت می‌شوند"""
    return str(raw or "").strip().upper()[:60]


def validate(code, opts):
    """
    بازسازی اعتبارسنجی.

    code دیکشنری تعریف کد است، یا None اگر کدی با آن نام نباشد.
    برمی‌گرداند (مبلغ تخفیف، علت رد).
    """
    if not code or not code.get("is_active", True):
        return (0, "کد تخفیف معتبر نیست")

    if code.get("starts_at") and opts["today"] < code["starts_at"]:
        return (0, "زمان استفاده از این کد هنوز نرسیده است")
    if code.get("expires_at") and opts["today"] > code["expires_at"]:
        return (0, "این کد منقضی شده است")

    # کد مخصوص یک مشتری: پیام عمدا همان «معتبر نیست» است تا معلوم نشود
    # کد مال کس دیگری است
    if code.get("customer_id") is not None and code["customer_id"] != opts["customer_id"]:
        return (0, "کد تخفیف معتبر نیست")

    scope = code.get("scope", "all")
    if scope != "all" and scope != opts["scope"]:
        return (0, "دامنه نمی‌خواند")

    # هدف مشخص: کد فقط روی همان محصول یا همان بسته کار می‌کند. هر دو
    # همزمان پر نمی‌شوند — قید discount_one_target در دیتابیس.
    if code.get("product_id") is not None:
        if opts["scope"] != "product" or code["product_id"] != opts.get("item_id"):
            return (0, "این کد برای این محصول نیست")
    if code.get("package_id") is not None:
        if opts["scope"] != "traffic" or code["package_id"] != opts.get("item_id"):
            return (0, "این کد برای این بسته نیست")

    if code.get("min_amount", 0) > opts["subtotal"]:
        return (0, "حداقل مبلغ خرید رعایت نشده")

    if code.get("max_uses") is not None and code.get("used_count", 0) >= code["max_uses"]:
        return (0, "ظرفیت این کد تمام شده است")

    if code.get("once_per_customer", True) and opts.get("used_by_customer", 0) > 0:
        return (0, "شما قبلا از این کد استفاده کرده‌اید")

    # تخفیف هرگز از مبلغ خرید بیشتر نمی‌شود
    return (min(round(code["amount"]), round(opts["subtotal"])), None)


def payable(subtotal, discount):
    return max(0, round(subtotal) - round(discount))


def consume(status_before, already_used_for_invoice):
    """
    بازسازی تصمیم مصرف.

    فقط با گذار unpaid → paid، و فقط یک بار برای هر فاکتور.
    """
    if status_before != "unpaid":
        return False
    return not already_used_for_invoice


PUBLIC = {"amount": 200000, "customer_id": None, "scope": "all", "is_active": True}
PRIVATE = {"amount": 500000, "customer_id": 7, "scope": "all", "is_active": True}

NORMALIZE_CASES = [
    ("nowruz", "NOWRUZ", "حروف کوچک"),
    ("  NOWRUZ  ", "NOWRUZ", "فاصله اضافی"),
    ("NoWrUz", "NOWRUZ", "حروف مخلوط"),
    ("", "", "خالی"),
]

VALIDATE_CASES = [
    # (کد، مشتری، دامنه، مبلغ، مصرف قبلی مشتری) → (تخفیف، رد شد؟)
    (PUBLIC, 7, "traffic", 1000000, 0, 200000, "کد عمومی، مشتری دلخواه"),
    (PUBLIC, 99, "product", 1000000, 0, 200000, "کد عمومی، مشتری دیگر"),
    (PRIVATE, 7, "traffic", 1000000, 0, 500000, "کد اختصاصی، همان مشتری"),
    # مهم: کد اختصاصی برای مشتری دیگر رد می‌شود
    (PRIVATE, 8, "traffic", 1000000, 0, 0, "کد اختصاصی، مشتری دیگر — رد"),
    # تخفیف بیشتر از مبلغ خرید
    ({**PUBLIC, "amount": 900000}, 7, "traffic", 500000, 0, 500000,
     "تخفیف بزرگ‌تر از خرید — تا همان مبلغ کم می‌شود"),
    # دامنه
    ({**PUBLIC, "scope": "traffic"}, 7, "traffic", 500000, 0, 200000, "دامنه ترافیک، خرید ترافیک"),
    ({**PUBLIC, "scope": "traffic"}, 7, "product", 500000, 0, 0, "دامنه ترافیک، خرید محصول — رد"),
    # حداقل خرید
    ({**PUBLIC, "min_amount": 800000}, 7, "traffic", 500000, 0, 0, "زیر حداقل خرید — رد"),
    ({**PUBLIC, "min_amount": 400000}, 7, "traffic", 500000, 0, 200000, "بالای حداقل خرید"),
    # ظرفیت
    ({**PUBLIC, "max_uses": 10, "used_count": 9}, 7, "traffic", 500000, 0, 200000, "یک ظرفیت مانده"),
    ({**PUBLIC, "max_uses": 10, "used_count": 10}, 7, "traffic", 500000, 0, 0, "ظرفیت تمام — رد"),
    # یک بار برای هر مشتری
    (PUBLIC, 7, "traffic", 500000, 1, 0, "مشتری قبلا استفاده کرده — رد"),
    ({**PUBLIC, "once_per_customer": False}, 7, "traffic", 500000, 3, 200000,
     "بدون محدودیت هر مشتری"),
    # غیرفعال و منقضی
    ({**PUBLIC, "is_active": False}, 7, "traffic", 500000, 0, 0, "غیرفعال — رد"),
    ({**PUBLIC, "expires_at": "2026-09-01"}, 7, "traffic", 500000, 0, 0, "منقضی — رد"),
    ({**PUBLIC, "starts_at": "2026-12-01"}, 7, "traffic", 500000, 0, 0, "هنوز شروع نشده — رد"),
    (None, 7, "traffic", 500000, 0, 0, "کد وجود ندارد — رد"),
]

# ── کد هدف‌دار ───────────────────────────────────────────────
# product_id یا package_id پر است: کد فقط روی همان یک مورد کار می‌کند.
# شناسه مورد از مرورگر می‌آید، پس تطبیق باید سمت سرور انجام شود — وگرنه
# کد تبلیغاتیِ یک محصول ارزان روی گران‌ترین محصول خرج می‌شود.
FOR_PRODUCT = {**PUBLIC, "scope": "product", "product_id": 5}
FOR_PACKAGE = {**PUBLIC, "scope": "traffic", "package_id": 5}

TARGET_CASES = [
    # (کد، دامنه، شناسه موردِ خریداری‌شده) → تخفیف
    (FOR_PRODUCT, "product", 5, 200000, "کد محصول، همان محصول"),
    (FOR_PRODUCT, "product", 6, 0, "کد محصول، محصول دیگر — رد"),
    (FOR_PRODUCT, "traffic", 5, 0, "کد محصول، خرید ترافیک — رد"),
    (FOR_PACKAGE, "traffic", 5, 200000, "کد بسته، همان بسته"),
    (FOR_PACKAGE, "traffic", 6, 0, "کد بسته، بسته دیگر — رد"),
    (FOR_PACKAGE, "product", 5, 0, "کد بسته، خرید محصول — رد"),
    # کد بدون هدف روی هر موردی کار می‌کند؛ شناسه بی‌اثر است
    (PUBLIC, "product", 6, 200000, "کد بدون هدف، هر محصولی"),
    (PUBLIC, "traffic", 99, 200000, "کد بدون هدف، هر بسته‌ای"),
]

PAYABLE_CASES = [
    (1000000, 200000, 800000, "تخفیف عادی"),
    (500000, 500000, 0, "تخفیف کامل — فاکتور صفر"),
    (500000, 0, 500000, "بدون تخفیف"),
    # مبلغ منفی هرگز ساخته نمی‌شود
    (300000, 900000, 0, "تخفیف بزرگ‌تر — صفر، نه منفی"),
]

CONSUME_CASES = [
    ("unpaid", False, True, "پرداخت تازه — کد مصرف می‌شود"),
    ("unpaid", True, False, "همین فاکتور قبلا مصرف کرده — دوباره نه"),
    ("paid", False, False, "فاکتور از قبل پرداخت‌شده — مصرف نمی‌شود"),
    ("canceled", False, False, "فاکتور لغو‌شده — مصرف نمی‌شود"),
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

    for raw, expected, name in NORMALIZE_CASES:
        check("یکسان‌سازی: %s" % name, normalize(raw), expected)

    print("")

    for code, customer, scope, subtotal, used, expected, name in VALIDATE_CASES:
        discount, _reason = validate(
            code,
            {
                "customer_id": customer,
                "scope": scope,
                "subtotal": subtotal,
                "used_by_customer": used,
                "today": TODAY,
            },
        )
        check("اعتبار: %s" % name, discount, expected)

    print("")

    for code, scope, item, expected, name in TARGET_CASES:
        discount, _reason = validate(
            code,
            {
                "customer_id": 7,
                "scope": scope,
                "subtotal": 1000000,
                "used_by_customer": 0,
                "item_id": item,
                "today": TODAY,
            },
        )
        check("هدف کد: %s" % name, discount, expected)

    print("")

    for subtotal, discount, expected, name in PAYABLE_CASES:
        check("مبلغ نهایی: %s" % name, payable(subtotal, discount), expected)

    print("")

    for status, used, expected, name in CONSUME_CASES:
        check("مصرف: %s" % name, consume(status, used), expected)

    print("")

    lib = read("lib", "discounts.ts")
    inv = read("lib", "invoices.ts")
    buy = read("app", "api", "portal", "shop", "buy", "route.ts")
    preview = read("app", "api", "portal", "shop", "discount", "route.ts")
    admin = read("app", "api", "discounts", "route.ts")
    mig = read("db", "migrations", "038_discounts.sql")
    mig39 = read("db", "migrations", "039_tickets.sql")

    source_checks = [
        # ── قاعده ۱: مصرف فقط پس از پرداخت ────────────────────
        (inv, "invoices", "INSERT INTO discount_uses", "کد در تسویه مصرف می‌شود"),
        (inv, "invoices", "used_count = used_count + 1", "شمارنده جلو می‌رود"),
        (inv, "invoices", "if (inserted.rows.length)",
         "شمارنده فقط وقتی جلو می‌رود که ردیف تازه درج شده باشد"),
        (mig, "مهاجرت ۰۳۸", "discount_uses_once_per_invoice",
         "یک فاکتور دو بار کد را مصرف نمی‌کند"),

        # ── قاعده ۲: محاسبه سمت سرور ─────────────────────────
        (buy, "buy", "await validateDiscount(body.discount_code", "فقط متن کد از مشتری می‌آید"),
        (preview, "preview", "validateDiscount(body.code", "پیش‌نمایش هم همان تابع را می‌زند"),
        (preview, "preview", "FROM traffic_packages", "مبلغ خرید از دیتابیس خوانده می‌شود"),

        # ── قاعده ۳: تخفیف بیشتر از خرید نمی‌شود ─────────────
        (lib, "discounts", "Math.min(Math.round(Number(row.amount_toman)), Math.round(opts.subtotal))",
         "تخفیف تا سقف مبلغ خرید"),
        (buy, "buy", "Math.max(0, subtotal - discount.discount)", "مبلغ نهایی هرگز منفی نمی‌شود"),

        # ── قاعده ۴: کپی روی فاکتور ──────────────────────────
        (mig, "مهاجرت ۰۳۸", "discount_toman BIGINT NOT NULL DEFAULT 0",
         "مبلغ تخفیف روی فاکتور کپی می‌شود"),
        (mig, "مهاجرت ۰۳۸", "subtotal_toman", "مبلغ پیش از تخفیف هم نگه داشته می‌شود"),
        (inv, "invoices", "Number(inv.discount_toman)", "مصرف از مبلغ فاکتور می‌آید نه از کد"),

        # ── دو نوع کد ────────────────────────────────────────
        (lib, "discounts", "row.customer_id !== null && row.customer_id !== opts.customerId",
         "کد اختصاصی فقط برای همان مشتری"),
        (lib, "discounts", "once_per_customer", "محدودیت یک بار برای هر مشتری"),

        # ── قاعده ۵: هدف کد ──────────────────────────────────
        (lib, "discounts", "row.product_id !== null",
         "کد محصول‌دار فقط روی همان محصول"),
        (lib, "discounts", "row.product_id !== opts.itemId",
         "شناسه محصول با موردِ خریداری‌شده تطبیق داده می‌شود"),
        (lib, "discounts", "row.package_id !== null", "کد بسته‌دار فقط روی همان بسته"),
        (lib, "discounts", "row.package_id !== opts.itemId",
         "شناسه بسته با موردِ خریداری‌شده تطبیق داده می‌شود"),
        (mig39, "مهاجرت ۰۳۹", "discount_one_target",
         "یک کد همزمان محصول و بسته را هدف نمی‌گیرد"),
        (mig39, "مهاجرت ۰۳۹", "ON DELETE CASCADE",
         "حذف محصول کد هدف‌دارش را هم می‌برد"),
        (buy, "buy", "itemId", "خرید شناسه مورد را به اعتبارسنجی می‌دهد"),
        (preview, "preview", "itemId", "پیش‌نمایش هم شناسه مورد را می‌دهد"),

        # ── فاکتور صفر ───────────────────────────────────────
        (mig, "مهاجرت ۰۳۸", "CHECK (amount_toman >= 0)", "فاکتور صفر مجاز است"),
        (buy, "buy", "settleIfFree", "تخفیف کامل بدون درگاه تحویل می‌شود"),

        (admin, "admin", "await requireUser()", "فقط ادمین کد می‌سازد"),
        (admin, "admin", "SET is_active = FALSE",
         "کدی که استفاده شده حذف نمی‌شود، غیرفعال می‌شود"),
    ]

    for src, label, needle, why in source_checks:
        if needle in src:
            print("گذشت  کد واقعی (%s): %s" % (label, why))
        else:
            failures += 1
            print("شکست  کد واقعی (%s): %s پیدا نشد" % (label, why))

    print("")

    # مبلغ تخفیف هرگز نباید از بدنه درخواست خوانده شود
    for field in ("discount", "discount_toman", "amount_toman", "payable", "subtotal"):
        if re.search(r"\bbody\.%s\b" % field, buy):
            failures += 1
            print("شکست  کد واقعی (buy): «%s» از بدنه درخواست خوانده می‌شود" % field)
        else:
            print("گذشت  کد واقعی (buy): «%s» از بدنه درخواست خوانده نمی‌شود" % field)

    print("")

    # مصرف باید داخل همان تراکنش قفل‌شده باشد
    lock_at = inv.find("FOR UPDATE OF i")
    use_at = inv.find("INSERT INTO discount_uses")
    commit_at = inv.find("await client.query('COMMIT')")
    if -1 < lock_at < use_at < commit_at:
        print("گذشت  کد واقعی (invoices): مصرف کد داخل تراکنش قفل‌شده است")
    else:
        failures += 1
        print("شکست  کد واقعی (invoices): مصرف کد بیرون از تراکنش قفل‌شده است")

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های کد تخفیف گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
