#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون خواندن خروجی serialize پی‌اچ‌پی و ساخت کلید ای‌پی‌آی ویژالیزور.

بازسازی phpUnserialize و makeApiKey از worker/virtualizor.mjs. اگر آنجا
عوض شد، اینجا هم باید عوض شود و آزمون بگذرد.

چرا این آزمون هست: پارسر جایی است که خطا ساکت می‌ماند. اگر طول رشته را بر
حسب کاراکتر بشمارد به‌جای بایت، با داده انگلیسی درست کار می‌کند و فقط وقتی
یک نام مشتری فارسی یا هاست‌نیم یونیکد بیاید از جا درمی‌رود — یعنی روی
سرور واقعی، وسط کشف، و بدون پیام روشن.

اجرا:  python3 scripts/test-vzparse.py
"""

import hashlib
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def php_unserialize(text):
    """بازسازی phpUnserialize — روی بایت، نه کاراکتر"""
    buf = text.encode("utf-8")
    pos = [0]

    def fail(why):
        raise ValueError("بایت %d: %s" % (pos[0], why))

    def expect(ch):
        if buf[pos[0]:pos[0] + 1] != ch.encode():
            fail("«%s» انتظار می‌رفت" % ch)
        pos[0] += 1

    def until(ch):
        idx = buf.find(ch.encode(), pos[0])
        if idx == -1:
            fail("«%s» پیدا نشد" % ch)
        out = buf[pos[0]:idx].decode("utf-8")
        pos[0] = idx + 1
        return out

    def value():
        tag = buf[pos[0]:pos[0] + 1].decode("latin-1")
        if tag == "N":
            pos[0] += 2
            return None
        if tag == "b":
            pos[0] += 2
            return until(";") == "1"
        if tag == "i":
            pos[0] += 2
            return int(until(";"))
        if tag == "d":
            pos[0] += 2
            return float(until(";"))
        if tag == "s":
            pos[0] += 2
            length = int(until(":"))
            expect('"')
            out = buf[pos[0]:pos[0] + length].decode("utf-8")
            pos[0] += length
            expect('"')
            expect(";")
            return out
        if tag == "a":
            pos[0] += 2
            count = int(until(":"))
            expect("{")
            out = {}
            for _ in range(count):
                k = value()
                out[str(k)] = value()
            expect("}")
            return out
        return fail("نوع ناشناخته «%s»" % tag)

    return value()


def make_apikey(rand, password):
    """بازسازی makeApiKey با رشته تصادفی داده‌شده — تا قابل آزمون باشد"""
    return rand + hashlib.md5((password + rand).encode("utf-8")).hexdigest()


PARSE_CASES = [
    ('i:42;', 42, "عدد صحیح"),
    ('b:1;', True, "درست"),
    ('b:0;', False, "نادرست"),
    ('N;', None, "تهی"),
    ('d:1.5;', 1.5, "اعشاری"),
    ('s:5:"hello";', "hello", "رشته انگلیسی"),
    # طول بر حسب بایت است: «سلام» چهار کاراکتر ولی هشت بایت
    ('s:8:"سلام";', "سلام", "رشته فارسی — طول بایتی"),
    ('a:0:{}', {}, "آرایه خالی"),
    ('a:1:{s:2:"ip";s:10:"1.2.3.4/24";}', {"ip": "1.2.3.4/24"}, "آرایه ساده"),
    (
        'a:2:{i:0;s:3:"abc";i:1;a:1:{s:4:"name";s:8:"محسن";}}',
        {"0": "abc", "1": {"name": "محسن"}},
        "آرایه تودرتو با فارسی",
    ),
    # شکل واقعی پاسخ ویژالیزور برای فهرست آی‌پی
    (
        'a:1:{s:3:"ips";a:1:{s:2:"11";a:3:{s:4:"ipid";s:2:"11";'
        's:2:"ip";s:13:"95.38.101.131";s:5:"vpsid";s:1:"0";}}}',
        {"ips": {"11": {"ipid": "11", "ip": "95.38.101.131", "vpsid": "0"}}},
        "شکل واقعی فهرست آی‌پی",
    ),
]

BROKEN_CASES = [
    ('s:99:"short";', "طول بیشتر از داده"),
    ('a:2:{s:1:"a";i:1;}', "تعداد عضو با محتوا نمی‌خواند"),
    ('x:1;', "نوع ناشناخته"),
    ('', "خالی"),
]

def is_ipv4(value):
    """بازسازی isIpv4 از worker/virtualizor.mjs"""
    parts = str(value or "").strip().split(".")
    if len(parts) != 4:
        return False
    for part in parts:
        if not re.match(r"^\d{1,3}$", part):
            return False
        if int(part) > 255:
            return False
    return True


IPV4_CASES = [
    ("95.38.101.131", True, "آدرس معمولی"),
    ("0.0.0.0", True, "صفر"),
    ("255.255.255.255", True, "بیشینه"),
    ("  1.2.3.4  ", True, "با فاصله اضافه"),
    ("2001:db8::1", False, "نسخه ۶"),
    ("::1", False, "لوپ‌بک نسخه ۶"),
    ("fe80::a00:27ff:fe4e:66a1", False, "لینک‌لوکال"),
    # این یکی نقطه دارد و با بررسی ساده «نقطه دارد» رد نمی‌شد
    ("::ffff:1.2.3.4", False, "نسخه ۴ نگاشته در نسخه ۶"),
    ("1.2.3", False, "سه بخشی"),
    ("1.2.3.4.5", False, "پنج بخشی"),
    ("1.2.3.256", False, "بخش بزرگ‌تر از ۲۵۵"),
    ("1.2.3.a", False, "بخش غیرعددی"),
    ("", False, "خالی"),
    (None, False, "تهی"),
]


KEY_CASES = [
    ("abcd1234", "secret", "کلید نمونه"),
    ("00000000", "", "رمز خالی"),
    ("zzzzzzzz", "p@ss:word/=", "رمز با کاراکتر خاص"),
]


def main():
    failures = 0

    for raw, expected, name in PARSE_CASES:
        try:
            got = php_unserialize(raw)
        except Exception as err:
            failures += 1
            print("شکست  خواندن: %s — خطا: %s" % (name, err))
            continue
        if got == expected:
            print("گذشت  خواندن: %s" % name)
        else:
            failures += 1
            print("شکست  خواندن: %s — انتظار %r، نتیجه %r" % (name, expected, got))

    print("")

    # ورودی خراب باید خطا بدهد، نه نتیجه نصفه. نتیجه نصفه یعنی کشف با
    # داده ناقص ادامه می‌یابد و کسی نمی‌فهمد.
    for raw, name in BROKEN_CASES:
        try:
            php_unserialize(raw)
        except Exception:
            print("گذشت  ورودی خراب: %s → خطا داد" % name)
        else:
            failures += 1
            print("شکست  ورودی خراب: %s → بی‌صدا قبول شد" % name)

    print("")

    for value, expected, name in IPV4_CASES:
        got = is_ipv4(value)
        if got == expected:
            print("گذشت  نسخه۴: %s → %s" % (name, got))
        else:
            failures += 1
            print("شکست  نسخه۴: %s — انتظار %s، نتیجه %s" % (name, expected, got))

    print("")

    for rand, password, name in KEY_CASES:
        got = make_apikey(rand, password)
        expected = rand + hashlib.md5((password + rand).encode("utf-8")).hexdigest()
        if got == expected and got.startswith(rand) and len(got) == len(rand) + 32:
            print("گذشت  کلید: %s → %s…" % (name, got[:16]))
        else:
            failures += 1
            print("شکست  کلید: %s" % name)

    # کد واقعی باید همان قرارداد اس‌دی‌کی را داشته باشد
    src = io.open(os.path.join(ROOT, "worker", "virtualizor.mjs"), encoding="utf-8").read()
    for needle, why in [
        ("rand + createHash('md5').update(pass + rand).digest('hex')", "فرمول apikey"),
        ("adminapikey: node.api_key", "پارامتر adminapikey"),
        ("adminapipass: node.api_pass", "پارامتر adminapipass"),
        ("api: 'serialize'", "قالب پاسخ"),
        ("buf.toString('utf8', at, at + len)", "برش رشته بر حسب بایت"),
        (".filter((r) => isIpv4(r.ip))", "فیلتر نسخه ۴ در فهرست آی‌پی"),
        ("isIpv4(r.firstip)", "فیلتر نسخه ۴ در فهرست مخزن"),
    ]:
        if needle in src:
            print("گذشت  کد واقعی: %s" % why)
        else:
            failures += 1
            print("شکست  کد واقعی: %s پیدا نشد" % why)

    # رشته تصادفی باید هشت کاراکتر کوچک باشد، مثل generateRandStr
    if re.search(r"for \(let i = 0; i < 8; i\+\+\) rand \+=", src):
        print("گذشت  کد واقعی: طول رشته تصادفی هشت")
    else:
        failures += 1
        print("شکست  کد واقعی: طول رشته تصادفی هشت نیست")

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های پارس ویژالیزور گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
