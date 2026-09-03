#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون پایش «ایران اکسس»: ریاضی ساب‌نت و جدول تصمیم.

اجرا:  python3 scripts/test-access.py

چرا این آزمون هست: یک بار منطق تصمیم، موفقیت بایند را اثبات زنده‌بودن آی‌پی
گرفت. ولی «ip addr add» تقریباً همیشه موفق می‌شود، حتی وقتی دیتاسنتر بلوک را
به آن سرور روت نکرده. نتیجه‌اش این بود که آی‌پی روت‌نشده تا ابد «در اکسس»
گزارش می‌شد و آزادشدنش هرگز دیده نمی‌شد — یعنی دقیقاً همان کاری که کل این
بخش برایش ساخته شده، انجام نمی‌شد و هیچ خطایی هم نمی‌داد.

جدول تصمیم اینجا قفل شده تا دوباره بی‌صدا خراب نشود.
"""

import importlib.util
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def load_agent():
    path = os.path.join(ROOT, "public", "agent", "bind-agent.py")
    spec = importlib.util.spec_from_file_location("bind_agent_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# آی‌پی، آدرس اصلی سرور، پرفیکس، انتظار، توضیح
SUBNET_CASES = [
    ("1.2.3.10", "1.2.3.5", 24, True, "همان بلوک ۲۴"),
    ("5.6.7.10", "1.2.3.5", 24, False, "رنج کاملاً متفاوت"),
    ("1.2.4.10", "1.2.3.5", 24, False, "یک بلوک آن‌طرف‌تر"),
    # ۱.۲.۳.۵ با پرفیکس ۲۲ یعنی شبکه ۱.۲.۰.۰ که تا ۱.۲.۳.۲۵۵ می‌رسد
    ("1.2.2.10", "1.2.3.5", 22, True, "داخل همان بلوک ۲۲"),
    ("1.2.4.10", "1.2.3.5", 22, False, "بیرون بلوک ۲۲"),
    ("10.0.0.1", "10.255.255.254", 8, True, "همان بلوک ۸"),
    ("bad", "1.2.3.5", 24, None, "ورودی خراب"),
    ("1.2.3.4", None, None, None, "آدرس اصلی پیدا نشده"),
]


def decide(outside_ok, outside_all_fail, inside_ok, bound, routed=False):
    """
    بازسازی منطق app/api/probe/route.ts.
    اگر آنجا عوض شد، اینجا هم باید عوض شود و آزمون بگذرد.
    """
    if outside_ok:
        return "released"
    if outside_all_fail:
        if inside_ok or routed:
            return "blocked"
        if bound:
            return "unreachable"
        return "unknown"
    return "no-change"


# خارج جواب داد، خارج همه ناموفق، داخل جواب داد، بایند شده، تست روت، انتظار، توضیح
DECISION_CASES = [
    (True, False, True, True, False, "released", "از خارج جواب می‌دهد"),
    (True, False, False, False, False, "released", "از خارج جواب می‌دهد، بقیه مهم نیست"),
    (False, True, True, True, False, "blocked", "فقط از داخل جواب می‌دهد"),
    (False, True, True, False, False, "blocked", "از داخل جواب می‌دهد، بدون بایند"),
    # چیدمان دو سروری: لنگر و دیدبان داخل یک ماشین‌اند، پس نتیجه داخل محلی
    # است و کنار گذاشته می‌شود؛ تست روت لنگر جایش را می‌گیرد
    (False, True, False, True, True, "blocked", "تست روت لنگر موفق، بدون دیدبان داخل مستقل"),
    (False, True, False, True, False, "unreachable", "بایند شده ولی تست روت ناموفق"),
    (False, True, False, False, False, "unknown", "نه بایند نه جواب"),
    (False, False, False, True, False, "no-change", "هنوز به حد نصاب پیاپی نرسیده"),
]


# shares، گیت‌وی، پاسخ گیت‌وی به هر مبدأ، انتظار، توضیح
ROUTING_CASES = [
    # هم‌ساب‌نت‌بودن اثبات روت‌شدن نیست: دیتاسنتر ایرانی هر آی‌پی را به
    # پورت یک سرور مشخص بایند می‌کند. آدرسی از همان بلوک که به سرور
    # دیگری تخصیص یافته، روی کارت می‌نشیند ولی بسته‌ای نمی‌گیرد.
    (True,  "1.2.3.1", {"9.9.9.9": False, "1.2.3.5": True}, False,
     "هم‌ساب‌نت ولی گیت‌وی جواب نمی‌دهد — روت نشده، نه اثبات"),
    (True,  "1.2.3.1", {"9.9.9.9": True}, True, "هم‌ساب‌نت و گیت‌وی جواب داد"),
    (False, None,      {}, None,  "رنج متفاوت، گیت‌وی ثبت نشده"),
    (False, "1.2.3.1", {"9.9.9.9": True}, True, "رنج متفاوت، گیت‌وی جواب داد"),
    # مهم‌ترین حالت: گیت‌وی ساکت است. بدون پینگ شاهد، این False می‌شد و
    # ادمین دنبال مشکلی می‌رفت که وجود ندارد.
    (False, "1.2.3.1", {"9.9.9.9": False, "1.2.3.5": False}, None,
     "گیت‌وی به هیچ‌کس جواب نمی‌دهد — بی‌نتیجه، نه منفی"),
    (False, "1.2.3.1", {"9.9.9.9": False, "1.2.3.5": True}, False,
     "گیت‌وی به آدرس اصلی جواب می‌دهد ولی به این نه — واقعاً روت نشده"),
]


def check_routing(agent):
    """تست روت با پینگ ساختگی — تفکیک None از False مهم‌ترین بخش است"""
    failures = 0
    answers = {}

    def fake_ping(source, target):
        return answers.get(source)

    real = agent.ping_from
    agent.ping_from = fake_ping
    try:
        for shares, gw, table, expected, name in ROUTING_CASES:
            answers = table
            got = agent.routing_test("9.9.9.9", gw, shares, "1.2.3.5")
            if got == expected:
                print("گذشت  روت: %s → %s" % (name, got))
            else:
                failures += 1
                print("شکست  روت: %s — انتظار %s، نتیجه %s" % (name, expected, got))
    finally:
        agent.ping_from = real
    return failures


def main():
    agent = load_agent()
    failures = 0

    for ip, base, prefix, expected, name in SUBNET_CASES:
        got = agent.same_subnet(ip, base, prefix)
        if got == expected:
            print("گذشت  ساب‌نت: %s → %s" % (name, got))
        else:
            failures += 1
            print("شکست  ساب‌نت: %s — انتظار %s، نتیجه %s" % (name, expected, got))

    print("")
    failures += check_routing(agent)
    print("")

    for a, b, c, d, e, expected, name in DECISION_CASES:
        got = decide(a, b, c, d, e)
        if got == expected:
            print("گذشت  تصمیم: %s → %s" % (name, got))
        else:
            failures += 1
            print("شکست  تصمیم: %s — انتظار %s، نتیجه %s" % (name, expected, got))

    # منطق واقعی مسیر probe باید با جدول بالا بخواند
    src = io.open(os.path.join(ROOT, "app", "api", "probe", "route.ts"), encoding="utf-8").read()
    for needle, why in [
        ("if (aliveInside || ip.bind_routed === true) target = 'blocked';", "شرط «در اکسس»"),
        ("else if (ip.bind_ok === true) target = 'unreachable';", "شرط «روت نشده»"),
        ("else target = 'unknown';", "شرط «نامشخص»"),
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
    print("همه آزمون‌های اکسس گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
