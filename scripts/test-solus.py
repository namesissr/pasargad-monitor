#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون خواندن پاسخ سولوس‌وی‌ام ۲.

بازسازی نگاشت worker/solusvm2.mjs روی شکل واقعی پاسخ که از مستر گرفته
شد. اگر آنجا عوض شد، اینجا هم باید عوض شود و آزمون بگذرد.

چرا این آزمون هست: در ویژالیزور سه بار نام یک فیلد را حدس زدم و هر سه بار
غلط بود — هر بار یک رفت‌وبرگشت روی سرور واقعی. اینجا شکل پاسخ از خود نصب
گرفته شده و در همین فایل قفل می‌شود، تا اگر روزی نگاشت دست بخورد، پیش از
رسیدن به سرور معلوم شود.

اجرا:  python3 scripts/test-solus.py
"""

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def is_ipv4(value):
    parts = str(value or "").strip().split(".")
    if len(parts) != 4:
        return False
    return all(re.match(r"^\d{1,3}$", p) and int(p) <= 255 for p in parts)


def map_block(b):
    """بازسازی listPools"""
    return {
        "poolid": str(b.get("id", "")),
        "name": str(b.get("name", "")),
        "gateway": str(b.get("gateway", "")).strip(),
        "netmask": str(b.get("netmask", "")).strip(),
        "isV6": str(b.get("type", "")).lower() == "ipv6",
    }


def keep_block(b):
    return bool(b["poolid"]) and not b["isV6"] and is_ipv4(b["gateway"])


def map_ip(r, block):
    """بازسازی نگاشت هر ردیف آی‌پی در listIps"""
    server = r.get("server") or None
    user = r.get("user") or None
    return {
        "ipid": str(r.get("id", "")),
        "ip": str(r.get("ip", "")).strip(),
        "vpsid": str(server["id"]) if server else "0",
        "ippoolid": block["poolid"],
        "poolName": block["name"],
        "gateway": block["gateway"],
        "netmask": block["netmask"],
        # «رزروشده» در سولوس یعنی «ثبت‌شده در بلوک»، نه «قفل». آدرسی که
        # روی یک سرور نشسته هم رزرو است. قفل واقعی یعنی رزرو بدون سرور.
        "locked": r.get("is_reserved") is True and not server,
        "isPrimary": r.get("is_primary") is True,
        "hostname": str(server["name"]) if server else "",
        "customer": str(user["email"]) if user else "",
    }


def plan_write(on_anchor, want, cap=200):
    """بازسازی تصمیم writeVpsIps: چه چسبانده و چه برداشته شود"""
    want_set = set(want)
    to_attach = [ip for ip in want if not any(r["ip"] == ip for r in on_anchor)]
    to_detach = [r for r in on_anchor if r["ip"] not in want_set]
    primaries = [r["ip"] for r in to_detach if r["isPrimary"]]
    detachable = [r for r in to_detach if not r["isPrimary"] and r["ipid"]]
    return {
        "attach": to_attach[:cap],
        "detach": [r["ip"] for r in detachable],
        "skippedPrimary": primaries,
        "over_cap": max(0, len(to_attach) - cap),
    }


# شکل واقعی، از پاسخ مستر
REAL_BLOCK = json.loads("""
{"id":48,"name":"2.188.255.128/25 mashhad","gateway":"2.188.255.129",
 "netmask":"255.255.255.128","ns_1":"8.8.8.8","ns_2":"8.8.4.4",
 "from":"2.188.255.130","to":"2.188.255.255","type":"IPv4","list_type":"range"}
""")

REAL_IP = json.loads("""
{"id":1898,"ip":"2.188.255.189","server":{"id":1737,"name":"mashaad"},
 "user":{"id":1,"email":"info@pasargadmizban.com"},"issued_for":"vm",
 "is_reverse_dns_enabled":false,"is_primary":true,"is_reserved":true,"comment":null}
""")

FREE_IP = json.loads("""
{"id":1899,"ip":"2.188.255.190","server":null,"user":null,
 "issued_for":"vm","is_primary":false,"is_reserved":false,"comment":null}
""")

V6_BLOCK = json.loads("""
{"id":50,"name":"v6","gateway":"2001:db8::1","netmask":"","type":"IPv6"}
""")


def main():
    failures = 0

    def check(name, got, expected):
        nonlocal failures
        if got == expected:
            print("گذشت  %s" % name)
        else:
            failures += 1
            print("شکست  %s — انتظار %r، نتیجه %r" % (name, expected, got))

    block = map_block(REAL_BLOCK)
    check("بلوک: شناسه", block["poolid"], "48")
    check("بلوک: گیت‌وی", block["gateway"], "2.188.255.129")
    check("بلوک: ماسک", block["netmask"], "255.255.255.128")
    check("بلوک: نسخه ۴ پذیرفته شد", keep_block(block), True)

    v6 = map_block(V6_BLOCK)
    check("بلوک: نسخه ۶ رد شد", keep_block(v6), False)

    print("")

    row = map_ip(REAL_IP, block)
    check("آی‌پی: شناسه", row["ipid"], "1898")
    check("آی‌پی: آدرس", row["ip"], "2.188.255.189")
    check("آی‌پی: سرور تخصیص‌یافته", row["vpsid"], "1737")
    check("آی‌پی: نام سرور", row["hostname"], "mashaad")
    check("آی‌پی: مشتری از ایمیل مالک", row["customer"], "info@pasargadmizban.com")
    # ۱۸۹۸ روی سرور ۱۷۳۷ نشسته، پس رزرو هست ولی قفل نیست
    check("آی‌پی روی سرور: قفل نیست", row["locked"], False)
    check("آی‌پی: علامت اصلی", row["isPrimary"], True)
    check("آی‌پی: ماسک از بلوک", row["netmask"], "255.255.255.128")

    print("")

    free = map_ip(FREE_IP, block)
    # سرور و مالک تهی‌اند؛ نباید استثنا بدهد و باید «آزاد» تفسیر شود
    check("آی‌پی آزاد: بدون سرور", free["vpsid"], "0")
    check("آی‌پی آزاد: بدون نام سرور", free["hostname"], "")
    check("آی‌پی آزاد: بدون مشتری", free["customer"], "")
    check("آی‌پی آزاد: قفل نیست", free["locked"], False)

    print("")

    # ── تصمیم نوشتن ─────────────────────────────────────────────
    A = {"ip": "1.1.1.1", "ipid": "10", "isPrimary": True}
    B = {"ip": "1.1.1.2", "ipid": "11", "isPrimary": False}
    C = {"ip": "1.1.1.3", "ipid": "12", "isPrimary": False}

    plan = plan_write([A, B], ["1.1.1.1", "1.1.1.2", "1.1.1.4"])
    check("نوشتن: آدرس تازه چسبانده می‌شود", plan["attach"], ["1.1.1.4"])
    check("نوشتن: آدرس موجود دوباره چسبانده نمی‌شود", "1.1.1.2" in plan["attach"], False)

    plan = plan_write([A, B, C], ["1.1.1.1"])
    check("نوشتن: آدرس ناخواسته برداشته می‌شود", sorted(plan["detach"]), ["1.1.1.2", "1.1.1.3"])

    # مهم‌ترین محافظ: برداشتن آی‌پی اصلی، شبکه خود لنگر را قطع می‌کند
    plan = plan_write([A, B], [])
    check("نوشتن: آی‌پی اصلی هرگز برداشته نمی‌شود", plan["detach"], ["1.1.1.2"])
    check("نوشتن: آی‌پی اصلی گزارش می‌شود", plan["skippedPrimary"], ["1.1.1.1"])

    plan = plan_write([], ["1.1.1.%d" % i for i in range(1, 10)], cap=3)
    check("نوشتن: سقف رعایت می‌شود", len(plan["attach"]), 3)
    check("نوشتن: مازاد گزارش می‌شود", plan["over_cap"], 6)

    plan = plan_write([A], ["1.1.1.1"])
    check("نوشتن: بدون تغییر، هیچ عملیاتی نیست", (plan["attach"], plan["detach"]), ([], []))

    print("")

    src = io.open(os.path.join(ROOT, "worker", "solusvm2.mjs"), encoding="utf-8").read()
    for needle, why in [
        ("authorization: `Bearer ${token}`", "احراز هویت با Bearer"),
        ("`${base}/api/v1/${path}", "مسیر پایه ای‌پی‌آی"),
        ("ip_blocks/${block.poolid}/ips", "مسیر آی‌پی‌های هر بلوک"),
        ("locked: r.is_reserved === true && !server", "قفل یعنی رزرو بدون سرور"),
        ("isPrimary: r.is_primary === true", "علامت آی‌پی اصلی"),
        ("toDetach.filter((r) => !r.isPrimary && r.ipid)", "آی‌پی اصلی برداشته نمی‌شود"),
        ("type: 'IPv4',", "نوع در بدنه چسباندن"),
        ("ids: detachable.map((r) => Number(r.ipid))", "بدنه دسته‌ای برداشتن"),
        ("delayed: false", "اجرای بی‌درنگ، نه صف تاخیری"),
        ("customer: user ? str(user.email) : ''", "مشتری از ایمیل مالک"),
    ]:
        if needle in src:
            print("گذشت  کد واقعی: %s" % why)
        else:
            failures += 1
            print("شکست  کد واقعی: %s پیدا نشد" % why)

    # شکست جزئی نباید موفقیت گزارش شود
    partial = "if (failed.length) {" in src and "ok: false," in src
    if partial:
        print("گذشت  کد واقعی: شکست جزئی موفقیت گزارش نمی‌شود")
    else:
        failures += 1
        print("شکست  کد واقعی: شکست جزئی باید ناموفق گزارش شود")

    # موتور مشترک نباید مستقیم به کلاینت ویژالیزور وصل باشد
    sync = io.open(os.path.join(ROOT, "worker", "vz-sync.mjs"), encoding="utf-8").read()
    if "from './virtualizor.mjs'" in sync:
        failures += 1
        print("شکست  موتور کشف هنوز مستقیم به کلاینت ویژالیزور وصل است")
    else:
        print("گذشت  موتور کشف از راه dispatcher کار می‌کند")

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های سولوس گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
