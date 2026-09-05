#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون ارسال ایمیل.

worker/smtp.mjs پروتکل SMTP و کدگذاری MIME را خودش پیاده کرده تا هیچ
پکیجی لازم نباشد. متن این پروژه فارسی است و کدگذاری غلط، بدترین نوع
خرابی را می‌سازد: ایمیل **می‌رسد** ولی موضوع و متنش درهم است و هیچ
خطایی هم در هیچ لاگی نیست.

اینجا قاعده‌های کدگذاری بازسازی و بررسی می‌شوند، به‌علاوه تصمیم‌هایی که
در کد واقعی نباید عوض شوند.

محدودیت صادقانه: خود جاوااسکریپت اینجا اجرا نمی‌شود. این آزمون قاعده‌ها
را قفل می‌کند؛ درستی اجرا با دکمه «ارسال ایمیل آزمایشی» در صفحه تنظیمات
روی سرور تأیید می‌شود.

اجرا:  python3 scripts/test-email.py
"""

import base64
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# سقف‌هایی که در RFC آمده و در کد واقعی هم همین‌ها هستند
MAX_WORD_B64 = 63      # ۷۵ منهای ۱۲ کاراکترِ قالب =?UTF-8?B??=
MAX_BODY_LINE = 76


def is_ascii(text):
    return all(0x20 <= ord(c) <= 0x7E for c in text)


def encode_header(text):
    """
    بازسازی کلمه رمزشده RFC 2047.

    تکه‌کردن روی مرز **کاراکتر** است نه بایت. اگر وسط یک کاراکتر
    چندبایتی بریده شود، گیرنده به‌جای حرف فارسی علامت سؤال می‌بیند —
    و این دقیقا همان خرابی بی‌صداست.
    """
    if is_ascii(text):
        return text

    words = []
    chunk = ""
    for ch in text:
        nxt = chunk + ch
        if len(base64.b64encode(nxt.encode("utf-8"))) > MAX_WORD_B64:
            words.append(chunk)
            chunk = ch
        else:
            chunk = nxt
    if chunk:
        words.append(chunk)

    return "\r\n ".join(
        "=?UTF-8?B?%s?=" % base64.b64encode(w.encode("utf-8")).decode("ascii") for w in words
    )


def decode_header(encoded):
    """رمزگشایی، برای بررسی رفت‌وبرگشت"""
    if "=?UTF-8?B?" not in encoded:
        return encoded
    out = ""
    for part in encoded.split("\r\n "):
        part = part.strip()
        inner = part[len("=?UTF-8?B?"): -len("?=")]
        out += base64.b64decode(inner).decode("utf-8")
    return out


def encode_body(text):
    b64 = base64.b64encode(text.encode("utf-8")).decode("ascii")
    return "\r\n".join(b64[i:i + MAX_BODY_LINE] for i in range(0, len(b64), MAX_BODY_LINE))


def bare_address(value):
    value = value.strip()
    if "<" in value and ">" in value:
        return value[value.index("<") + 1:value.index(">")].strip()
    return value


ASCII_CASES = [
    ("", True, "خالی"),
    ("Pasargad Monitor", True, "انگلیسی ساده"),
    ("panel@example.com", True, "نشانی"),
    ("پاسارگاد میزبان", False, "فارسی"),
    ("ترافیک سرور «وب-۱» تمام شد", False, "فارسی با گیومه و عدد فارسی"),
    ("Server up — OK", False, "خط تیره بلند یونیکد است"),
]

HEADER_CASES = [
    "ترافیک سرور «وب-۱» تمام شد",
    "موعد تمدید سرور «سرور اختصاصی شماره ۳» امروز است",
    "پاسارگاد میزبان — سرور «db-main» قطع شد. مشتری: شرکت نمونه. مدت: ۱۲ دقیقه",
    "الف",
    "ا" * 200,
]

ADDRESS_CASES = [
    ("panel@example.com", "panel@example.com", "بدون نام"),
    ("پاسارگاد <panel@example.com>", "panel@example.com", "با نام فارسی"),
    ("  spaced@example.com  ", "spaced@example.com", "با فاصله اضافی"),
    ('"Ops Team" <ops@example.com>', "ops@example.com", "نام در گیومه"),
]


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def main():
    failures = 0

    def check(name, got, expected):
        nonlocal failures
        if got == expected:
            print("گذشت  %s" % name)
        else:
            failures += 1
            print("شکست  %s — انتظار %r، نتیجه %r" % (name, expected, got))

    for text, expected, name in ASCII_CASES:
        check("اسکی: %s" % name, is_ascii(text), expected)

    print("")

    for text in HEADER_CASES:
        label = text[:28] + ("…" if len(text) > 28 else "")
        encoded = encode_header(text)
        # رفت‌وبرگشت: هرچه رمز شد باید دقیقا همان برگردد
        check("سرآیند برگشت: %s" % label, decode_header(encoded), text)
        # هیچ کلمه رمزشده‌ای نباید از ۷۵ کاراکتر بگذرد
        longest = max(len(w.strip()) for w in encoded.split("\r\n "))
        if longest <= 75:
            print("گذشت  سرآیند طول: %s (بلندترین %d)" % (label, longest))
        else:
            failures += 1
            print("شکست  سرآیند طول: %s — %d کاراکتر" % (label, longest))

    print("")

    # سرآیند اسکی نباید بی‌جهت رمز شود
    check("سرآیند: اسکی دست‌نخورده می‌ماند", encode_header("Test Subject"), "Test Subject")

    print("")

    body = "خط اول\nخط دوم با متن بلندتر برای اینکه چند خط base64 بسازد\n" * 5
    lines = encode_body(body).split("\r\n")
    check("بدنه: رفت‌وبرگشت", base64.b64decode("".join(lines)).decode("utf-8"), body)
    check("بدنه: طول خط", max(len(l) for l in lines) <= MAX_BODY_LINE, True)
    # الفبای base64 نقطه ندارد، پس هیچ خطی با نقطه شروع نمی‌شود و
    # «دات‌استافینگ» موضوعیت پیدا نمی‌کند
    check("بدنه: هیچ خطی با نقطه شروع نمی‌شود",
          any(l.startswith(".") for l in lines), False)

    print("")

    for raw, expected, name in ADDRESS_CASES:
        check("نشانی: %s" % name, bare_address(raw), expected)

    print("")

    smtp = read("worker", "smtp.mjs")
    wemail = read("worker", "email.mjs")
    lemail = read("lib", "email.ts")
    settings = read("app", "api", "settings", "route.ts")
    tpl = read("worker", "mail-template.mjs")
    alerts = read("worker", "customer-alerts.mjs")
    wnotify = read("worker", "notify.mjs")
    lnotify = read("lib", "notify.ts")
    mig = read("db", "migrations", "032_email.sql")

    source_checks = [
        (smtp, "smtp", "for (const ch of value)",
         "تکه‌کردن سرآیند روی مرز کاراکتر است نه بایت"),
        (smtp, "smtp", "> 63", "سقف کلمه رمزشده"),
        (smtp, "smtp", "i += 76", "طول خط بدنه"),
        (smtp, "smtp", "Content-Transfer-Encoding: base64", "بدنه base64 است"),
        (smtp, "smtp", "charset=UTF-8", "بدنه یونیکد اعلام می‌شود"),
        (smtp, "smtp", "line[3] === ' '", "پاسخ چندخطی درست تفکیک می‌شود"),
        (smtp, "smtp", "await session.cmd(`EHLO ${me}`, [250])",
         "بعد از STARTTLS دوباره معرفی می‌شود"),
        (smtp, "smtp", "rejectUnauthorized: !options.insecure", "بررسی گواهی پیش‌فرض روشن است"),
        (smtp, "smtp", "redact = false", "رمز در پیام خطا چاپ نمی‌شود"),
        (wemail, "worker/email", "channel, recipient, body, ok, error",
         "ارسال ایمیل در همان لاگ اعلان‌ها ثبت می‌شود"),
        (wemail, "worker/email", "'email'", "کانال email"),
        (lemail, "lib/email", "@/worker/smtp.mjs", "پروتکل تکرار نشده؛ یک پیاده‌سازی"),
        (settings, "settings", "const SECRET = ['smtp_pass']", "رمز SMTP هرگز برنمی‌گردد"),
        (settings, "settings", "for (const key of SECRET) delete settings[key]",
         "رمز از پاسخ حذف می‌شود"),
        (settings, "settings", "if (SECRET.includes(key) && value === '') continue",
         "رمز خالی یعنی «عوض نکن» نه «پاک کن»"),
        (alerts, "customer-alerts", "sendEmailTo(srv.customer_email",
         "هشدار مشتری ایمیل هم می‌رود"),
        (wnotify, "worker/notify", "emailAll(message, incidentId)", "ورکر ایمیل هم می‌فرستد"),
        (lnotify, "lib/notify", "emailAll(message, incidentId)", "اپ وب ایمیل هم می‌فرستد"),
        (smtp, "smtp", "multipart/alternative", "هر دو نسخه متنی و اچ‌تی‌ام‌ال فرستاده می‌شود"),
        (smtp, "smtp", "part('text/plain', text) +", "نسخه متنی اول می‌آید"),
        (tpl, "قالب", "role=\"presentation\"", "چیدمان با جدول است، نه flex"),
        (tpl, "قالب", "YekanBakh", "قلم سایت اعلام می‌شود"),
        (tpl, "قالب", "Tahoma", "قلم جایگزین برای کلاینتی که font-face را حذف می‌کند"),
        (tpl, "قالب", 'dir="rtl"', "راست‌به‌چپ"),
        (tpl, "قالب", "export function esc", "متن از دیتابیس خنثی می‌شود"),
        (mig, "مهاجرت ۰۳۲", "smtp_security", "روش امنیتی در تنظیمات است"),
        (mig, "مهاجرت ۰۳۲", "ALTER TABLE users ADD COLUMN IF NOT EXISTS email",
         "ایمیل کاربران پنل"),
    ]

    for src, label, needle, why in source_checks:
        if needle in src:
            print("گذشت  کد واقعی (%s): %s" % (label, why))
        else:
            failures += 1
            print("شکست  کد واقعی (%s): %s پیدا نشد" % (label, why))

    # ترتیب بخش‌ها در multipart: ساده‌ترین اول، بهترین آخر. کلاینت از
    # آخر به اول اولین چیزی که می‌فهمد را نشان می‌دهد؛ برعکسش یعنی همه
    # اچ‌تی‌ام‌ال را رها می‌کنند و متن خام می‌بینند.
    plain_at = smtp.find("part('text/plain'")
    html_at = smtp.find("part('text/html'")
    if plain_at != -1 and html_at != -1 and plain_at < html_at:
        print("گذشت  کد واقعی (smtp): متن ساده پیش از اچ‌تی‌ام‌ال")
    else:
        failures += 1
        print("شکست  کد واقعی (smtp): ترتیب بخش‌های multipart برعکس است")

    # نام سرور از دیتابیس می‌آید؛ یک علامت کوچک‌تر در آن، کل قالب را
    # از هم می‌پاشد
    if "esc(subject)" in tpl and "esc(brand)" in tpl:
        print("گذشت  کد واقعی (قالب): موضوع و نام برند خنثی می‌شوند")
    else:
        failures += 1
        print("شکست  کد واقعی (قالب): متن بدون خنثی‌سازی در اچ‌تی‌ام‌ال می‌رود")

    # رمز نباید در پاسخ ای‌پی‌آی برگردد: بررسی می‌کند که raw و settings
    # قاطی نشده باشند. اگر روزی کسی settings را با raw عوض کند، رمز از
    # شبکه رد می‌شود بی آنکه چیزی خطا بدهد.
    if "return ok({\n      settings," in settings and "raw.smtp_pass" in settings:
        print("گذشت  کد واقعی (settings): پاسخ از نسخه پاک‌شده می‌آید")
    else:
        failures += 1
        print("شکست  کد واقعی (settings): پاسخ ممکن است رمز را برگرداند")

    # هیچ مسیر نوشتنی SMTP نباید باشد جز فرمان‌های استاندارد ارسال
    if "SetRequest" in smtp:
        failures += 1
        print("شکست  کد واقعی (smtp): چیزی نامربوط در فایل هست")
    else:
        print("گذشت  کد واقعی (smtp): فقط فرمان‌های ارسال")

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های ایمیل گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
