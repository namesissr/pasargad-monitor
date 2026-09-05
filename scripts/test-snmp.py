#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
آزمون کدک SNMP جمع‌کننده ESXi.

public/agent/esxi-agent.py پروتکل SNMPv2c را مستقیم پیاده کرده تا هیچ
پکیجی لازم نباشد. یعنی کدگذاری ASN.1 BER دست خودمان است — و اشتباه در
BER هیچ خطای خواندنی نمی‌سازد: بسته یا بی‌پاسخ می‌ماند یا عدد غلط
برمی‌گرداند.

اینجا رمزگذار و رمزگشا در برابر بایت‌های دستی‌محاسبه‌شده بررسی می‌شوند،
و یک پاسخ کامل SNMP ساخته و دوباره باز می‌شود.

اجرا:  python3 scripts/test-snmp.py
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "public", "agent"))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import importlib.util

spec = importlib.util.spec_from_file_location(
    "esxi_agent", os.path.join(ROOT, "public", "agent", "esxi-agent.py")
)
ea = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ea)


def hexs(b):
    return " ".join("%02x" % x for x in b)


# ── طول BER ───────────────────────────────────────────────────
LEN_CASES = [
    (0, "00", "صفر"),
    (5, "05", "کوتاه"),
    (127, "7f", "بزرگ‌ترین حالت کوتاه"),
    # ۱۲۸ به بالا حالت بلند است: بایت اول تعداد بایت‌های طول
    (128, "81 80", "کوچک‌ترین حالت بلند"),
    (255, "81 ff", "یک بایتی"),
    (256, "82 01 00", "دو بایتی"),
    (65535, "82 ff ff", "بیشینه دو بایتی"),
]

# ── عدد صحیح ──────────────────────────────────────────────────
INT_CASES = [
    (0, "02 01 00", "صفر"),
    (1, "02 01 01", "یک"),
    (127, "02 01 7f", "بزرگ‌ترین یک بایتی"),
    # مهم: بیت بالا که یک شود، بایت صفر جلویی لازم است وگرنه منفی خوانده
    # می‌شود. شناسه درخواست ما همیشه مثبت است و دقیقا اینجا گیر می‌کرد.
    (128, "02 02 00 80", "بایت صفر جلویی لازم است"),
    (255, "02 02 00 ff", "بایت صفر جلویی"),
    (256, "02 02 01 00", "دو بایتی"),
    (0x7FFFFFFF, "02 04 7f ff ff ff", "بیشینه شناسه درخواست"),
    (-1, "02 01 ff", "منفی یک"),
    (-128, "02 01 80", "منفی، یک بایتی"),
    (-129, "02 02 ff 7f", "منفی، دو بایتی"),
]

# ── شناسه شیء ─────────────────────────────────────────────────
OID_CASES = [
    # 1.3 → 40*1+3 = 43 = 0x2b
    ("1.3.6.1.2.1.1.1.0", "06 08 2b 06 01 02 01 01 01 00", "sysDescr"),
    ("1.3.6.1.2.1.1.3.0", "06 08 2b 06 01 02 01 01 03 00", "sysUpTime"),
    # 31 = 0x1f، تک بایتی
    ("1.3.6.1.2.1.31.1.1.1.6", "06 0a 2b 06 01 02 01 1f 01 01 01 06", "ifHCInOctets"),
    # زیرشناسه بزرگ‌تر از ۱۲۷ باید چند بایتی شود: 200 → 0x81 0x48
    ("1.3.6.1.4.1.200", "06 07 2b 06 01 04 01 81 48", "زیرشناسه دو بایتی"),
    # 2680 = 20×128 + 120 → 0x94 0x78
    ("1.3.6.1.4.1.2680", "06 07 2b 06 01 04 01 94 78", "زیرشناسه بزرگ‌تر"),
]

# ── رمزگشایی مقدار ────────────────────────────────────────────
VALUE_CASES = [
    (ea.TAG_INT, bytes([0x2A]), 42, "عدد صحیح"),
    (ea.TAG_INT, bytes([0xFF]), -1, "عدد منفی"),
    (ea.TAG_COUNTER32, bytes([0xFF, 0xFF, 0xFF, 0xFF]), 4294967295, "شمارنده ۳۲ بیتی بی‌علامت"),
    # حیاتی: شمارنده ۶۴ بیتی نباید علامت‌دار خوانده شود، وگرنه ترافیک
    # یک هاست پرمصرف عدد منفی می‌شود
    (ea.TAG_COUNTER64, bytes([0xFF] * 8), 18446744073709551615, "شمارنده ۶۴ بیتی بی‌علامت"),
    (ea.TAG_TIMETICKS, bytes([0x00, 0x01, 0x00, 0x00]), 65536, "TimeTicks"),
    (ea.TAG_OCTETS, "vmnic0".encode("utf-8"), "vmnic0", "رشته"),
    (ea.TAG_IPADDR, bytes([10, 10, 0, 1]), "10.10.0.1", "آی‌پی"),
    # سه تگ خطای SNMPv2 همه باید None شوند، نه صفر
    (ea.TAG_NO_SUCH_OBJECT, b"", None, "شیء وجود ندارد"),
    (ea.TAG_NO_SUCH_INSTANCE, b"", None, "نمونه وجود ندارد"),
    (ea.TAG_END_OF_MIB, b"", None, "پایان درخت"),
    (ea.TAG_NULL, b"", None, "تهی"),
]


def build_fake_response(request_id, varbinds, error_status=0, community="public"):
    """
    یک پاسخ کامل SNMPv2c می‌سازد تا parse_response واقعی روی آن اجرا شود.

    varbinds فهرست (شناسه، تگ، بدنه) است.
    """
    body = b""
    for oid, tag, value in varbinds:
        body += ea.tlv(ea.TAG_SEQ, ea.enc_oid(oid) + ea.tlv(tag, value))
    pdu = ea.tlv(
        ea.PDU_RESPONSE,
        ea.enc_int(request_id) + ea.enc_int(error_status) + ea.enc_int(0)
        + ea.tlv(ea.TAG_SEQ, body),
    )
    return ea.tlv(
        ea.TAG_SEQ,
        ea.enc_int(1) + ea.tlv(ea.TAG_OCTETS, community.encode("utf-8")) + pdu,
    )


def main():
    failures = 0

    def check(name, got, expected):
        nonlocal failures
        if got == expected:
            print("گذشت  %s" % name)
        else:
            failures += 1
            print("شکست  %s — انتظار %r، نتیجه %r" % (name, expected, got))

    for value, expected, name in LEN_CASES:
        check("طول: %s" % name, hexs(ea.enc_len(value)), expected)

    print("")

    for value, expected, name in INT_CASES:
        check("عدد: %s" % name, hexs(ea.enc_int(value)), expected)

    print("")

    for oid, expected, name in OID_CASES:
        check("شناسه: %s" % name, hexs(ea.enc_oid(oid)), expected)
        # رفت و برگشت: هرچه رمز شد باید دقیقا همان برگردد
        encoded = ea.enc_oid(oid)
        length, i = ea.dec_len(encoded, 1)
        check("شناسه (برگشت): %s" % name, ea.dec_oid(encoded[i:i + length]), oid)

    print("")

    for tag, body, expected, name in VALUE_CASES:
        check("مقدار: %s" % name, ea.dec_value(tag, body), expected)

    print("")

    # ── پاسخ کامل ─────────────────────────────────────────────
    packet = build_fake_response(
        12345,
        [
            (ea.OID_SYS_DESCR, ea.TAG_OCTETS, "VMware ESXi 7.0.3 build-21930508".encode("utf-8")),
            (ea.OID_IF_HC_IN + ".1", ea.TAG_COUNTER64,
             bytes([0x00, 0x00, 0x0A, 0xBC, 0xDE, 0xF0, 0x12, 0x34])),
        ],
    )
    pairs = ea.parse_response(packet, 12345)
    check("پاسخ: تعداد متغیرها", len(pairs), 2)
    check("پاسخ: شناسه اول", pairs[0][0], ea.OID_SYS_DESCR)
    check("پاسخ: مقدار اول", pairs[0][1], "VMware ESXi 7.0.3 build-21930508")
    check("پاسخ: شناسه دوم", pairs[1][0], ea.OID_IF_HC_IN + ".1")
    check("پاسخ: شمارنده ۶۴ بیتی", pairs[1][1], 0x00000ABCDEF01234)

    # شناسه درخواست نخواند = پاسخ متعلق به این درخواست نیست و باید رد شود.
    # بدون این بررسی، پاسخ دیرهنگام یک درخواست قبلی به‌جای پاسخ فعلی
    # خوانده می‌شود و دلتای ترافیک به هم می‌ریزد.
    try:
        ea.parse_response(packet, 999)
        failures += 1
        print("شکست  پاسخ: شناسه نامربوط باید رد شود")
    except ea.SnmpError:
        print("گذشت  پاسخ: شناسه نامربوط رد شد")

    # خطای ۲ یعنی «چنین نامی نیست» و نباید استثنا بدهد؛ بقیه باید بدهند
    ok2 = build_fake_response(7, [(ea.OID_SYS_NAME, ea.TAG_NULL, b"")], error_status=2)
    try:
        ea.parse_response(ok2, 7)
        print("گذشت  پاسخ: «نامی نیست» استثنا نمی‌دهد")
    except ea.SnmpError:
        failures += 1
        print("شکست  پاسخ: «نامی نیست» نباید استثنا بدهد")

    bad = build_fake_response(8, [(ea.OID_SYS_NAME, ea.TAG_NULL, b"")], error_status=5)
    try:
        ea.parse_response(bad, 8)
        failures += 1
        print("شکست  پاسخ: خطای واقعی باید استثنا بدهد")
    except ea.SnmpError:
        print("گذشت  پاسخ: خطای واقعی استثنا داد")

    # طول بلند: رشته بیش از ۱۲۷ بایت مسیر دیگری در رمزگشا دارد
    long_text = "x" * 300
    packet = build_fake_response(
        99, [(ea.OID_SYS_DESCR, ea.TAG_OCTETS, long_text.encode("utf-8"))]
    )
    pairs = ea.parse_response(packet, 99)
    check("پاسخ: رشته بلند (طول بلند BER)", pairs[0][1], long_text)

    print("")

    # ── انتخاب رابط ───────────────────────────────────────────
    names = {"1": "vmnic0", "2": "vmnic1", "3": "vmk0|Management Network", "4": "lo"}
    picked, missing = ea.resolve_ifaces(names, "vmnic0")
    check("رابط: یکی", (picked, missing), ([("vmnic0", "1")], []))
    picked, missing = ea.resolve_ifaces(names, "vmnic0,vmnic1")
    check("رابط: دو آپلینک باندشده", (picked, missing), ([("vmnic0", "1"), ("vmnic1", "2")], []))
    picked, missing = ea.resolve_ifaces(names, "vmk0")
    check("رابط: نام دوم ردیف", (picked, missing), ([("vmk0", "3")], []))
    picked, missing = ea.resolve_ifaces(names, "vmnic9")
    check("رابط: نبود، باید گزارش شود", (picked, missing), ([], ["vmnic9"]))
    # تطبیق باید کامل باشد نه جزئی: vmnic1 نباید با vmnic10 یکی شود
    picked, _ = ea.resolve_ifaces({"1": "vmnic10"}, "vmnic1")
    check("رابط: تطبیق جزئی نباید بگیرد", picked, [])

    print("")

    # ── انتخاب حافظه و دیسک ───────────────────────────────────
    rows = [
        {"index": "1", "name": "Real Memory", "total": 68719476736, "used": 34359738368},
        {"index": "2", "name": "/vmfs/volumes/datastore1", "total": 2000000000000, "used": 900000000000},
        {"index": "3", "name": "/vmfs/volumes/backup", "total": 500000000000, "used": 100000000000},
    ]
    check("حافظه: از روی نام", ea.pick_memory(rows)["index"], "1")
    check("دیسک: بزرگ‌ترین غیرحافظه", ea.pick_disk(rows)["index"], "2")
    check("دیسک: با تطبیق نام", ea.pick_disk(rows, "backup")["index"], "3")
    check("دیسک: تطبیق بی‌نتیجه", ea.pick_disk(rows, "nothing"), None)
    check("حافظه: نبود", ea.pick_memory([rows[1]]), None)

    print("")

    # ── قاعده‌ای که نباید شکسته شود ───────────────────────────
    src = io.open(
        os.path.join(ROOT, "public", "agent", "esxi-agent.py"), encoding="utf-8"
    ).read()

    # این ابزار روی هاستی با ماشین‌های مشتری اجرا می‌شود. هیچ مسیر نوشتنی
    # نباید داشته باشد — نه حالا، نه بعدا با یک ویرایش بی‌دقت.
    # به خود فراخوانی‌ها نگاه می‌شود نه به متن: بررسی متنی روی توضیحی که
    # می‌گوید «SetRequest پیاده نشده» هشدار کاذب می‌داد، و بررسی کاذب از
    # نبودِ بررسی بدتر است — کاربر یاد می‌گیرد نادیده‌اش بگیرد.
    calls = re.findall(r"self\._exchange\(\s*([A-Za-z_0-9]+)", src)
    allowed = {"PDU_GET", "PDU_GETNEXT"}
    bad = sorted(set(calls) - allowed)
    if not calls:
        failures += 1
        print("شکست  کد واقعی: هیچ فراخوانی _exchange پیدا نشد — الگوی بررسی کهنه شده")
    elif bad:
        failures += 1
        print("شکست  کد واقعی: نوع پیام غیرمجاز فرستاده می‌شود: %s" % ", ".join(bad))
    elif "0xA3" in src:
        failures += 1
        print("شکست  کد واقعی: ثابت SetRequest در فایل هست")
    else:
        print("گذشت  کد واقعی: فقط خواندن — %d فراخوانی، همه Get یا GetNext" % len(calls))

    for needle, why in [
        ("max(0, cur_in - prev_in)", "ریبوت هاست ترافیک نجومی نمی‌سازد"),
        ("pending_rx += d_rx", "شکست ارسال، حجم را نمی‌سوزاند"),
        ("if not sent:", "حجم معوق فقط وقتی نگه داشته می‌شود که ارسال نشده"),
        ("limit=512", "پیمایش سقف دارد"),
    ]:
        if needle in src:
            print("گذشت  کد واقعی: %s" % why)
        else:
            failures += 1
            print("شکست  کد واقعی: %s پیدا نشد" % why)

    print("")
    if failures:
        print("%d آزمون شکست خورد" % failures)
        return 1
    print("همه آزمون‌های کدک SNMP گذشتند")
    return 0


if __name__ == "__main__":
    sys.exit(main())
