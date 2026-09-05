#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون فاکتور و درگاه پرداخت.

سه قاعده اینجا هست که شکستن هرکدام یعنی از دست دادن پول، و هیچ‌کدام
خطایی در هیچ لاگی نمی‌سازد:

۱. **مبلغ تأیید از دیتابیس می‌آید، نه از آدرس بازگشت.** اگر از پارامتر
   خوانده شود، کاربر فاکتور ده‌میلیونی را با تأیید هزار تومان
   پرداخت‌شده می‌کند. رایج‌ترین حفره در درگاه‌های ایرانی همین است.

۲. **تأیید اید‌مپوتنت است.** ردیف با FOR UPDATE قفل می‌شود و اگر از قبل
   paid باشد نتیجه قبلی برمی‌گردد. رفرش صفحه بازگشت نباید دو بار سرویس
   بدهد یا دو بار پیامک بفرستد.

۳. **تمدید به انتهای دوره اضافه می‌شود، نه به امروز.** با
   now() + interval، مشتری‌ای که زودتر پرداخت می‌کند روزهای
   باقی‌مانده‌اش را می‌سوزاند.

اجرا:  python3 scripts/test-invoices.py
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


def to_gateway_amount(toman, unit):
    """
    بازسازی تبدیل واحد.

    همه چیز در پروژه تومان است. اگر حساب درگاه ریال بخواهد، ضرب در ده
    فقط و فقط اینجا انجام می‌شود. تبدیل در دو جا یعنی مبلغ صد برابر یا
    یک‌صدم می‌رود — و درگاه هم می‌پذیردش.
    """
    value = round(float(toman or 0))
    if value <= 0:
        return None                      # مبلغ نامعتبر
    return value * 10 if str(unit).lower() == "rial" else value


def settle(status, paid_before):
    """
    بازسازی تصمیم تسویه.

    برمی‌گرداند (موفق، از_قبل_پرداخت_شده، سرویس_تمدید_شود).
    """
    if status == "paid":
        # نتیجه قبلی برمی‌گردد و هیچ کاری تکرار نمی‌شود
        return (True, True, False)
    if status == "canceled":
        return (False, False, False)
    return (True, False, True)


def renew(current_end, today, months):
    """
    بازسازی محاسبه تاریخ تمدید تازه.

    از انتهای دوره جلو می‌رود، نه از امروز — مگر وقتی دوره خیلی گذشته
    باشد که آن وقت از امروز شروع می‌شود، وگرنه تمدید در گذشته می‌نشیند
    و سرور همان لحظه دوباره سررسید می‌شود.
    """
    base = max(current_end, today)
    return base + months * 30            # ساده‌شده: روزشمار


AMOUNT_CASES = [
    (150000, "toman", 150000, "تومان، بدون تبدیل"),
    (150000, "rial", 1500000, "ریال، ضرب در ده"),
    (1, "toman", 1, "کمترین مبلغ"),
    (0, "toman", None, "صفر پذیرفته نمی‌شود"),
    (-5000, "toman", None, "منفی پذیرفته نمی‌شود"),
    (99999.6, "toman", 100000, "گرد می‌شود"),
]

SETTLE_CASES = [
    ("unpaid", False, (True, False, True), "پرداخت تازه — سرویس تمدید می‌شود"),
    # مهم‌ترین: رفرش صفحه بازگشت
    ("paid", True, (True, True, False), "از قبل پرداخت شده — چیزی تکرار نمی‌شود"),
    ("canceled", False, (False, False, False), "فاکتور لغو‌شده پرداخت نمی‌شود"),
]

RENEW_CASES = [
    # (پایان فعلی، امروز، ماه) → پایان تازه
    (100, 90, 1, 130, "پرداخت زودهنگام — روزهای باقی‌مانده نمی‌سوزد"),
    (100, 100, 1, 130, "پرداخت سر موعد"),
    (100, 105, 1, 135, "چند روز دیرتر — از امروز جلو می‌رود"),
    (100, 400, 1, 430, "خیلی دیر — تمدید در گذشته نمی‌نشیند"),
    (100, 90, 12, 460, "دوره یک‌ساله"),
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

    for toman, unit, expected, name in AMOUNT_CASES:
        check("مبلغ: %s" % name, to_gateway_amount(toman, unit), expected)

    print("")

    for status, paid, expected, name in SETTLE_CASES:
        check("تسویه: %s" % name, settle(status, paid), expected)

    print("")

    for end, today, months, expected, name in RENEW_CASES:
        check("تمدید: %s" % name, renew(end, today, months), expected)

    print("")

    inv = read("lib", "invoices.ts")
    pp = read("worker", "payping.mjs")
    pay = read("app", "api", "portal", "invoices", "[id]", "pay", "route.ts")
    verify = read("app", "api", "portal", "invoices", "[id]", "verify", "route.ts")
    admin = read("app", "api", "invoices", "route.ts")
    worker = read("worker", "invoices.mjs")
    mig = read("db", "migrations", "035_invoices.sql")
    ret = read("app", "api", "pay", "return", "[id]", "route.ts")
    orders = read("app", "api", "orders", "route.ts")
    delivery = read("lib", "delivery-email.ts")

    source_checks = [
        # ── قاعده ۱: مبلغ از دیتابیس ──────────────────────────
        (inv, "invoices", "amountToman: Number(inv.amount_toman)",
         "مبلغ تأیید از ردیف دیتابیس می‌آید"),
        (pay, "pay", "amountToman: Number(inv.amount_toman)",
         "مبلغ شروع پرداخت هم از دیتابیس می‌آید"),

        # ── قاعده ۲: اید‌مپوتنت ──────────────────────────────
        (inv, "invoices", "FOR UPDATE OF i", "ردیف فاکتور قفل می‌شود"),
        (inv, "invoices", "if (inv.status === 'paid')",
         "فاکتور پرداخت‌شده دوباره تسویه نمی‌شود"),
        (inv, "invoices", "alreadyPaid: true", "نتیجه قبلی برمی‌گردد"),

        # ── قاعده ۳: تمدید از انتهای دوره ────────────────────
        (inv, "invoices", "GREATEST(COALESCE(renews_at, CURRENT_DATE), CURRENT_DATE)",
         "تمدید از انتهای دوره جلو می‌رود، نه از امروز"),

        # ── درگاه ────────────────────────────────────────────
        (pp, "payping", "toGatewayAmount", "تبدیل واحد فقط یک جا"),
        (pp, "payping", "clientRefId", "شماره فاکتور به درگاه می‌رود"),
        (pp, "payping", "readCallback", "پارامترهای بازگشت با نام‌های مختلف خوانده می‌شوند"),
        (pp, "payping", "body?.code || body?.paymentCode", "هر دو نسخه ای‌پی‌آی"),

        # ── مالکیت ───────────────────────────────────────────
        (pay, "pay", "AND i.customer_id = $2", "فاکتور فقط با شناسه مشتری خوانده می‌شود"),
        (verify, "verify", "AND customer_id = $2", "تأیید هم مالکیت را می‌سنجد"),

        # ── صدور خودکار ──────────────────────────────────────
        (worker, "worker", "ON CONFLICT (server_id, period_from)",
         "فاکتور تکراری برای یک دوره ساخته نمی‌شود"),
        (worker, "worker", "if (!rows.length) continue",
         "فاکتور تکراری، پیامک تکراری هم نمی‌فرستد"),
        (worker, "worker", "s.renewal_price_toman > 0",
         "سروری که قیمت ندارد فاکتور نمی‌گیرد"),

        (mig, "مهاجرت ۰۳۵", "invoices_renewal_once", "ایندکس یکتای فاکتور تمدید"),
        (mig, "مهاجرت ۰۳۵", "renewal_price_toman", "قیمت فروش، جدا از هزینه ما"),
        (admin, "admin", "settleInvoice(id,", "ثبت دستی پرداخت از همان مسیر می‌گذرد"),

        # ── رد تلاش ناموفق ────────────────────────────────────
        #
        # پول کم‌شده و فاکتور بازمانده، بدترین حالت ممکن است. نسخه اول
        # فقط یک خط در لاگ کانتینر می‌گذاشت، یعنی بی‌سروصدا اتفاق
        # می‌افتاد.
        (ret, "return", "recordFailure(", "هر شکست روی فاکتور ثبت می‌شود"),
        (ret, "return", "payment_error = $2", "علت شکست ذخیره می‌شود"),
        (ret, "return", "callback_raw = $3",
         "پارامترهای خام درگاه ذخیره می‌شوند تا نام ناشناخته قابل تشخیص باشد"),
        (ret, "return", "await notify(", "شکست پرداخت فورا به ادمین خبر می‌دهد"),
        (ret, "return", "if (inv.status === 'paid') return to('already')",
         "بازگشت دوباره روی فاکتور پرداخت‌شده چیزی را خراب نمی‌کند"),
    ]

    for src, label, needle, why in source_checks:
        if needle in src:
            print("گذشت  کد واقعی (%s): %s" % (label, why))
        else:
            failures += 1
            print("شکست  کد واقعی (%s): %s پیدا نشد" % (label, why))

    print("")

    # مبلغ هرگز نباید از پارامتر درخواست خوانده شود. این بررسی صریح است
    # چون همان حفره‌ای است که بیشترین ضرر را می‌زند.
    for src, label in ((verify, "verify"), (pay, "pay"), (inv, "invoices")):
        bad = re.search(r"searchParams\.get\(\s*['\"](amount|amount_toman|price)['\"]", src)
        if bad:
            failures += 1
            print("شکست  کد واقعی (%s): مبلغ از پارامتر درخواست خوانده می‌شود" % label)
        else:
            print("گذشت  کد واقعی (%s): مبلغ از پارامتر خوانده نمی‌شود" % label)

    # تمدید نباید از now() شروع شود
    if re.search(r"renews_at\s*=\s*now\(\)\s*\+", inv) or "CURRENT_DATE +" in inv.replace(
        "GREATEST(COALESCE(renews_at, CURRENT_DATE), CURRENT_DATE)", ""
    ):
        failures += 1
        print("شکست  کد واقعی (invoices): تمدید از امروز شروع می‌شود، نه از انتهای دوره")
    else:
        print("گذشت  کد واقعی (invoices): تمدید از امروز شروع نمی‌شود")

    # ثبت لاگ اطلاع‌رسانی باید بیرون از تراکنش باشد؛ پیامک کند است و
    # نگه‌داشتن قفل روی آن یعنی بازگشت‌های همزمان پشت هم می‌مانند
    commit_at = inv.find("await client.query('COMMIT')")
    announce_at = inv.find("await announcePaid(inv)")
    if commit_at != -1 and announce_at != -1 and commit_at < announce_at:
        print("گذشت  کد واقعی (invoices): اطلاع‌رسانی بیرون از تراکنش")
    else:
        failures += 1
        print("شکست  کد واقعی (invoices): اطلاع‌رسانی داخل تراکنش است و قفل را نگه می‌دارد")

    print("")

    # ── رمز سرور هرگز ذخیره نمی‌شود ──────────────────────────
    #
    # ادمین رمز را در فرم تحویل می‌نویسد و همان لحظه در ایمیل می‌رود.
    # نگهداری‌اش یعنی یک دامپ دیتابیس، رمز همه سرورهای تحویل‌شده را لو
    # می‌دهد.
    #
    # این بررسی به کوئری‌های نوشتن نگاه می‌کند، نه به وجود کلمه: خود
    # متغیر password باید باشد، ولی نباید در هیچ INSERT یا UPDATE برود.
    writes = re.findall(r"(INSERT INTO[^`]*|UPDATE\s+\w+[^`]*)", orders)
    leaked = [w for w in writes if "password" in w.lower()]
    if leaked:
        failures += 1
        print("شکست  کد واقعی (orders): رمز در کوئری نوشتن می‌رود — %s" % leaked[0][:70])
    else:
        print("گذشت  کد واقعی (orders): رمز در هیچ کوئری نوشتنی نمی‌رود")

    if "const password = String(body.password" in orders:
        print("گذشت  کد واقعی (orders): رمز از فرم خوانده و فقط ایمیل می‌شود")
    else:
        failures += 1
        print("شکست  کد واقعی (orders): رمز از فرم خوانده نمی‌شود")

    # پیامک نباید رمز داشته باشد: رمزنگاری نمی‌شود و روی صفحه قفل گوشی
    # پیش‌نمایش می‌شود
    sms_calls = re.findall(r"sendSms\(([^;]*?)\);", orders, re.S)
    if any("password" in c for c in sms_calls):
        failures += 1
        print("شکست  کد واقعی (orders): رمز در پیامک می‌رود")
    else:
        print("گذشت  کد واقعی (orders): پیامک رمز ندارد")

    for needle, why in (
        ("گذرواژه", "رمز در ایمیل تحویل می‌آید"),
        ("آی‌پی", "آی‌پی در ایمیل تحویل می‌آید"),
        ("سیستم عامل", "سیستم عامل در ایمیل تحویل می‌آید"),
        ("esc(v)", "مقادیر مشخصات خنثی می‌شوند"),
    ):
        if needle in delivery:
            print("گذشت  کد واقعی (تحویل): %s" % why)
        else:
            failures += 1
            print("شکست  کد واقعی (تحویل): %s پیدا نشد" % why)

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های فاکتور و پرداخت گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
