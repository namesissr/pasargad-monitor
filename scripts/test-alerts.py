#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون منطق هشدار مشتری: آستانه‌های ترافیک و موعد تمدید.

آستانه‌ها روی ترافیک پیش‌خرید حساب می‌شوند (سرور اختصاصی سهمیه ماهانه
ندارد). ریاضیِ خودِ موجودی در scripts/test-topups.py قفل شده؛ اینجا فقط
دو آستانه و قاعده تمدید.

بازسازی تصمیم‌های worker/customer-alerts.mjs.

چرا این آزمون هست: خطا اینجا دو شکل دارد و هر دو بد است. پیامک تکراری
یعنی مشتری یاد می‌گیرد نادیده بگیرد؛ پیامک نرفته یعنی سهمیه تمام شده و
کسی خبر ندارد. هیچ‌کدام هم خطایی در لاگ نمی‌سازد.

اجرا:  python3 scripts/test-alerts.py
"""

import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def quota_alert(used_gb, quota_gb):
    """
    بازسازی تصمیم آستانه ترافیک (quota_gb یعنی مجموع ترافیک خریداری‌شده).

    ترتیب مهم است: صد درصد اول بررسی می‌شود. با ترتیب برعکس، مصرفی که از
    سهمیه گذشته هم «۹۰ درصد» گزارش می‌شد و هشدار اتمام هرگز نمی‌رفت.
    """
    if not quota_gb or quota_gb <= 0:
        return None
    pct = (used_gb / quota_gb) * 100
    if pct >= 100:
        return "quota_100"
    if pct >= 90:
        return "quota_90"
    return None


def renewal_alert(days_left, notice_days):
    """
    بازسازی تصمیم تمدید.

    بعد از موعد چیزی فرستاده نمی‌شود: تمدیدنشدن دیگر خبر نیست، وضعیت
    است. فرستادن هر روزِ پس از موعد یعنی پیامک بی‌پایان.
    """
    return days_left <= notice_days and days_left >= 0


QUOTA_CASES = [
    (0, 100, None, "بدون مصرف"),
    (89.9, 100, None, "زیر آستانه"),
    (90, 100, "quota_90", "دقیقا نود درصد"),
    (95, 100, "quota_90", "بین نود و صد"),
    (100, 100, "quota_100", "دقیقا صد درصد"),
    # مهم: مصرف بیشتر از سهمیه باید «اتمام» باشد، نه «نود درصد»
    (250, 100, "quota_100", "بیشتر از سهمیه"),
    (500, 0, None, "چیزی نخریده"),
    (500, None, None, "خرید تهی"),
]

RENEWAL_CASES = [
    (10, 3, False, "ده روز مانده، هشدار سه روزه"),
    (3, 3, True, "دقیقا سر آستانه"),
    (1, 3, True, "یک روز مانده"),
    (0, 3, True, "امروز موعد است"),
    (-1, 3, False, "دیروز بوده — دیگر خبر نیست"),
    (-30, 3, False, "خیلی گذشته"),
    (0, 0, True, "بدون هشدار قبلی، فقط روز موعد"),
    (1, 0, False, "یک روز مانده ولی هشدار قبلی صفر است"),
]


def main():
    failures = 0

    def check(name, got, expected):
        nonlocal failures
        if got == expected:
            print("گذشت  %s" % name)
        else:
            failures += 1
            print("شکست  %s — انتظار %r، نتیجه %r" % (name, expected, got))

    for used, quota, expected, name in QUOTA_CASES:
        check("سهمیه: %s" % name, quota_alert(used, quota), expected)

    print("")

    for days, notice, expected, name in RENEWAL_CASES:
        check("تمدید: %s" % name, renewal_alert(days, notice), expected)

    print("")

    src = io.open(os.path.join(ROOT, "worker", "customer-alerts.mjs"), encoding="utf-8").read()

    for needle, why in [
        ("if (pct >= 100) {", "اتمام سهمیه پیش از نود درصد بررسی می‌شود"),
        ("} else if (pct >= 90) {", "نود درصد فقط وقتی که هنوز تمام نشده"),
        ("daysLeft <= notice && daysLeft >= 0", "پس از موعد چیزی فرستاده نمی‌شود"),
        ("ON CONFLICT (server_id, kind, period_key) DO NOTHING", "هر هشدار یک بار"),
        ("RETURNING id", "ثبت‌شدن ردیف تعیین می‌کند پیامک برود یا نه"),
        ("WHERE s.is_active AND c.is_active", "مشتری یا سرور غیرفعال هشدار نمی‌گیرد"),
    ]:
        if needle in src:
            print("گذشت  کد واقعی: %s" % why)
        else:
            failures += 1
            print("شکست  کد واقعی: %s پیدا نشد" % why)

    # ثبت باید پیش از ارسال باشد: اگر برعکس بود، هر خطای گذرا در ارسال
    # یعنی تلاش دوباره و پیامک تکراری
    claim_at = src.find("if (await claim(")
    send_at = src.find("await dispatch(")
    if claim_at != -1 and send_at != -1 and claim_at < send_at:
        print("گذشت  کد واقعی: ثبت پیش از ارسال")
    else:
        failures += 1
        print("شکست  کد واقعی: ثبت باید پیش از ارسال باشد")

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های هشدار مشتری گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
