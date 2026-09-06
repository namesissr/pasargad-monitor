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

    # ساخت نشست به lib/signin.ts منتقل شد چون دو جا نشست باز می‌کنند:
    # صفحه ورود، و پرداخت فروشگاه عمومی. اگر هرکدام کوکی خودش را
    # می‌ساخت، دیر یا زود یکی‌شان httpOnly یا cid را جا می‌انداخت.
    login = read("app", "api", "auth", "login", "route.ts")
    signin = read("lib", "signin.ts")
    store_checkout = read("app", "api", "store", "checkout", "route.ts")

    check(
        "شناسه مشتری در توکن نشست می‌رود",
        "cid: user.customer_id" in signin,
        "اگر از پارامتر خوانده شود، هر مشتری با عوض‌کردن یک عدد داده بقیه را می‌بیند",
    )
    check(
        "cid فقط برای نقش مشتری گذاشته می‌شود",
        "user.role === 'customer' && user.customer_id" in signin,
        "با cid روی حساب کارکنان، نگهبان‌های پرتال او را مشتری حساب می‌کنند",
    )
    check(
        "کوکی نشست httpOnly است",
        "httpOnly: true" in signin,
        "کوکی خواندنی با جاوااسکریپت، با یک XSS دزدیده می‌شود",
    )
    for label, src in (("ورود", login), ("پرداخت فروشگاه", store_checkout)):
        check(
            "%s از همان startSession استفاده می‌کند" % label,
            "startSession(" in src and "cookies().set(" not in src,
            "کوکی دست‌ساز در هر مسیر یعنی یکی‌شان دیر یا زود چیزی جا می‌اندازد",
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
    #   ب) مسیرهایی که شناسه سرور، تیکت یا فاکتور می‌گیرند: دروازه‌های
    #        requireOwned* که اول مالکیت را تأیید می‌کنند و شناسه
    #        تأییدشده برمی‌گردانند. بعد از آن، قید همان شناسه کافی است.
    #
    # الگوی «ب» سست‌تر نیست، سخت‌گیرتر است: به‌جای اینکه هر کوئری یادش
    # باشد customer_id را بگذارد، یک دروازه پیش از همه‌شان است. کوئری‌ای
    # که یادش برود، آن یکی است که هیچ خطایی نمی‌دهد.
    for path in routes:
        rel = os.path.relpath(path, ROOT).replace("\\", "/")
        src = io.open(path, encoding="utf-8").read()

        # دروازه‌های مالکیت، به ترتیبی که در فایل دنبالشان می‌گردیم
        GATES = ("requireOwnedServer(", "requireOwnedTicket(", "requireOwnedInvoice(")
        gate = next((g for g in GATES if g in src), None)
        owned = gate is not None
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
            guard_at = src.index(gate)
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
                # شماره پارامتر مهم نیست، وجود قید مهم است. نسخه اول
                # فقط $1 را می‌پذیرفت و کوئری درستی که customer_id را
                # در $2 داشت هشدار کاذب می‌گرفت.
                #
                # «s.id» برای زیرکوئری‌های همبسته است: آن‌ها با شناسه
                # سروری کار می‌کنند که خودِ کوئری بیرونی به مشتری مقید
                # کرده.
                scoped = (
                    re.search(r"customer_id\s*=\s*\$\d", tail) is not None
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

    # ── فروشگاه عمومی ──────────────────────────────────────────
    #
    # این دو مسیر عمدا نگهبان ندارند، پس امنیتشان جای دیگری است. هر
    # قاعده اینجا یک بار شکستنش یعنی: یا هر کسی به نام دیگری سفارش
    # می‌دهد، یا با یک رشته ادمین می‌شود، یا یک اسکریپت جدول مشتریان
    # را پر می‌کند.
    register = read("lib", "register.ts")
    store_products = read("app", "api", "store", "products", "route.ts")

    check(
        "ثبت‌نام همیشه نقش مشتری می‌سازد",
        "'customer', $5" in register,
        "اگر نقش از ورودی بیاید، هر کسی از اینترنت ادمین می‌شود",
    )
    check(
        "نقش از بدنه درخواست خوانده نمی‌شود",
        not re.search(r"\bbody\.role\b", store_checkout),
        "نقش باید سخت‌کد باشد، نه انتخابی",
    )
    check(
        "شناسه مشتری از بدنه درخواست نمی‌آید",
        not re.search(r"\bbody\.customer_id\b", store_checkout),
        "با شناسه از بدنه، هر کسی به نام هر مشتری‌ای سفارش ثبت می‌کند",
    )
    check(
        "شناسه مشتری از نشست یا حساب همان‌جا می‌آید",
        "user.cid" in store_checkout and "reg.user.customer_id" in store_checkout,
        "تنها منبع مجاز شناسه مشتری",
    )
    for label, src in (("سفارش", store_checkout), ("کاتالوگ", store_products)):
        check(
            "%s فروشگاه عمومی قابل خاموش‌کردن است" % label,
            "store_public_enabled" in src,
            "اگر موج ثبت‌نام بی‌هدف آمد باید بشود خاموشش کرد",
        )
    check(
        "سفارش فروشگاه عمومی سقف نرخ دارد",
        "rateLimit(" in store_checkout,
        "بدون سقف، یک اسکریپت در چند دقیقه هزاران حساب و سفارش می‌سازد",
    )
    check(
        "ورود هم سقف نرخ دارد",
        "rateLimit(" in login,
        "بدون سقف، حدس گذرواژه فقط به سرعت شبکه محدود است",
    )
    check(
        "کاتالوگ عمومی موجودی دقیق را لو نمی‌دهد",
        "AS in_stock" in store_products and "stock," not in store_products,
        "عدد دقیق موجودی برای خریدار فایده ندارد و برای رقیب دارد",
    )
    check(
        "گذرواژه حداقل طول دارد",
        "PASSWORD_MIN" in register,
        "گذرواژه کوتاه، حدس‌زدنی است",
    )
    check(
        "شماره موبایل یکسان‌سازی می‌شود",
        "normalizePhone" in register and "normalizePhone" in store_checkout,
        "بدون آن، +۹۸۹۱۲ و ۰۹۱۲ دو حساب جدا می‌سازند و ایندکس یکتا هم نمی‌گیردش",
    )
    check(
        "مشتری و حسابش در یک تراکنش ساخته می‌شوند",
        "BEGIN" in register and "ROLLBACK" in register,
        "مشتری بدون حساب یعنی کسی که سفارش داده ولی نمی‌تواند وارد شود",
    )

    print("")

    # ── خروج ───────────────────────────────────────────────────
    #
    # خروجی که کاربر را به صفحه ورود نبرد، بدترین حالت است: کاربر فکر
    # می‌کند بیرون آمده و نیامده. سه چیز باید با هم درست باشد.
    logout = read("app", "api", "auth", "logout", "route.ts")
    nav = read("components", "PortalNav.tsx")

    check(
        "خروج کوکی را روی خود پاسخ پاک می‌کند",
        "res.cookies.set(SESSION_COOKIE, ''" in logout and "maxAge: 0" in logout,
        "با cookies() از next/headers، پاک‌شدن روی پاسخِ دست‌ساز تضمین نیست",
    )
    check(
        "مقصد ریدایرکت نسبی است",
        "Location: '/login'" in logout,
        "آدرس مطلق از req.url پشت انجین‌ایکس با طرح http و شاید نام داخلی کانتینر ساخته می‌شود",
    )
    check(
        "خروج آدرس مطلق از req.url نمی‌سازد",
        "new URL('/login', req.url)" not in logout,
        "همان دام: آدرسی که از مرورگر در دسترس نیست",
    )
    check(
        "خروج به پیمایش مرورگر ریدایرکت می‌دهد",
        "accept.includes('text/html')" in logout,
        "پیمایش ساده اگر جیسون بگیرد، کاربر روی متن خام می‌ماند",
    )
    check(
        "خروج با GET هم کار می‌کند",
        "export async function GET" in logout,
        "لینک بوکمارک‌شده و مرورگر بی‌جاوااسکریپت GET می‌فرستند",
    )
    check(
        "ریدایرکت خروج ۳۰۳ است",
        "status: 303" in logout,
        "با ۳۰۲ بعضی مرورگرها POST را به صفحه ورود می‌برند",
    )
    check(
        "دکمه خروج پرتال هر دو راه را دارد",
        "onSubmit={logout}" in nav and 'action="/api/auth/logout"' in nav,
        "fetch برای حالت عادی، فرم برای وقتی جاوااسکریپت خاموش است",
    )
    check(
        "خروج پرتال در هر حال کاربر را می‌فرستد",
        "finally {" in nav and "window.location.href = '/login'" in nav,
        "ماندن در پرتالی که نشستش نامعلوم است بدتر از خروج ناقص است",
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
        # فروشگاه عمومی. مشتری تازه باید پیش از ثبت‌نام محصولات را
        # ببیند و بتواند سفارش بدهد؛ ثبت‌نام حین همان سفارش انجام
        # می‌شود، پس این دو نمی‌توانند پشت نگهبان باشند.
        #
        # امنیتشان جای دیگری است و پایین‌تر جداگانه آزموده می‌شود:
        # سقف نرخ، نقش سخت‌کدشده، و شناسه مشتری که هرگز از بدنه
        # درخواست نمی‌آید.
        "app/api/store/products/route.ts",
        "app/api/store/checkout/route.ts",
        # فقط «وارد شده یا نه» را می‌گوید تا فرم سفارش بداند بخش حساب
        # را نشان بدهد یا نه. شناسه مشتری برنمی‌گرداند.
        "app/api/store/session/route.ts",
        # ورود با کد پیامکی. همان دلیل صفحه ورود: کسی که وارد می‌شود
        # هنوز نشستی ندارد. قواعدش پایین‌تر جداگانه آزموده می‌شود.
        "app/api/auth/otp/request/route.ts",
        "app/api/auth/otp/verify/route.ts",
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
            # دروازه‌های requireOwned* هم نگهبان‌اند: همه‌شان خودشان
            # requireCustomer را صدا می‌زنند؛ بالاتر جداگانه بررسی شد که
            # واقعا این کار را می‌کنند.
            if not any(
                g in src
                for g in (
                    "requireUser",
                    "requireCustomer",
                    "requireOwnedServer",
                    "requireOwnedTicket",
                    "requireOwnedInvoice",
                )
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
