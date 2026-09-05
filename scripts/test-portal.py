#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون مرز دسترسی پرتال مشتری.

این آزمون درباره درستی محاسبه نیست، درباره **نشت داده** است. اگر مرز
بشکند، هر مشتری داده بقیه مشتریان را می‌بیند — و برخلاف بیشتر باگ‌های این
پروژه، هیچ نشانه‌ای هم نمی‌دهد.

سه چیز را قفل می‌کند:

  ۱. requireUser نقش «customer» را رد می‌کند. ده‌ها مسیر پنل مدیریت از
     آن استفاده می‌کنند؛ یادرفتن یکی یعنی نشت کامل.
  ۲. مسیرهای پرتال شناسه مشتری را از نشست می‌گیرند، نه از پارامتر
     درخواست.
  ۳. هر مسیر ای‌پی‌آی نگهبانی دارد.

اجرا:  python3 scripts/test-portal.py
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


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def main():
    failures = 0

    def check(name, condition, why=""):
        nonlocal failures
        if condition:
            print("گذشت  %s" % name)
        else:
            failures += 1
            print("شکست  %s%s" % (name, (" — " + why) if why else ""))

    auth = read("lib", "auth.ts")

    check(
        "requireUser نقش مشتری را رد می‌کند",
        "if (user.role === 'customer') throw new ForbiddenError();" in auth,
        "بدون این، حساب مشتری به همه مسیرهای پنل مدیریت دسترسی دارد",
    )
    check(
        "requireCustomer نقش را بررسی می‌کند",
        "if (user.role !== 'customer' || !user.cid) throw new ForbiddenError();" in auth,
        "بدون بررسی cid، نشست بدون شناسه مشتری هم پذیرفته می‌شد",
    )

    http = read("lib", "http.ts")
    check(
        "خطای دسترسی کد ۴۰۳ می‌گیرد نه ۴۰۱",
        "if (err instanceof ForbiddenError) return fail(err.message, 403);" in http,
        "با ۴۰۱ رابط کاربر را به صفحه ورود می‌فرستد و حلقه بی‌پایان می‌سازد",
    )

    login = read("app", "api", "auth", "login", "route.ts")
    check(
        "شناسه مشتری در توکن نشست می‌رود",
        "cid: user.customer_id" in login,
        "اگر از پارامتر خوانده شود، هر مشتری با عوض‌کردن یک عدد داده بقیه را می‌بیند",
    )

    print("")

    # ── هر مسیر پرتال باید فقط با شناسه نشست کوئری بزند ──────────
    portal_dir = os.path.join(ROOT, "app", "api", "portal")
    routes = []
    for base, _dirs, files in os.walk(portal_dir):
        for f in files:
            if f == "route.ts":
                routes.append(os.path.join(base, f))

    check("مسیر پرتال وجود دارد", bool(routes))

    for path in routes:
        rel = os.path.relpath(path, ROOT).replace("\\", "/")
        src = io.open(path, encoding="utf-8").read()

        check("%s: نگهبان مشتری دارد" % rel, "requireCustomer()" in src)

        # هیچ کوئری‌ای نباید شناسه مشتری را از پارامتر درخواست بگیرد
        bad = re.search(r"searchParams\.get\(\s*['\"](customer_id|customerId|cid)['\"]", src)
        check(
            "%s: شناسه مشتری از پارامتر خوانده نمی‌شود" % rel,
            bad is None,
            "شناسه باید فقط از نشست بیاید",
        )

        # هر کوئری روی جدول‌های داده باید به مشتری مقید باشد
        for m in re.finditer(r"FROM\s+(servers|ip_addresses|server_metrics_daily)\b", src):
            table = m.group(1)
            tail = src[m.start(): m.start() + 900]
            scoped = "customer_id = $1" in tail or "s.customer_id = $1" in tail or "s.id" in tail
            check(
                "%s: کوئری روی %s به مشتری مقید است" % (rel, table),
                scoped,
                "بدون قید، داده همه مشتریان برمی‌گردد",
            )

    print("")

    # ── هیچ مسیر ای‌پی‌آی بدون نگهبان ───────────────────────────
    open_routes = {
        "app/api/ingest/route.ts",
        "app/api/auth/login/route.ts",
        "app/api/auth/logout/route.ts",
        "app/api/health/route.ts",
        "app/api/probe/route.ts",
        "app/api/bind/route.ts",
    }
    unguarded = []
    for base, _dirs, files in os.walk(os.path.join(ROOT, "app", "api")):
        for f in files:
            if f != "route.ts":
                continue
            path = os.path.join(base, f)
            rel = os.path.relpath(path, ROOT).replace("\\", "/")
            if rel in open_routes:
                continue
            src = io.open(path, encoding="utf-8").read()
            if "requireUser" not in src and "requireCustomer" not in src:
                unguarded.append(rel)

    check(
        "همه مسیرهای ای‌پی‌آی نگهبان دارند",
        not unguarded,
        "بدون نگهبان: " + "، ".join(unguarded),
    )

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های مرز دسترسی گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
