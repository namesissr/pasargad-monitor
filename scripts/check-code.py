#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
بررسی سریع خطاهای رایج پیش از بیلد.

بیلد داکر روی سرور چند دقیقه طول می‌کشد. این اسکریپت در چند ثانیه چند دسته
خطا را می‌گیرد که هر کدامشان یک بیلد شکست‌خورده‌اند.

اجرا:  python3 scripts/check-code.py

اصل کار: هر بررسی باید تقریباً بدون هشدار کاذب باشد.
بررسی‌ای که کاذب می‌دهد بدتر از نبودنش است، چون یاد می‌گیرید نادیده‌اش بگیرید.
"""

import io
import os
import re
import sys

# کنسول ویندوز پیش‌فرض UTF-8 نیست و متن فارسی را نمی‌تواند چاپ کند
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {"node_modules", ".next", ".git", "public", "out", "dist"}

# کتابخانه‌های کمکی خالص. نام‌های صادرشده‌شان مبنای بررسی «ایمپورت نشده» است.
HELPER_LIBS = ["lib/format.ts", "lib/billing.ts", "lib/period.ts", "lib/jalali.ts"]

problems = []


def rel(path):
    return os.path.relpath(path, ROOT).replace("\\", "/")


def walk(exts):
    """
    پیمایش فایل‌های پروژه.

    هر پوشه‌ای که .git خودش را دارد رد می‌شود: کلون جداگانه‌ای که کسی داخل
    پروژه گذاشته پروژه ما نیست، و بررسی‌اش فقط هشدار تکراری می‌سازد.
    """
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [
            d for d in dirs
            if d not in SKIP_DIRS
            and not os.path.isdir(os.path.join(base, d, ".git"))
        ]
        for f in files:
            if os.path.splitext(f)[1] in exts:
                yield os.path.join(base, f)


def read(path):
    return io.open(path, encoding="utf-8").read()


def strip_comments(src):
    """حذف توضیحات تا الگوها روی متن توضیح نیفتند"""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)
    return src


def line_of(src, index):
    return src.count("\n", 0, index) + 1


# ── ۱) علامت تعجب روی داده داخل JSX ──────────────────────────────────────
# تایپ‌اسکریپت آن را هنگام کامپایل حذف می‌کند و در زمان اجرا محافظتی نیست.
# نتیجه‌اش صفحه سیاه است، نه یک خطای قابل خواندن.
def check_non_null_assertion():
    for path in walk({".tsx"}):
        src = strip_comments(read(path))
        for m in re.finditer(r"\b(data|detail|res|result)!\.", src):
            problems.append(
                "%s:%d — «%s» با علامت تعجب استفاده شده. "
                "پیش از JSX بازگشت زودهنگام بگذارید."
                % (rel(path), line_of(src, m.start()), m.group(1))
            )


# ── ۲) بلعیدن خطا با catch خالی ──────────────────────────────────────────
# نتیجه‌اش «در حال بارگذاری…» بی‌پایان بدون هیچ سرنخی است.
#
# اینجا عمداً توضیحات حذف نمی‌شوند: بلوکی که فقط یک توضیح دارد یعنی نویسنده
# آگاهانه خطا را نادیده گرفته و دلیلش را نوشته. آن مورد ایراد نیست.
def check_empty_catch():
    for path in walk({".ts", ".tsx", ".mjs"}):
        src = read(path)
        for m in re.finditer(r"catch\s*(\([^)]*\))?\s*\{\s*\}", src):
            problems.append(
                "%s:%d — بلوک catch خالی. خطا را لاگ یا نمایش دهید."
                % (rel(path), line_of(src, m.start()))
            )


# ── ۳) تابع async مستقیم داخل useEffect ──────────────────────────────────
def check_async_effect():
    for path in walk({".tsx"}):
        src = strip_comments(read(path))
        for m in re.finditer(r"useEffect\(\s*async\b", src):
            problems.append(
                "%s:%d — useEffect با تابع async. تابع را داخلش تعریف و صدا بزنید."
                % (rel(path), line_of(src, m.start()))
            )


# ── ۴) ایمپورت شکسته و نام صادرنشده ──────────────────────────────────────
def resolve(path, spec):
    if spec.startswith("@/"):
        base = os.path.join(ROOT, spec[2:])
    elif spec.startswith("."):
        base = os.path.normpath(os.path.join(os.path.dirname(path), spec))
    else:
        return None  # وابستگی بیرونی
    for cand in (base + ".ts", base + ".tsx", base + ".mjs", base + ".js",
                 os.path.join(base, "index.ts"), os.path.join(base, "index.tsx"), base):
        if os.path.isfile(cand):
            return cand
    return False


EXPORT_RE = re.compile(
    r"export\s+(?:async\s+)?(?:declare\s+)?"
    r"(?:function|const|let|var|class|interface|type|enum)\s+(\w+)"
)


def declaration_exports(target):
    """
    نام‌های صادرشده در فایل اعلان کنار یک ماژول جاوااسکریپتی.

    worker/smtp.mjs پیاده‌سازی است و worker/smtp.d.mts تایپ‌هایش. بدون
    خواندن فایل دوم، «import { SmtpConfig } from '@/worker/smtp.mjs'»
    هشدار کاذب می‌گیرد — و هشدار کاذب از نبود بررسی بدتر است.
    """
    for suffix, decl in ((".mjs", ".d.mts"), (".js", ".d.ts")):
        if target.endswith(suffix):
            path = target[: -len(suffix)] + decl
            if os.path.isfile(path):
                return module_exports(read(path))
    return set()

IMPORT_RE = re.compile(r"""import\s+(?:([^'"]+?)\s+from\s+)?['"]([^'"]+)['"]""")


def clause_names(clause):
    """نام‌هایی که یک بند ایمپورت به فایل می‌آورد"""
    names = set()
    star = re.search(r"\*\s+as\s+(\w+)", clause)
    if star:
        names.add(star.group(1))
    braces = re.search(r"\{([^}]*)\}", clause)
    if braces:
        for raw in braces.group(1).split(","):
            raw = raw.strip()
            if not raw:
                continue
            raw = re.sub(r"^type\s+", "", raw)
            parts = raw.split(" as ")
            names.add(parts[-1].strip() if len(parts) > 1 else parts[0].strip())
    before = clause.split("{")[0].split(",")[0].strip()
    if before and re.match(r"^\w+$", before):
        names.add(before)
    return names


def imported_source_names(clause):
    """
    نام‌های اصلی که از ماژول مقصد خواسته می‌شوند.

    با clause_names فرق دارد: آن نام محلی را برمی‌گرداند. برای
    «import { a as b }» نام محلی «b» است ولی چیزی که باید در مقصد صادر
    شده باشد «a» است. مقایسه با نام محلی، هر ایمپورت نام‌گذاری‌شده را
    هشدار کاذب می‌کرد.
    """
    names = set()
    braces = re.search(r"\{([^}]*)\}", clause)
    if not braces:
        return names
    for raw in braces.group(1).split(","):
        raw = raw.strip()
        if not raw:
            continue
        raw = re.sub(r"^type\s+", "", raw)
        names.add(raw.split(" as ")[0].strip())
    return names


def module_exports(src):
    names = set(EXPORT_RE.findall(src))
    for block in re.findall(r"export\s+\{([^}]*)\}", src):
        for raw in block.split(","):
            raw = raw.strip()
            if not raw:
                continue
            raw = re.sub(r"^type\s+", "", raw)
            parts = raw.split(" as ")
            names.add(parts[-1].strip() if len(parts) > 1 else parts[0].strip())
    if "export default" in src:
        names.add("default")
    return names


def check_imports():
    for path in walk({".ts", ".tsx", ".mjs"}):
        src = read(path)
        for m in IMPORT_RE.finditer(src):
            clause, spec = m.group(1), m.group(2)
            target = resolve(path, spec)
            if target is None:
                continue
            if target is False:
                problems.append(
                    "%s:%d — ایمپورت شکسته: «%s» پیدا نشد."
                    % (rel(path), line_of(src, m.start()), spec)
                )
                continue
            if not clause or "{" not in clause:
                continue

            target_src = read(target)
            if re.search(r"export\s+\*", target_src):
                continue  # صادرات ستاره‌دار را دنبال نمی‌کنیم
            exported = module_exports(target_src)

            # فایل .mjs که از تایپ‌اسکریپت ایمپورت می‌شود، تایپ‌هایش در
            # فایل اعلان کنارش است. بدون این، هر ایمپورت تایپ از یک ماژول
            # جاوااسکریپتی هشدار کاذب می‌داد.
            exported |= declaration_exports(target)

            for name in imported_source_names(clause):
                if name and name not in exported:
                    problems.append(
                        "%s:%d — «%s» از «%s» ایمپورت شده ولی آنجا صادر نشده است."
                        % (rel(path), line_of(src, m.start()), name, spec)
                    )


# ── ۵) تایپ عمومی query نباید interface باشد ─────────────────────────────
# محدودیت pg این است: T extends QueryResultRow، و QueryResultRow امضای
# ایندکس رشته‌ای دارد. تایپ‌اسکریپت به interface امضای ایندکس ضمنی نمی‌دهد
# ولی به type alias می‌دهد. این خطا فقط هنگام بیلد معلوم می‌شود.
def check_query_generics():
    for path in walk({".ts", ".tsx"}):
        src = read(path)
        for name in set(re.findall(r"\bquery(?:One)?<([A-Z]\w*)>", src)):
            if re.search(r"\binterface\s+%s\b" % re.escape(name), src):
                problems.append(
                    "%s — تایپ «%s» در query استفاده شده ولی interface است. "
                    "به type تبدیلش کنید." % (rel(path), name)
                )


# ── ۶) استفاده از نامی که ایمپورت یا تعریف نشده ──────────────────────────
# خطای «Cannot find name» رایج‌ترین نتیجه ویرایش نیمه‌خودکار است: کامپوننت
# یا تابع کمکی تازه‌ای استفاده می‌شود ولی به فهرست ایمپورت اضافه نمی‌شود.
#
# دو نکته که جلوی هشدار کاذب را می‌گیرند:
#  • آرگومان عمومی تایپ‌اسکریپت هم به شکل <Name> است. تفاوتش با JSX این است
#    که پیش از «<» یک شناسه می‌آید، مثل ChangeEvent<HTMLInputElement>.
#  • فهرست توابع کمکی از روی صادرات واقعی lib/* ساخته می‌شود، نه از روی
#    الگوی نام. وگرنه یک پارامتر محلی به نام formatTime هم علامت می‌خورد.

JSX_KNOWN = {"React", "Fragment", "Suspense", "Link", "Image", "Head", "Script"}

DECL_PATTERNS = (
    r"(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+(\w+)",
    r"(?:^|\s)(?:export\s+)?(?:const|let|var)\s+(\w+)",
    r"(?:^|\s)(?:export\s+)?class\s+(\w+)",
    r"(?:^|\s)(?:export\s+)?(?:interface|type|enum)\s+(\w+)",
)


def declared_names(src):
    names = set()
    for m in IMPORT_RE.finditer(src):
        if m.group(1):
            names |= clause_names(m.group(1))
    for pat in DECL_PATTERNS:
        names.update(re.findall(pat, src))
    return names


def helper_names():
    names = set()
    for relpath in HELPER_LIBS:
        full = os.path.join(ROOT, relpath)
        if os.path.isfile(full):
            # فقط مقادیر، نه تایپ‌ها
            names.update(
                re.findall(r"export\s+(?:async\s+)?(?:function|const)\s+(\w+)", read(full))
            )
    return names


def check_undefined_names():
    helpers = helper_names()

    for path in walk({".ts", ".tsx"}):
        src = read(path)
        known = declared_names(src) | JSX_KNOWN
        body = strip_comments(src)
        missing = set()

        if path.endswith(".tsx"):
            # «<» که پیش از آن شناسه نباشد یعنی JSX، نه آرگومان عمومی
            for m in re.finditer(r"(?<![\w$)\]])<([A-Z]\w*)[\s/>]", body):
                if m.group(1) not in known:
                    missing.add(m.group(1))

        for name in helpers:
            if name in known:
                continue
            # صدا زده شده ولی نه به‌عنوان عضو یک شیء دیگر
            if re.search(r"(?<![\w$.])%s\s*\(" % re.escape(name), body):
                missing.add(name)

        for name in sorted(missing):
            problems.append(
                "%s — «%s» استفاده شده ولی ایمپورت یا تعریف نشده است." % (rel(path), name)
            )


# ── ۷) مقدار نامعتبر برای پراپ با نوع اتحاد رشته‌ای ──────────────────────
# مثلا Notice که type فقط 'error' | 'success' | 'info' می‌پذیرد. اگر
# type="warn" بنویسید، بیلد می‌شکند ولی هیچ بررسی متنی دیگری نمی‌گیردش.
# این یک بار واقعاً اتفاق افتاد.
#
# فقط مقادیر لیترال بررسی می‌شوند. اگر مقدار عبارت باشد (آکولاد) رد می‌شود،
# چون نمی‌شود بدون تایپ‌چکر واقعی درباره‌اش قضاوت کرد.

COMPONENT_RE = re.compile(
    r"export\s+function\s+(\w+)\s*\(\s*\{(?P<names>[^}]*)\}\s*:\s*\{(?P<types>.*?)\}\s*\)",
    re.S,
)
UNION_PROP_RE = re.compile(r"(\w+)\??:\s*((?:'[^']*'\s*\|\s*)+'[^']*')\s*;")


def union_props():
    """پراپ‌هایی که نوعشان اتحاد چند لیترال رشته‌ای است"""
    table = {}
    for path in walk({".tsx"}):
        src = read(path)
        for m in COMPONENT_RE.finditer(src):
            component = m.group(1)
            for prop, union in UNION_PROP_RE.findall(m.group("types")):
                allowed = set(re.findall(r"'([^']*)'", union))
                if len(allowed) > 1:
                    table.setdefault(component, {})[prop] = allowed
    return table


def check_union_props():
    table = union_props()
    if not table:
        return

    for path in walk({".tsx"}):
        src = read(path)
        body = strip_comments(src)
        for component, props in table.items():
            for m in re.finditer(r"<%s\b([^>]*)>" % re.escape(component), body, re.S):
                attrs = m.group(1)
                for prop, allowed in props.items():
                    found = re.search(r'\b%s="([^"]*)"' % re.escape(prop), attrs)
                    if found and found.group(1) not in allowed:
                        problems.append(
                            "%s:%d — «%s» با %s=%s استفاده شده؛ مقادیر مجاز: %s"
                            % (rel(path), line_of(src, m.start()), component, prop,
                               found.group(1), "، ".join(sorted(allowed)))
                        )


# ── ۸) هر مسیر API پنل باید requireUser داشته باشد ───────────────────────
# مسیرهای باز عمدی: ingest با توکن ایجنت، ورود، خروج، سلامت
# probe و bind با توکن خودشان احراز می‌شوند، مثل ingest
OPEN_ROUTES = {"app/api/ingest/route.ts", "app/api/auth/login/route.ts",
               "app/api/auth/logout/route.ts", "app/api/health/route.ts",
               "app/api/probe/route.ts", "app/api/bind/route.ts"}


def check_route_auth():
    for path in walk({".ts"}):
        r = rel(path)
        if not (r.startswith("app/api/") and r.endswith("route.ts")):
            continue
        if r in OPEN_ROUTES:
            continue
        # requireCustomer هم نگهبان معتبری است — مسیرهای پرتال مشتری با
        # آن محافظت می‌شوند. requireUser عمدا نقش مشتری را رد می‌کند، پس
        # این دو جای هم را نمی‌گیرند.
        src = read(path)
        if "requireUser" not in src and "requireCustomer" not in src:
            problems.append("%s — مسیر API بدون نگهبان احراز هویت. عمدی است؟" % r)



# ── ۲۶) ستون پنهان جدول باید در سرآیند و بدنه یکی باشد ───────────────────
# کلاس col-sm/col-md ستون را روی صفحه باریک حذف می‌کند. اگر فقط به <th>
# داده شود و به <td> نه (یا برعکس)، سرآیند و بدنه یکی جابه‌جا می‌شوند و
# جدول روی موبایل داده غلط نشان می‌دهد — بدون هیچ خطایی.
def check_hidden_columns():
    for path in walk({".tsx"}):
        src = read(path)
        if "col-sm" not in src and "col-md" not in src:
            continue
        for cls in ("col-sm", "col-md"):
            th = len(re.findall(r"<th[^>]*\b%s\b" % cls, src))
            td = len(re.findall(r"<td[^>]*\b%s\b" % cls, src))
            if th != td:
                problems.append(
                    "%s — کلاس %s روی %d سرآیند و %d سلول بدنه است؛ "
                    "جدول روی موبایل جابه‌جا می‌شود."
                    % (rel(path), cls, th, td)
                )


# ── ۲۷) رشته تک‌نقل‌قولی که در همان خط بسته نشده ─────────────────────────
# رشته چندخطی در جاوااسکریپت فقط با بک‌تیک مجاز است. رشته تک‌نقل‌قولی که
# خط بشکند، خطای نحوی است و بیلد را می‌خواباند — ولی چون خطا فقط هنگام
# کامپایل معلوم می‌شود، روی این سرور یعنی چند دقیقه بیلد و بعد شکست.
#
# این یک بار واقعا رخ داد: یک ابزار ویرایش، «\n» را به خط واقعی تبدیل کرد
# و رشته وسط راه شکست.
def check_unterminated_strings():
    backslash = chr(92)
    for path in walk({".ts", ".tsx", ".mjs"}):
        for n, line in enumerate(read(path).split("\n"), 1):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue

            open_quote = False
            i = 0
            while i < len(line):
                c = line[i]
                if c == backslash:
                    i += 2                      # کاراکتر بعدی گریخته است
                    continue
                if c == "'":
                    open_quote = not open_quote
                elif not open_quote and c == '"':
                    # رشته دونقل‌قولی را رد می‌کنیم تا آپاستروف داخلش
                    # هشدار کاذب نسازد
                    j = i + 1
                    while j < len(line):
                        if line[j] == backslash:
                            j += 2
                            continue
                        if line[j] == '"':
                            break
                        j += 1
                    i = j
                elif not open_quote and c == "`":
                    break                       # رشته قالبی مجاز است چندخطی باشد
                elif not open_quote and c == "/" and i + 1 < len(line) and line[i + 1] == "/":
                    break
                i += 1

            if open_quote:
                problems.append(
                    "%s:%d — رشته تک‌نقل‌قولی در همان خط بسته نشده؛ خطای نحوی است. %s"
                    % (rel(path), n, stripped[:60])
                )


# ── ۲۸) شناسه از کوئری باید با idParam خوانده شود ───────────────────────
# Number(null) در جاوااسکریپت صفر است نه NaN، و Number.isInteger(0) هم
# درست است. پس این الگو وقتی پارامتر اصلا فرستاده نشده، روی «شناسه صفر»
# فیلتر می‌کند: نتیجه خالی، جمع صفر، و هیچ خطایی.
#
# این یک بار در صفحه خرید ترافیک رخ داد و تشخیصش سخت بود چون همه‌چیز
# سالم به‌نظر می‌رسید. idParam در lib/http.ts نبودِ پارامتر را از مقدار
# معتبر جدا می‌کند.
ID_PARAM_RE = re.compile(
    r"Number\(\s*(?:new URL\(req\.url\)|url)\.searchParams\.get\(\s*['\"](\w+)['\"]"
)

# پارامترهایی که شناسه نیستند و مقدار پیش‌فرض دارند
NOT_AN_ID = {"limit", "page", "per_page", "days", "hours", "count", "offset"}


def check_id_params():
    for path in walk({".ts"}):
        r = rel(path)
        if not (r.startswith("app/api/") and r.endswith("route.ts")):
            continue
        src = read(path)
        for m in ID_PARAM_RE.finditer(src):
            name = m.group(1)
            if name in NOT_AN_ID:
                continue
            problems.append(
                "%s:%d — شناسه «%s» با Number خوانده شده. نبودِ پارامتر صفر می‌شود "
                "و کوئری بی‌صدا خالی برمی‌گردد؛ از idParam در lib/http استفاده کنید."
                % (r, line_of(src, m.start()), name)
            )


# ── ۲۹) ستونی که در جدول نیست ────────────────────────────────────────────
# نام ستون در رشته SQL را هیچ کامپایلری بررسی نمی‌کند. خطایش فقط هنگام
# اجرای واقعی همان مسیر معلوم می‌شود — و اگر آن مسیر کم استفاده باشد،
# ماه‌ها بی‌سروصدا می‌ماند. پرتال مشتری دقیقا همین بود: ستون mem_used_bytes
# وجود نداشت (نامش ram_used_bytes است) و چون پرتال به‌خاطر ایراد دیگری
# اصلا باز نمی‌شد، این خطا هرگز دیده نشده بود.
#
# محافظه‌کارانه است: فقط وقتی هشدار می‌دهد که نام مستعار به یک جدول
# **شناخته‌شده** وصل باشد و همه ستون‌هایش معلوم باشند. زیرکوئری‌ای که
# ستون می‌سازد یا SELECT دلخواه دارد، نادیده گرفته می‌شود.

DIRECT_ALIAS_RE = re.compile(r"\b(?:FROM|JOIN)\s+(\w+)\s+(?:AS\s+)?(\w+)\b", re.I)
LATERAL_STAR_RE = re.compile(
    r"JOIN\s+LATERAL\s*\(\s*SELECT\s+\*\s+FROM\s+(\w+)\b.*?\)\s*(\w+)\s+ON", re.I | re.S
)
SQL_LITERAL_RE = re.compile(r"`([^`]*(?:SELECT|UPDATE|INSERT)[^`]*)`", re.I)
COLUMN_REF_RE = re.compile(r"\b(\w+)\.(\w+)\b")

SQL_KEYWORDS = {
    "on", "where", "group", "order", "limit", "left", "right", "inner", "lateral",
    "set", "values", "returning", "as", "select", "and", "or", "using", "having",
    "union", "from", "join", "natural", "cross", "full", "outer", "do", "conflict",
    "nothing", "update", "insert", "into",
}


def schema_from_migrations():
    """نگاشت جدول → ستون‌ها، از روی مهاجرت‌ها به ترتیب شماره"""
    tables = {}
    folder = os.path.join(ROOT, "db", "migrations")
    if not os.path.isdir(folder):
        return tables

    for name in sorted(os.listdir(folder)):
        if not name.endswith(".sql"):
            continue
        sql = read(os.path.join(folder, name))
        # نظرها حذف می‌شوند تا نام ستون از داخل توضیح فارسی برداشته نشود
        sql = re.sub(r"--[^\n]*", "", sql)

        for m in re.finditer(
            r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.*?)\n\)\s*;",
            sql, re.S | re.I,
        ):
            cols = set(tables.get(m.group(1), set()))
            for line in m.group(2).split("\n"):
                line = line.strip().rstrip(",")
                if not line:
                    continue
                head = line.split()[0]
                if head.lower() in ("primary", "unique", "foreign", "check",
                                    "constraint", "exclude"):
                    continue
                if re.match(r"^\w+$", head):
                    cols.add(head)
            tables[m.group(1)] = cols

        for m in re.finditer(
            r"ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)",
            sql, re.I,
        ):
            tables.setdefault(m.group(1), set()).add(m.group(2))

        for m in re.finditer(
            r"ALTER\s+TABLE\s+(\w+)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(\w+)", sql, re.I
        ):
            tables.get(m.group(1), set()).discard(m.group(2))

        for m in re.finditer(
            r"ALTER\s+TABLE\s+(\w+)\s+RENAME\s+COLUMN\s+(\w+)\s+TO\s+(\w+)", sql, re.I
        ):
            cols = tables.get(m.group(1))
            if cols:
                cols.discard(m.group(2))
                cols.add(m.group(3))

    return tables


def check_sql_columns():
    tables = schema_from_migrations()
    if not tables:
        return

    for path in walk({".ts", ".mjs"}):
        src = read(path)
        for q in SQL_LITERAL_RE.findall(src):
            alias = {}
            for table, name in DIRECT_ALIAS_RE.findall(q):
                if name.lower() in SQL_KEYWORDS or table not in tables:
                    continue
                alias[name] = table
            for table, name in LATERAL_STAR_RE.findall(q):
                if table in tables:
                    alias[name] = table
            if not alias:
                continue

            for name, col in COLUMN_REF_RE.findall(q):
                if name in alias and col not in tables[alias[name]]:
                    problems.append(
                        "%s — ستون «%s.%s» در جدول %s وجود ندارد. "
                        "SQL کامپایل نمی‌شود؛ خطایش فقط هنگام اجرا معلوم می‌شود."
                        % (rel(path), name, col, alias[name])
                    )


def main():
    check_non_null_assertion()
    check_empty_catch()
    check_async_effect()
    check_imports()
    check_query_generics()
    check_hidden_columns()
    check_unterminated_strings()
    check_id_params()
    check_sql_columns()
    check_undefined_names()
    check_union_props()
    check_route_auth()

    if not problems:
        print("هیچ ایرادی پیدا نشد.")
        return 0

    print("%d ایراد پیدا شد:\n" % len(problems))
    for p in problems:
        print("  - " + p)
    return 1


if __name__ == "__main__":
    sys.exit(main())
