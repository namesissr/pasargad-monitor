#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون ایجنت: تشخیص کارت شبکه، و تبدیل رشته بین پایتون ۲ و ۳.

اجرا:  python3 scripts/test-uplink.py

چرا این آزمون هست: یک بار روی نود ویرچوالایزر واقعی، ایجنت کارت فیزیکی را
به‌علاوه هر چهل تپ وی‌پی‌اس شمرد و ترافیک حدود دو برابر ثبت شد. علتش این بود
که فهرست پیشوندها «vif» داشت ولی ویرچوالایزر رابط‌ها را «viifv…» می‌نامد.

هیچ نشانه‌ای هم نداشت: نه خطایی، نه لاگی — فقط عددی که با فاکتور دیتاسنتر
نمی‌خواند. برای همین تشخیص از نام به sysfs منتقل شد و توپولوژی‌های واقعی
اینجا قفل شدند.

آزمون به sysfs واقعی دست نمی‌زند؛ توابع خواندن آن جایگزین می‌شوند، پس روی
هر ماشینی اجرا می‌شود.
"""

import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT = os.path.join(ROOT, "public", "agent", "pasargad-agent.py")

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def load_agent():
    spec = importlib.util.spec_from_file_location("agent_under_test", AGENT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CASES = [
    # نام، توپولوژی (رابط → زیرین‌ها)، کارت‌های فیزیکی، مسیر پیش‌فرض، انتظار
    (
        "ویرچوالایزر: بریج viifbr0 با یک کارت و چهل تپ",
        {"viifbr0": ["eno1"] + ["viifv%d" % i for i in range(1116, 1156)]},
        {"eno1", "eno2"},
        "viifbr0",
        ["eno1"],
    ),
    ("سرور ساده بدون مجازی‌سازی", {}, {"eth0"}, "eth0", ["eth0"]),
    (
        "بریج روی باند",
        {"br0": ["bond0", "vnet0", "vnet1"], "bond0": ["eth0", "eth1"]},
        {"eth0", "eth1"},
        "br0",
        ["eth0", "eth1"],
    ),
    ("ولن روی کارت فیزیکی", {"eth0.100": ["eth0"]}, {"eth0"}, "eth0.100", ["eth0"]),
    (
        "پروکسموکس: vmbr0 با tap و fwbr",
        {"vmbr0": ["eno1", "tap100i0", "fwbr101i0"]},
        {"eno1"},
        "vmbr0",
        ["eno1"],
    ),
    (
        "libvirt استاندارد با vnet",
        {"br0": ["eth0", "vnet0", "vnet1", "vnet2"]},
        {"eth0"},
        "br0",
        ["eth0"],
    ),
    # بریج داخلی بدون کارت فیزیکی: نباید خطا بدهد، خودش را برمی‌گرداند
    ("بریج NAT بدون کارت فیزیکی", {"virbr0": ["vnet0", "vnet1"]}, set(), "virbr0", ["virbr0"]),
]


def main():
    agent = load_agent()
    failures = 0

    for name, topology, physical, default_if, expected in CASES:
        agent.lower_ifaces = lambda n, t=topology: t.get(n, [])
        agent.is_physical = lambda n, p=physical: n in p
        agent.default_route_iface = lambda d=default_if: d

        got = agent.detect_uplink()
        if got == expected:
            print("گذشت  %s → %s" % (name, got))
        else:
            failures += 1
            print("شکست  %s" % name)
            print("       انتظار: %s" % expected)
            print("       نتیجه:  %s" % got)

    # نبود مسیر پیش‌فرض باید None بدهد تا روش واپسین فعال شود
    agent.default_route_iface = lambda: None
    if agent.detect_uplink() is None:
        print("گذشت  بدون مسیر پیش‌فرض → None")
    else:
        failures += 1
        print("شکست  بدون مسیر پیش‌فرض باید None بدهد")

    # ── بخش دوم: تبدیل رشته ───────────────────────────────────────────
    # در پایتون ۲، «بایت ٪ یونیکد» روی اولین حرف فارسی می‌شکست و چون فقط در
    # مسیر گزارش خطا رخ می‌داد، ایجنت دقیقاً وقتی می‌مرد که می‌خواست بگوید
    # چه اشکالی هست.
    text_cases = [
        ("بایت یوتی‌اف‌هشت", "توکن نامعتبر".encode("utf-8")),
        ("رشته عادی", "توکن نامعتبر"),
        ("عدد", 403),
        ("استثنا", ValueError("چیزی خراب است")),
        ("بایت خراب", "نامعتبر".encode("utf-8") + bytes(bytearray([255, 254]))),
    ]
    for name, value in text_cases:
        try:
            out = agent.text(value)
            # نتیجه باید بتواند بدون خطا در قالب فارسی بنشیند
            "خطا: %s" % out
            print("گذشت  تبدیل رشته: %s" % name)
        except Exception as err:
            failures += 1
            print("شکست  تبدیل رشته: %s → %s" % (name, err))

    total = len(CASES) + 1 + len(text_cases)
    print("")
    if failures:
        print("%d از %d آزمون شکست خورد" % (failures, total))
        return 1
    print("هر %d آزمون گذشت" % total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
