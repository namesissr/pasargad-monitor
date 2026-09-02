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
    r"export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)"
)

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

            for name in clause_names(clause):
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


# ── ۷) هر مسیر API پنل باید requireUser داشته باشد ───────────────────────
# مسیرهای باز عمدی: ingest با توکن ایجنت، ورود، خروج، سلامت
OPEN_ROUTES = {"app/api/ingest/route.ts", "app/api/auth/login/route.ts",
               "app/api/auth/logout/route.ts", "app/api/health/route.ts"}


def check_route_auth():
    for path in walk({".ts"}):
        r = rel(path)
        if not (r.startswith("app/api/") and r.endswith("route.ts")):
            continue
        if r in OPEN_ROUTES:
            continue
        if "requireUser" not in read(path):
            problems.append("%s — مسیر API بدون requireUser. عمدی است؟" % r)


def main():
    check_non_null_assertion()
    check_empty_catch()
    check_async_effect()
    check_imports()
    check_query_generics()
    check_undefined_names()
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
