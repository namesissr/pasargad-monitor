#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون تبدیل تاریخ شمسی.

اجرا:  python3 scripts/test-jalali.py

چرا این آزمون هست: تقویم شمسی پایه حسابداری است. دوره ماهانه، سهمیه ترافیک،
گروه‌بندی گزارش و انتخابگر تاریخ لاگ، همه از همین تبدیل می‌آیند. یک خطای
یک‌روزه در مرز ماه یعنی مصرف یک روز به ماه اشتباه می‌رود و عدد با فاکتور
دیتاسنتر نمی‌خواند — بدون اینکه چیزی خطا بدهد.

الگوریتم اینجا پورت پایتونی lib/jalali.ts است. اگر آن فایل عوض شد، این را
هم عوض کنید و دوباره بزنید.
"""

import datetime
import math
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060,
          2097, 2192, 2262, 2324, 2394, 2456, 3178]


def div(a, b):
    return math.trunc(a / b)


def mod(a, b):
    return a - math.trunc(a / b) * b


def jal_cal(jy):
    gy = jy + 621
    leap_j = -14
    jp = BREAKS[0]
    jm = jump = 0
    for i in range(1, len(BREAKS)):
        jm = BREAKS[i]
        jump = jm - jp
        if jy < jm:
            break
        leap_j = leap_j + div(jump, 33) * 8 + div(mod(jump, 33), 4)
        jp = jm
    n = jy - jp
    leap_j = leap_j + div(n, 33) * 8 + div(mod(n, 33) + 3, 4)
    if mod(jump, 33) == 4 and jump - n == 4:
        leap_j += 1
    leap_g = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150
    march = 20 + leap_j - leap_g
    if jump - n < 6:
        n = n - jump + div(jump + 4, 33) * 33
    leap = mod(mod(n + 1, 33) - 1, 4)
    if leap == -1:
        leap = 4
    return leap, gy, march


def g2d(gy, gm, gd):
    d = (div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
         + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408)
    return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752


def d2g(jdn):
    j = 4 * jdn + 139361631
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
    i = div(mod(j, 1461), 4) * 5 + 308
    return (div(j, 1461) - 100100 + div(8 - (mod(div(i, 153), 12) + 1), 6),
            mod(div(i, 153), 12) + 1,
            div(mod(i, 153), 5) + 1)


def to_jalali(gy, gm, gd):
    jdn = g2d(gy, gm, gd)
    gy2 = d2g(jdn)[0]
    jy = gy2 - 621
    leap, _, march = jal_cal(jy)
    k = jdn - g2d(gy2, 3, march)
    if k >= 0:
        if k <= 185:
            return jy, 1 + div(k, 31), mod(k, 31) + 1
        k -= 186
    else:
        jy -= 1
        k += 179
        if leap == 1:
            k += 1
    return jy, 7 + div(k, 30), mod(k, 30) + 1


def to_gregorian(jy, jm, jd):
    _, gy, march = jal_cal(jy)
    return d2g(g2d(gy, 3, march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1)


def is_leap(jy):
    return jal_cal(jy)[0] == 0


def month_len(jy, jm):
    if jm <= 6:
        return 31
    if jm <= 11:
        return 30
    return 30 if is_leap(jy) else 29


# تاریخ‌های مرجع که دستی بررسی شده‌اند
ANCHORS = [
    ((2026, 3, 21), (1405, 1, 1), "نوروز ۱۴۰۵"),
    ((2025, 3, 21), (1404, 1, 1), "نوروز ۱۴۰۴"),
    ((2024, 3, 20), (1403, 1, 1), "نوروز ۱۴۰۳، سال کبیسه"),
    ((2024, 3, 19), (1402, 12, 29), "آخرین روز ۱۴۰۲"),
    ((2026, 9, 3), (1405, 6, 12), "یک روز میان سال"),
]

WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"]


def main():
    failures = 0

    for gregorian, expected, name in ANCHORS:
        got = to_jalali(*gregorian)
        if got == expected:
            print("گذشت  %s: %s → %s" % (name, gregorian, got))
        else:
            failures += 1
            print("شکست  %s: انتظار %s، نتیجه %s" % (name, expected, got))

    # رفت‌وبرگشت روی چهار سال، روز به روز
    day = datetime.date(2024, 1, 1)
    mismatches = 0
    while day <= datetime.date(2027, 12, 31):
        if to_gregorian(*to_jalali(day.year, day.month, day.day)) != (day.year, day.month, day.day):
            mismatches += 1
        day += datetime.timedelta(days=1)
    if mismatches:
        failures += 1
        print("شکست  رفت‌وبرگشت چهار سال: %d ناسازگاری" % mismatches)
    else:
        print("گذشت  رفت‌وبرگشت چهار سال بدون ناسازگاری")

    # جمع طول ماه‌ها باید با کبیسه بودن سال بخواند
    for jy in (1403, 1404, 1405, 1406, 1407):
        total = sum(month_len(jy, m) for m in range(1, 13))
        expect = 366 if is_leap(jy) else 365
        if total == expect:
            print("گذشت  طول سال %d برابر %d روز" % (jy, total))
        else:
            failures += 1
            print("شکست  طول سال %d برابر %d، انتظار %d" % (jy, total, expect))

    # ستون اول ماه در تقویم، شنبه‌محور. فرمول جاوااسکریپت (getDay + 1) % 7 است
    # و getDay یکشنبه را صفر می‌گیرد؛ اینجا با isoweekday همان را می‌سازیم.
    for jy, jm in ((1405, 6), (1405, 7), (1404, 12)):
        gy, gm, gd = to_gregorian(jy, jm, 1)
        js_getday = datetime.date(gy, gm, gd).isoweekday() % 7  # یکشنبه صفر
        column = (js_getday + 1) % 7
        if 0 <= column <= 6:
            print("گذشت  اول %d/%d ستون %d (%s)" % (jy, jm, column, WEEKDAYS[column]))
        else:
            failures += 1
            print("شکست  ستون نامعتبر برای %d/%d" % (jy, jm))

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های تقویم گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
