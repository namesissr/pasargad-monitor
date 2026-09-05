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

    # نوشتن cid در توکن کافی نیست؛ باید در راه برگشت هم زنده بماند.
    #
    # این دقیقا یک بار شکست: verifySessionToken فقط uid و username و role
    # را برمی‌گرداند و cid را دور می‌انداخت. نتیجه‌اش این بود که **هیچ
    # مشتری‌ای نمی‌توانست وارد پرتال شود** و پیام «به این بخش دسترسی
    # ندارید» می‌گرفت — در حالی که توکنش کاملا درست بود.
    #
    # آزمون قبلی این را نمی‌گرفت چون فقط دو سر زنجیره را می‌دید: نوشتن
    # در ورود، و خواندن در requireCustomer. حلقه وسط بررسی نشده بود.
    session = read("lib", "session.ts")
    check(
        "شناسه مشتری از توکن برمی‌گردد",
        "...(validCid ? { cid } : {})" in session,
        "بدون این، هیچ مشتری‌ای نمی‌تواند وارد پرتال شود",
    )
    check(
        "نوع شناسه مشتری بررسی می‌شود",
        "typeof cid === 'number'" in session and "Number.isInteger(cid)" in session,
        "هرچه از بیرون می‌آید حتی با امضای معتبر، خام استفاده نمی‌شود",
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

    # دو الگوی مجاز، و فقط همین دو:
    #
    #   الف) مسیرهایی که شناسه سرور نمی‌گیرند: requireCustomer و هر کوئری
    #        مستقیماً به customer_id مقید.
    #
    #   ب) مسیرهایی که شناسه سرور می‌گیرند: requireOwnedServer که اول
    #        مالکیت را تأیید می‌کند و شناسه تأییدشده برمی‌گرداند. بعد از
    #        آن، قید server_id کافی است.
    #
    # الگوی «ب» سست‌تر نیست، سخت‌گیرتر است: به‌جای اینکه هر کوئری یادش
    # باشد customer_id را بگذارد، یک دروازه پیش از همه‌شان است. کوئری‌ای
    # که یادش برود، آن یکی است که هیچ خطایی نمی‌دهد.
    for path in routes:
        rel = os.path.relpath(path, ROOT).replace("\\", "/")
        src = io.open(path, encoding="utf-8").read()

        owned = "requireOwnedServer(" in src
        check(
            "%s: نگهبان مشتری دارد" % rel,
            "requireCustomer()" in src or owned,
        )

        # هیچ کوئری‌ای نباید شناسه مشتری را از پارامتر درخواست بگیرد
        bad = re.search(r"searchParams\.get\(\s*['\"](customer_id|customerId|cid)['\"]", src)
        check(
            "%s: شناسه مشتری از پارامتر خوانده نمی‌شود" % rel,
            bad is None,
            "شناسه باید فقط از نشست بیاید",
        )

        if owned:
            # دروازه باید **پیش از** هر کوئری باشد. اگر بعدش بیاید، یک
            # کوئری روی شناسه تأییدنشده اجرا شده و داده رفته است.
            guard_at = src.index("requireOwnedServer(")
            first_query = min(
                [i for i in (src.find("query("), src.find("queryOne(")) if i != -1] or [-1]
            )
            check(
                "%s: تأیید مالکیت پیش از هر کوئری" % rel,
                first_query == -1 or guard_at < first_query,
                "کوئری روی شناسه تأییدنشده یعنی داده سرور دیگری برمی‌گردد",
            )
            # شناسه خام از آدرس نباید مستقیم در کوئری برود
            check(
                "%s: شناسه خام آدرس در کوئری نمی‌رود" % rel,
                "params.id]" not in src and "[params.id" not in src,
                "فقط شناسه تأییدشده باید در کوئری برود",
            )
        else:
            # هر کوئری روی جدول‌های داده باید مستقیماً به مشتری مقید باشد
            for m in re.finditer(r"FROM\s+(servers|ip_addresses|server_metrics_daily)\b", src):
                table = m.group(1)
                tail = src[m.start(): m.start() + 900]
                scoped = (
                    "customer_id = $1" in tail
                    or "s.customer_id = $1" in tail
                    or "s.id" in tail
                )
                check(
                    "%s: کوئری روی %s به مشتری مقید است" % (rel, table),
                    scoped,
                    "بدون قید، داده همه مشتریان برمی‌گردد",
                )

    # خودِ دروازه باید مالکیت را واقعا بررسی کند
    guard = read("lib", "portal-guard.ts")
    check(
        "دروازه مالکیت، سرور را با شناسه مشتری می‌سنجد",
        "WHERE id = $1 AND customer_id = $2" in guard,
        "بدون این شرط، هر مشتری با عوض‌کردن عدد آدرس، سرور دیگری را می‌بیند",
    )
    check(
        "دروازه از requireCustomer شروع می‌کند",
        "await requireCustomer()" in guard,
        "بدون آن، حساب ادمین یا نشست بی‌مشتری هم رد می‌شود",
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
        # بازگشت درگاه پرداخت. کوکی در POST بین‌سایتی نمی‌آید، پس
        # نمی‌تواند پشت نگهبان باشد؛ امنیتش از شناسه پرداخت درگاه و
        # مبلغ دیتابیس می‌آید و هیچ داده‌ای هم نشان نمی‌دهد.
        "app/api/pay/return/[id]/route.ts",
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
            # requireOwnedServer هم نگهبان است و خودش requireCustomer را
            # صدا می‌زند؛ بالاتر جداگانه بررسی شد که واقعا این کار را کند.
            if not any(
                g in src for g in ("requireUser", "requireCustomer", "requireOwnedServer")
            ):
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
