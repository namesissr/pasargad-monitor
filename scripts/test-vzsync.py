#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون منطق همگام‌سازی ویژالیزور — بدون تماس با هیچ نود واقعی.

سه بخش:
  ۱. ریاضی ماسک و شبکه (maskToPrefix و networkOf در worker/vz-sync.mjs)
  ۲. جدول تصمیم اعمال — کدام آدرس بچسبد، کدام جدا شود، کدام دست‌نخورده
  ۳. تطبیق کد واقعی با جدول

چرا این آزمون هست: بخش «اعمال» روی پنل ویژالیزور واقعی می‌نویسد. اشتباه
در جدول تصمیم می‌تواند آی‌پی یک مشتری را از سرورش بردارد. این جدول باید
قفل باشد.

اجرا:  python3 scripts/test-vzsync.py
"""

import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ANCHOR = "77"


def mask_to_prefix(netmask):
    """بازسازی maskToPrefix — نقطه‌ای یا عددی، با بررسی پیوستگی بیت‌ها"""
    raw = str(netmask or "").strip()

    if len(raw) in (1, 2) and raw.isdigit():
        n = int(raw)
        return n if 8 <= n <= 32 else None

    parts = raw.split(".")
    if len(parts) != 4:
        return None
    value = 0
    for part in parts:
        if not part.isdigit():
            return None
        n = int(part)
        if n < 0 or n > 255:
            return None
        value = value * 256 + n

    bits = 0
    for i in range(31, -1, -1):
        if (value >> i) & 1 == 0:
            break
        bits += 1
    expected = 0 if bits == 0 else (0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF
    if value != expected:
        return None

    return bits if 8 <= bits <= 32 else None


def network_of(ip, prefix):
    """بازسازی networkOf"""
    parts = str(ip or "").split(".")
    if len(parts) != 4 or prefix is None:
        return None
    value = 0
    for part in parts:
        if not part.isdigit():
            return None
        n = int(part)
        if n < 0 or n > 255:
            return None
        value = value * 256 + n
    mask = 0 if prefix == 0 else (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF
    net = value & mask
    return "%d.%d.%d.%d/%d" % (
        (net >> 24) & 255, (net >> 16) & 255, (net >> 8) & 255, net & 255, prefix,
    )


MASK_CASES = [
    ("255.255.255.0", 24, "ماسک ۲۴ رایج"),
    ("255.255.252.0", 22, "ماسک ۲۲"),
    ("255.255.255.224", 27, "ماسک ۲۷"),
    ("255.255.255.240", 28, "ماسک ۲۸"),
    ("255.255.255.248", 29, "ماسک ۲۹"),
    ("255.255.255.252", 30, "ماسک ۳۰"),
    ("255.0.0.0", 8, "ماسک ۸"),
    ("255.255.255.255", 32, "تک‌آدرس"),
    # ماسک نامعتبر نباید عددی برگرداند — ساب‌نت غلط بدتر از نبود ساب‌نت
    # است، چون پرفیکس بایند از همان می‌آید
    ("255.255.0", None, "ماسک ناقص"),
    ("", None, "ماسک خالی"),
    ("255.255.255.1", None, "بیت‌های ناپیوسته — ماسک معتبر نیست"),
    ("255.0.255.0", None, "ناپیوسته در وسط"),
    ("0.0.0.0", None, "کوتاه‌تر از ۸"),
    ("abc.def.ghi.jkl", None, "ماسک بی‌معنی"),
    # ویژالیزور گاهی ماسک را عددی می‌دهد
    ("24", 24, "ماسک عددی"),
    ("8", 8, "ماسک عددی کوچک"),
    ("32", 32, "ماسک عددی بیشینه"),
    ("7", None, "عددی کمتر از ۸"),
    ("33", None, "عددی بیشتر از ۳۲"),
]

NETWORK_CASES = [
    ("95.38.101.5", 24, "95.38.101.0/24", "آدرس وسط بلوک ۲۴"),
    ("95.38.101.0", 24, "95.38.101.0/24", "خود شبکه"),
    ("10.20.30.200", 22, "10.20.28.0/22", "بلوک ۲۲"),
    ("172.16.5.9", 8, "172.0.0.0/8", "بلوک ۸"),
    # بلوک‌های کوچک‌تر از ۲۴ — هر آی‌پی پرفیکس بلوک خودش را می‌گیرد
    ("178.239.146.35", 27, "178.239.146.32/27", "گیت‌وی وسط بلوک ۲۷"),
    ("178.239.146.33", 27, "178.239.146.32/27", "اولین آدرس قابل استفاده ۲۷"),
    ("178.239.146.62", 27, "178.239.146.32/27", "آخرین آدرس بلوک ۲۷"),
    ("178.239.146.64", 27, "178.239.146.64/27", "بلوک ۲۷ بعدی، جدا"),
    ("10.0.0.9", 29, "10.0.0.8/29", "بلوک ۲۹"),
    ("1.2.3.4", None, None, "بدون پرفیکس"),
    ("bad", 24, None, "آدرس خراب"),
]


def decide(vz_vpsid, locked, panel):
    """
    بازسازی حلقه applyNode در worker/vz-sync.mjs.

    «on_anchor» یعنی این آدرس روی یکی از لنگرهای همین هایپروایزر نشسته.
    یک هایپروایزر می‌تواند چند لنگر داشته باشد — برای نودهایی که در
    دیتاسنترهای مختلف‌اند — ولی جدول تصمیم برای همه یکسان است.
    """
    free = vz_vpsid in ("0", "")
    on_anchor = vz_vpsid == ANCHOR

    if locked or (not free and not on_anchor):
        return "skip"
    if panel is None:
        return "none"
    if panel["status"] == "released":
        if on_anchor and panel["managed"]:
            return "detach"
        return "none"
    if free and panel["watch"]:
        return "attach"
    return "none"


W = {"status": "blocked", "watch": True, "managed": True}
R = {"status": "released", "watch": True, "managed": True}
RM = {"status": "released", "watch": True, "managed": False}
NOWATCH = {"status": "blocked", "watch": False, "managed": False}

DECISION_CASES = [
    ("0", False, W, "attach", "آزاد و اکسس‌شده → به لنگر بچسبد"),
    (ANCHOR, False, W, "none", "از قبل روی لنگر و اکسس‌شده → بماند"),
    (ANCHOR, False, R, "detach", "روی لنگر و آزاد شد → برداشته شود"),
    # آدرس بدون علامت مدیریت، هنوز جدا نمی‌شود. ولی کشف هر آدرسی را که
    # روی لنگر بنشیند علامت می‌زند، پس این حالت در عمل موقتی است — وگرنه
    # آی‌پی آزادشده تا ابد روی لنگر اشغال می‌ماند.
    (ANCHOR, False, RM, "none", "آزاد شد ولی هنوز علامت مدیریت نخورده"),
    ("99", False, W, "skip", "روی وی‌پی‌اس مشتری → هرگز دست نزن"),
    ("99", False, R, "skip", "روی وی‌پی‌اس مشتری حتی اگر آزاد شده → دست نزن"),
    ("99", False, None, "skip", "روی وی‌پی‌اس مشتری و ناشناخته → دست نزن"),
    ("0", True, W, "skip", "قفل‌شده در ویژالیزور → دست نزن"),
    (ANCHOR, True, R, "skip", "قفل‌شده حتی روی لنگر → دست نزن"),
    ("0", False, None, "none", "آزاد و در پنل نیست → کشف واردش می‌کند، نه اعمال"),
    ("0", False, NOWATCH, "none", "آزاد ولی بدون تیک پایش → نچسبان"),
]


def main():
    failures = 0

    for netmask, expected, name in MASK_CASES:
        got = mask_to_prefix(netmask)
        if got == expected:
            print("گذشت  ماسک: %s → %s" % (name, got))
        else:
            failures += 1
            print("شکست  ماسک: %s — انتظار %s، نتیجه %s" % (name, expected, got))

    print("")

    for ip, prefix, expected, name in NETWORK_CASES:
        got = network_of(ip, prefix)
        if got == expected:
            print("گذشت  شبکه: %s → %s" % (name, got))
        else:
            failures += 1
            print("شکست  شبکه: %s — انتظار %s، نتیجه %s" % (name, expected, got))

    print("")

    for vps, locked, panel, expected, name in DECISION_CASES:
        got = decide(vps, locked, panel)
        if got == expected:
            print("گذشت  تصمیم: %s → %s" % (name, got))
        else:
            failures += 1
            print("شکست  تصمیم: %s — انتظار %s، نتیجه %s" % (name, expected, got))

    # کد واقعی باید با جدول بالا بخواند
    src = io.open(os.path.join(ROOT, "worker", "vz-sync.mjs"), encoding="utf-8").read()
    for needle, why in [
        ("if (row.locked || (!free && !holder)) {", "محافظ قفل و وی‌پی‌اس دیگر"),
        ("if (holder && panel.managed_by_panel) {", "شرط جداکردن"),
        ("if (!free || !panel.access_watch) continue;", "شرط چسباندن"),
        ("anchors.find((a) => String(a.anchor_vpsid) === row.vpsid)", "تشخیص لنگر از میان چند لنگر"),
        ("const target = panel.anchor_id", "لنگر هر آدرس از بلوکش می‌آید"),
        ("if (!target) {", "آدرس بدون لنگر کنار گذاشته می‌شود، نه روی لنگر اشتباه"),
        ("const cidr = networkOf(gateway, prefix);", "شبکه از گیت‌وی حساب می‌شود"),
        ("for (const row of ips.items) {", "بلوک‌ها از ردیف‌های آی‌پی ساخته می‌شوند"),
        ("if (row.locked) {", "آدرس قفل‌شده در کشف وارد نمی‌شود"),
        ("WHERE i.vz_node_id = $1 AND i.vz_vpsid = a.vpsid",
         "آدرس روی هر یک از لنگرها تحت مدیریت پنل ثبت می‌شود"),
        ("[node.id, allAddr],", "تشخیص حذف از نود با فهرست کامل، نه فهرست واردشده"),
    ]:
        if needle in src:
            print("گذشت  کد واقعی: %s" % why)
        else:
            failures += 1
            print("شکست  کد واقعی با جدول تصمیم نمی‌خواند: %s" % why)

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های ویژالیزور گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
