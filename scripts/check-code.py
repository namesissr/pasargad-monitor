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
SKIP_DIRS = {"node_modules", ".next", ".git", "public"}

problems = []


def rel(path):
    return os.path.relpath(path, ROOT).replace("\\", "/")


def walk(exts):
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
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
# useEffect باید تابع پاک‌سازی یا undefined برگرداند، نه پرامیس.
def check_async_effect():
    for path in walk({".tsx"}):
        src = strip_comments(read(path))
        for m in re.finditer(r"useEffect\(\s*async\b", src):
            problems.append(
                "%s:%d — useEffect با تابع async. تابع را داخلش تعریف و صدا بزنید."
                % (rel(path), line_of(src, m.start()))
            )


# ── ۴) ایمپورت از فایلی که وجود ندارد ────────────────────────────────────
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


def check_imports():
    pattern = re.compile(r"""import\s+(?:([^'"]+?)\s+from\s+)?['"]([^'"]+)['"]""")
    for path in walk({".ts", ".tsx", ".mjs"}):
        src = read(path)
        for m in pattern.finditer(src):
            names_part, spec = m.group(1), m.group(2)
            target = resolve(path, spec)
            if target is None:
                continue
            if target is False:
                problems.append(
                    "%s:%d — ایمپورت شکسته: «%s» پیدا نشد."
                    % (rel(path), line_of(src, m.start()), spec)
                )
                continue
            if not names_part:
                continue

            # ── ۵) نام‌هایی که ماژول مقصد صادر نمی‌کند ──────────────────
            braces = re.search(r"\{([^}]*)\}", names_part)
            if not braces:
                continue
            target_src = read(target)
            exported = set(re.findall(
                r"export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+(\w+)",
                target_src))
            exported |= set(re.findall(r"export\s+\{([^}]*)\}", target_src) and
                            re.findall(r"\b(\w+)\b", " ".join(re.findall(r"export\s+\{([^}]*)\}", target_src))) or [])
            if "export default" in target_src:
                exported.add("default")
            if re.search(r"export\s+\*", target_src):
                continue  # صادرات ستاره‌دار را دنبال نمی‌کنیم

            for raw in braces.group(1).split(","):
                name = raw.strip()
                if not name:
                    continue
                name = re.sub(r"^type\s+", "", name)
                name = name.split(" as ")[0].strip()
                if name and name not in exported:
                    problems.append(
                        "%s:%d — «%s» از «%s» ایمپورت شده ولی آنجا صادر نشده است."
                        % (rel(path), line_of(src, m.start()), name, spec)
                    )


# ── ۶) هر مسیر API پنل باید requireUser داشته باشد ───────────────────────
# مسیرهای باز عمدی: ingest با توکن ایجنت، login، health
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
