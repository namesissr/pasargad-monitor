#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
جمع‌کننده VMware ESXi برای پنل پاسارگاد میزبان.

ایجنت معمولی پنل روی ESXi کار نمی‌کند: با /proc/stat و /proc/net/dev و
مانند آن‌ها کار می‌کند و هسته VMkernel هیچ‌کدام را ندارد. ضمنا ESXi
systemd ندارد و هرچه در فایل‌سیستمش بنویسید با ریبوت می‌پرد.

پس این اسکریپت **روی خود ESXi اجرا نمی‌شود**. روی سرور پنل (یا هر لینوکس
دیگری که به هاست دسترسی دارد) می‌نشیند، با SNMP از ESXi آمار می‌خواند و
با توکن همان سرور به /api/ingest می‌فرستد. برای پنل هیچ فرقی با یک ایجنت
معمولی ندارد.

فقط از کتابخانه استاندارد پایتون ۳٫۶ به بعد استفاده می‌کند — نه pip، نه
net-snmp. پروتکل SNMPv2c مستقیم پیاده شده است.

    python3 esxi-agent.py --url https://panel.example.com --token XXXX \
        --host 192.168.10.5 --community public --iface vmnic0

پیش از راه‌اندازی، یک بار ببینید هاست شما واقعا چه چیزی بیرون می‌دهد:

    python3 esxi-agent.py --host 192.168.10.5 --community public --probe

دسترسی فقط خواندنی است: این اسکریپت جز GetRequest و GetNextRequest چیزی
نمی‌فرستد و هیچ‌وقت SetRequest نمی‌زند.

نکته درباره ترافیک: شمارنده‌های ifHCInOctets تجمعی‌اند و با ریبوت هاست یا
سرریز شمارنده صفر می‌شوند. مثل ایجنت اصلی، دلتا گرفته می‌شود و مقدار
کمتر از قبلی صفر حساب می‌شود نه یک عدد نجومی. اگر ارسال به پنل شکست
بخورد حجم همان بازه نگه داشته و به بازه بعد اضافه می‌شود.
"""

import argparse
import json
import os
import random
import socket
import ssl
import sys
import time

from urllib.request import Request, urlopen
from urllib.error import HTTPError

VERSION = "1.0.0"

# ─────────────────────────── شناسه‌های استاندارد ───────────────────────────
#
# همه از MIBهای استانداردند: SNMPv2-MIB، IF-MIB، HOST-RESOURCES-MIB.
# ESXi این‌ها را پشتیبانی می‌کند، ولی اینکه هر ردیف واقعا پر باشد به نسخه
# بستگی دارد — به همین دلیل هیچ‌کدام اجباری نیست و نبودشان گزارش می‌شود.

OID_SYS_DESCR = "1.3.6.1.2.1.1.1.0"
OID_SYS_UPTIME = "1.3.6.1.2.1.1.3.0"          # TimeTicks، صدم ثانیه
OID_SYS_NAME = "1.3.6.1.2.1.1.5.0"
OID_HR_UPTIME = "1.3.6.1.2.1.25.1.1.0"        # آپ‌تایم سیستم، نه ایجنت

OID_IF_DESCR = "1.3.6.1.2.1.2.2.1.2"
OID_IF_NAME = "1.3.6.1.2.1.31.1.1.1.1"
OID_IF_HC_IN = "1.3.6.1.2.1.31.1.1.1.6"       # Counter64
OID_IF_HC_OUT = "1.3.6.1.2.1.31.1.1.1.10"
OID_IF_IN = "1.3.6.1.2.1.2.2.1.10"            # Counter32، واپسین
OID_IF_OUT = "1.3.6.1.2.1.2.2.1.16"

OID_HR_CPU_LOAD = "1.3.6.1.2.1.25.3.3.1.2"    # درصد بار هر هسته

OID_HR_ST_DESCR = "1.3.6.1.2.1.25.2.3.1.3"
OID_HR_ST_UNITS = "1.3.6.1.2.1.25.2.3.1.4"
OID_HR_ST_SIZE = "1.3.6.1.2.1.25.2.3.1.5"
OID_HR_ST_USED = "1.3.6.1.2.1.25.2.3.1.6"

# ردیف حافظه در جدول hrStorage با توضیحش شناخته می‌شود. ESXi و نسخه‌های
# مختلفش عبارت یکسانی نمی‌نویسند، پس چند حالت پذیرفته می‌شود.
MEM_PATTERNS = ("real memory", "physical memory", "memory buffers", "ram")


# متن این ابزار فارسی است و کنسولی که یونیکد نپذیرد، روی همان اولین خط
# با UnicodeEncodeError می‌میرد — یعنی دقیقا وقتی می‌خواهد بگوید چه
# اشکالی هست. ایجنت اصلی یک بار سر همین در حلقه ری‌استارت افتاد.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def say(*args):
    print(*args)
    sys.stdout.flush()


def err(*args):
    print(*args, file=sys.stderr)
    sys.stderr.flush()


# ═══════════════════════════════ کدک BER ═══════════════════════════════
#
# SNMP روی ASN.1 BER سوار است. پیاده‌سازی کامل ASN.1 لازم نیست؛ فقط همان
# چند نوعی که در SNMPv2c رد و بدل می‌شود.

TAG_INT = 0x02
TAG_OCTETS = 0x04
TAG_NULL = 0x05
TAG_OID = 0x06
TAG_SEQ = 0x30
TAG_IPADDR = 0x40
TAG_COUNTER32 = 0x41
TAG_GAUGE32 = 0x42
TAG_TIMETICKS = 0x43
TAG_OPAQUE = 0x44
TAG_COUNTER64 = 0x46
TAG_NO_SUCH_OBJECT = 0x80
TAG_NO_SUCH_INSTANCE = 0x81
TAG_END_OF_MIB = 0x82

PDU_GET = 0xA0
PDU_GETNEXT = 0xA1
PDU_RESPONSE = 0xA2


class SnmpError(Exception):
    pass


def enc_len(n):
    """طول به شکل BER — کوتاه زیر ۱۲۸، وگرنه بلند"""
    if n < 0x80:
        return bytes([n])
    body = b""
    while n:
        body = bytes([n & 0xFF]) + body
        n >>= 8
    return bytes([0x80 | len(body)]) + body


def tlv(tag, body):
    return bytes([tag]) + enc_len(len(body)) + body


def enc_int(value):
    """
    عدد صحیح علامت‌دار، با کمترین تعداد بایت.

    بایت صفر جلویی وقتی لازم است که بیت بالای اولین بایت یک باشد؛ بدون آن
    عدد مثبت به‌شکل منفی خوانده می‌شود. شناسه درخواست ما همیشه مثبت است و
    دقیقا همین‌جا گیر می‌کرد.
    """
    if value == 0:
        return tlv(TAG_INT, b"\x00")
    negative = value < 0
    body = b""
    v = value
    if negative:
        # مکمل دو، با گسترش علامت
        while v < -128 or (body and v != -1):
            body = bytes([v & 0xFF]) + body
            v >>= 8
        body = bytes([v & 0xFF]) + body
    else:
        while v:
            body = bytes([v & 0xFF]) + body
            v >>= 8
        if body[0] & 0x80:
            body = b"\x00" + body
    return tlv(TAG_INT, body)


def enc_oid(oid):
    parts = [int(x) for x in str(oid).split(".") if x != ""]
    if len(parts) < 2:
        raise SnmpError("شناسه شیء نامعتبر: %s" % oid)
    body = bytearray([parts[0] * 40 + parts[1]])
    for p in parts[2:]:
        if p < 0x80:
            body.append(p)
            continue
        chunk = bytearray([p & 0x7F])
        p >>= 7
        while p:
            chunk.insert(0, (p & 0x7F) | 0x80)
            p >>= 7
        body += chunk
    return tlv(TAG_OID, bytes(body))


def dec_len(data, i):
    """طول را می‌خواند و جای شروع محتوا را برمی‌گرداند"""
    if i >= len(data):
        raise SnmpError("پاسخ ناقص است")
    first = data[i]
    i += 1
    if first < 0x80:
        return first, i
    count = first & 0x7F
    if count == 0 or i + count > len(data):
        raise SnmpError("طول BER نامعتبر است")
    length = 0
    for _ in range(count):
        length = (length << 8) | data[i]
        i += 1
    return length, i


def dec_oid(body):
    if not body:
        return ""
    parts = [body[0] // 40, body[0] % 40]
    value = 0
    for b in body[1:]:
        value = (value << 7) | (b & 0x7F)
        if not (b & 0x80):
            parts.append(value)
            value = 0
    return ".".join(str(p) for p in parts)


def dec_uint(body):
    value = 0
    for b in body:
        value = (value << 8) | b
    return value


def dec_int(body):
    if not body:
        return 0
    value = dec_uint(body)
    if body[0] & 0x80:                       # منفی، مکمل دو
        value -= 1 << (8 * len(body))
    return value


def dec_value(tag, body):
    """
    مقدار یک متغیر را به شکل پایتونی برمی‌گرداند.

    سه تگ خطای SNMPv2 — شیء نیست، نمونه نیست، پایان درخت — همه None
    می‌شوند. تفاوتشان برای ما فرقی ندارد: هر سه یعنی «این هاست این را
    ندارد» و باید بی‌سروصدا رد شود، نه اینکه صفر گزارش شود.
    """
    if tag in (TAG_NO_SUCH_OBJECT, TAG_NO_SUCH_INSTANCE, TAG_END_OF_MIB, TAG_NULL):
        return None
    if tag == TAG_INT:
        return dec_int(body)
    if tag in (TAG_COUNTER32, TAG_GAUGE32, TAG_TIMETICKS, TAG_COUNTER64):
        return dec_uint(body)
    if tag == TAG_OID:
        return dec_oid(body)
    if tag == TAG_IPADDR:
        return ".".join(str(b) for b in body)
    # OCTET STRING و بقیه: متن، با جایگزینی بایت‌های نامعتبر
    return body.decode("utf-8", "replace")


def build_pdu(pdu_type, request_id, oids):
    varbinds = b"".join(tlv(TAG_SEQ, enc_oid(o) + tlv(TAG_NULL, b"")) for o in oids)
    return tlv(
        pdu_type,
        enc_int(request_id) + enc_int(0) + enc_int(0) + tlv(TAG_SEQ, varbinds),
    )


def build_message(community, pdu):
    return tlv(
        TAG_SEQ,
        enc_int(1)                                    # نسخه ۱ یعنی SNMPv2c
        + tlv(TAG_OCTETS, community.encode("utf-8"))
        + pdu,
    )


def parse_response(data, expect_id):
    """پیام پاسخ را باز می‌کند و فهرست (شناسه، مقدار) برمی‌گرداند"""
    i = 0
    if not data or data[0] != TAG_SEQ:
        raise SnmpError("پاسخ SNMP نیست")
    _, i = dec_len(data, 1)

    if data[i] != TAG_INT:
        raise SnmpError("شماره نسخه پیدا نشد")
    ln, j = dec_len(data, i + 1)
    i = j + ln

    if data[i] != TAG_OCTETS:
        raise SnmpError("نام جامعه پیدا نشد")
    ln, j = dec_len(data, i + 1)
    i = j + ln

    if data[i] != PDU_RESPONSE:
        raise SnmpError("نوع پیام پاسخ نیست (0x%02X)" % data[i])
    _, i = dec_len(data, i + 1)

    ln, j = dec_len(data, i + 1)
    request_id = dec_int(data[j:j + ln])
    i = j + ln
    if request_id != expect_id:
        raise SnmpError("شناسه درخواست نمی‌خواند")

    ln, j = dec_len(data, i + 1)
    error_status = dec_int(data[j:j + ln])
    i = j + ln
    ln, j = dec_len(data, i + 1)
    error_index = dec_int(data[j:j + ln])
    i = j + ln

    # خطای ۲ یعنی «چنین نامی نیست» و در SNMPv1 عادی است؛ بقیه واقعا خطایند
    if error_status not in (0, 2):
        raise SnmpError("هاست خطای %d داد (متغیر %d)" % (error_status, error_index))

    if data[i] != TAG_SEQ:
        raise SnmpError("فهرست متغیرها پیدا نشد")
    ln, i = dec_len(data, i + 1)
    end = i + ln

    out = []
    while i < end:
        if data[i] != TAG_SEQ:
            raise SnmpError("متغیر نامعتبر")
        ln, i = dec_len(data, i + 1)
        stop = i + ln

        if data[i] != TAG_OID:
            raise SnmpError("شناسه شیء پیدا نشد")
        oln, oi = dec_len(data, i + 1)
        oid = dec_oid(data[oi:oi + oln])
        i = oi + oln

        tag = data[i]
        vln, vi = dec_len(data, i + 1)
        out.append((oid, dec_value(tag, data[vi:vi + vln])))
        i = stop
    return out


class Snmp(object):
    """
    کلاینت SNMPv2c روی UDP.

    فقط GetRequest و GetNextRequest می‌فرستد. SetRequest عمدا پیاده نشده
    است — این ابزار روی یک هاست تولیدی با ماشین‌های مشتری کار می‌کند و
    نباید امکان نوشتن داشته باشد.
    """

    def __init__(self, host, community="public", port=161, timeout=2.0, retries=3):
        self.host = host
        self.community = community
        self.port = port
        self.timeout = timeout
        self.retries = retries

    def _exchange(self, pdu_type, oids):
        last = None
        for _ in range(self.retries):
            request_id = random.randint(1, 0x7FFFFFFF)
            packet = build_message(self.community, build_pdu(pdu_type, request_id, oids))
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(self.timeout)
            try:
                sock.sendto(packet, (self.host, self.port))
                data, _addr = sock.recvfrom(65535)
                return parse_response(data, request_id)
            except socket.timeout:
                last = SnmpError("هاست پاسخ نداد (%s:%d)" % (self.host, self.port))
            except SnmpError as e:
                last = e
            finally:
                sock.close()
        raise last if last else SnmpError("پاسخی نیامد")

    def get(self, *oids):
        """دیکشنری شناسه→مقدار؛ شناسه‌هایی که هاست ندارد اصلا نمی‌آیند"""
        out = {}
        for oid, value in self._exchange(PDU_GET, list(oids)):
            if value is not None:
                out[oid] = value
        return out

    def get_one(self, oid, default=None):
        return self.get(oid).get(oid, default)

    def walk(self, base, limit=512):
        """
        پیمایش یک زیردرخت با GetNextRequest.

        سقف تعداد عمدی است: اگر هاست شناسه‌ای بیرون از زیردرخت برگرداند و
        شرط توقف به هر دلیل نگیرد، این حلقه نباید تا ابد بچرخد.
        """
        rows = []
        current = base
        prefix = base + "."
        for _ in range(limit):
            pairs = self._exchange(PDU_GETNEXT, [current])
            if not pairs:
                break
            oid, value = pairs[0]
            if not oid.startswith(prefix):
                break
            if oid == current:                    # هاست جلو نرفت
                break
            if value is not None:
                rows.append((oid, value))
            current = oid
        return rows


def index_of(oid, base):
    """آخرین بخش شناسه نسبت به ریشه جدول — همان شماره ردیف"""
    return oid[len(base) + 1:]


# ═══════════════════════════ خواندن از ESXi ═══════════════════════════

def interface_table(snmp):
    """
    نگاشت شماره ردیف → نام رابط.

    هم ifDescr خوانده می‌شود هم ifName. روی نسخه‌های مختلف ESXi یکی از این
    دو ممکن است vmnic0 بدهد و دیگری چیز دیگری، پس هر دو پذیرفته می‌شوند.
    """
    names = {}
    for oid, value in snmp.walk(OID_IF_DESCR):
        names[index_of(oid, OID_IF_DESCR)] = str(value).strip()
    for oid, value in snmp.walk(OID_IF_NAME):
        idx = index_of(oid, OID_IF_NAME)
        text = str(value).strip()
        if text and idx not in names:
            names[idx] = text
        elif text and names.get(idx) != text:
            # هر دو نام نگه داشته می‌شود تا تطبیق با هر کدام کار کند
            names[idx] = names[idx] + "|" + text
    return names


def resolve_ifaces(names, wanted):
    """
    شماره ردیف رابط‌های خواسته‌شده.

    چند رابط با ویرگول جدا می‌شود و ترافیکشان با هم جمع می‌شود — روی
    هاستی که دو آپلینک باند شده دارد، شمردن یکی نصف ترافیک را می‌بازد.
    """
    picked = []
    missing = []
    for want in [w.strip() for w in wanted.split(",") if w.strip()]:
        found = None
        for idx, name in names.items():
            if want in [p.strip() for p in name.split("|")]:
                found = idx
                break
        if found is None:
            missing.append(want)
        else:
            picked.append((want, found))
    return picked, missing


def iface_counters(snmp, picked):
    """
    مجموع بایت ورودی و خروجی رابط‌های انتخاب‌شده.

    اول شمارنده ۶۴ بیتی امتحان می‌شود. شمارنده ۳۲ بیتی روی پیوند یک
    گیگابیتی هر ۳۴ ثانیه سرریز می‌کند، پس فقط وقتی استفاده می‌شود که
    هاست نسخه ۶۴ بیتی را ندهد — و آن وقت هم هشدارش نوشته می‌شود.
    """
    total_in = 0
    total_out = 0
    used_32bit = False
    for _name, idx in picked:
        got = snmp.get(OID_IF_HC_IN + "." + idx, OID_IF_HC_OUT + "." + idx)
        rx = got.get(OID_IF_HC_IN + "." + idx)
        tx = got.get(OID_IF_HC_OUT + "." + idx)
        if rx is None or tx is None:
            got = snmp.get(OID_IF_IN + "." + idx, OID_IF_OUT + "." + idx)
            rx = got.get(OID_IF_IN + "." + idx, 0)
            tx = got.get(OID_IF_OUT + "." + idx, 0)
            used_32bit = True
        total_in += int(rx or 0)
        total_out += int(tx or 0)
    return total_in, total_out, used_32bit


def cpu_percent(snmp):
    """میانگین بار هسته‌ها؛ None یعنی هاست این جدول را ندارد"""
    rows = snmp.walk(OID_HR_CPU_LOAD)
    values = [int(v) for _o, v in rows if isinstance(v, int)]
    if not values:
        return None, 0
    return sum(values) / float(len(values)), len(values)


def storage_table(snmp):
    """جدول hrStorage به شکل فهرست دیکشنری، با اندازه‌ها بر حسب بایت"""
    descr = {index_of(o, OID_HR_ST_DESCR): str(v).strip() for o, v in snmp.walk(OID_HR_ST_DESCR)}
    units = {index_of(o, OID_HR_ST_UNITS): int(v) for o, v in snmp.walk(OID_HR_ST_UNITS)
             if isinstance(v, int)}
    size = {index_of(o, OID_HR_ST_SIZE): int(v) for o, v in snmp.walk(OID_HR_ST_SIZE)
            if isinstance(v, int)}
    used = {index_of(o, OID_HR_ST_USED): int(v) for o, v in snmp.walk(OID_HR_ST_USED)
            if isinstance(v, int)}

    rows = []
    for idx, name in descr.items():
        unit = units.get(idx, 0)
        if unit <= 0 or idx not in size:
            continue
        rows.append({
            "index": idx,
            "name": name,
            "total": size[idx] * unit,
            "used": used.get(idx, 0) * unit,
        })
    return rows


def pick_memory(rows):
    for row in rows:
        low = row["name"].lower()
        if any(p in low for p in MEM_PATTERNS):
            return row
    return None


def pick_disk(rows, match=""):
    """
    بزرگ‌ترین فضای ذخیره‌سازی که حافظه نیست.

    اگر --disk-match داده شود، فقط ردیفی که نامش آن را دارد. بدون آن،
    بزرگ‌ترین ردیف انتخاب می‌شود — روی ESXi معمولا همان دیتااستور اصلی
    است، ولی اگر چند دیتااستور دارید بهتر است صریح بگویید کدام.
    """
    candidates = []
    for row in rows:
        low = row["name"].lower()
        if any(p in low for p in MEM_PATTERNS):
            continue
        if match and match.lower() not in low:
            continue
        candidates.append(row)
    if not candidates:
        return None
    return max(candidates, key=lambda r: r["total"])


def uptime_seconds(snmp):
    """آپ‌تایم سیستم؛ اگر نبود، آپ‌تایم خود ایجنت SNMP"""
    value = snmp.get_one(OID_HR_UPTIME)
    if not isinstance(value, int):
        value = snmp.get_one(OID_SYS_UPTIME)
    if not isinstance(value, int):
        return None
    return int(value / 100)                      # TimeTicks صدم ثانیه است


def os_name(descr):
    """
    نام سیستم از sysDescr.

    sysDescr روی ESXi یک جمله بلند است. خط اول و کوتاه‌شده کافی است؛ ستون
    پنل جا برای بیشتر ندارد.
    """
    text = str(descr or "").split("\n")[0].strip()
    return text[:120] if text else "VMware ESXi"


# ═══════════════════════════ ارسال به پنل ═══════════════════════════

def post(url, payload, token, insecure=False, timeout=15):
    body = json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={
            "content-type": "application/json",
            "x-agent-token": token,
            "user-agent": "pasargad-esxi-agent/" + VERSION,
        },
    )
    ctx = None
    if url.startswith("https") and insecure:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    response = urlopen(req, timeout=timeout, context=ctx) if ctx else urlopen(req, timeout=timeout)
    try:
        return json.loads(response.read().decode("utf-8"))
    finally:
        response.close()


def human(n):
    for unit in ("بایت", "کیلوبایت", "مگابایت", "گیگابایت", "ترابایت"):
        if n < 1024 or unit == "ترابایت":
            return "%.1f %s" % (n, unit)
        n /= 1024.0


# ═══════════════════════════ حالت بررسی ═══════════════════════════

def probe(snmp):
    """
    فقط می‌خواند و چاپ می‌کند: هاست شما واقعا چه چیزی بیرون می‌دهد.

    پیش از راه‌اندازی یک بار این را بزنید. نسخه‌های مختلف ESXi جدول‌های
    متفاوتی پر می‌کنند و حدس‌زدن راه درستی نیست.
    """
    say("── شناسنامه ──────────────────────────────")
    for label, oid in (("sysDescr", OID_SYS_DESCR), ("sysName", OID_SYS_NAME)):
        say("  %-10s %s" % (label, snmp.get_one(oid, "— ندارد —")))
    up = uptime_seconds(snmp)
    say("  %-10s %s" % ("آپ‌تایم", ("%d ساعت" % (up // 3600)) if up else "— ندارد —"))

    say("")
    say("── رابط‌های شبکه ─────────────────────────")
    names = interface_table(snmp)
    if not names:
        say("  هیچ رابطی برنگشت — IF-MIB روی این هاست فعال نیست")
    for idx in sorted(names, key=lambda x: int(x) if x.isdigit() else 0):
        got = snmp.get(OID_IF_HC_IN + "." + idx, OID_IF_HC_OUT + "." + idx)
        rx = got.get(OID_IF_HC_IN + "." + idx)
        kind = "۶۴ بیتی" if rx is not None else "فقط ۳۲ بیتی"
        if rx is None:
            rx = snmp.get_one(OID_IF_IN + "." + idx, 0)
        say("  [%3s] %-28s %-12s %s" % (idx, names[idx], kind, human(int(rx or 0))))

    say("")
    say("── پردازنده ──────────────────────────────")
    pct, cores = cpu_percent(snmp)
    if pct is None:
        say("  hrProcessorLoad برنگشت — درصد پردازنده گزارش نمی‌شود")
    else:
        say("  %d هسته، میانگین بار %.1f درصد" % (cores, pct))

    say("")
    say("── حافظه و ذخیره‌سازی ────────────────────")
    rows = storage_table(snmp)
    if not rows:
        say("  hrStorage برنگشت — حافظه و دیسک گزارش نمی‌شوند")
    for row in rows:
        say("  [%3s] %-34s %s از %s"
            % (row["index"], row["name"][:34], human(row["used"]), human(row["total"])))

    mem = pick_memory(rows)
    disk = pick_disk(rows)
    say("")
    say("── چه چیزی به پنل می‌رود ─────────────────")
    say("  حافظه: %s" % (mem["name"] if mem else "— پیدا نشد —"))
    say("  دیسک : %s" % (disk["name"] if disk else "— پیدا نشد —"))
    say("")
    say("اگر انتخاب دیسک درست نیست، با --disk-match بخشی از نامش را بدهید.")


# ═══════════════════════════════ اجرا ═══════════════════════════════

def unreachable(host, e):
    """
    پیام خوانا به‌جای traceback خام.

    نرسیدن به هاست رایج‌ترین حالت است و سه علت متفاوت دارد که هیچ‌کدام
    از متن استثنا معلوم نمی‌شود. بدون این راهنما، کاربر یک خط پایتونی
    می‌بیند که هیچ نمی‌گوید کجا را نگاه کند.
    """
    err("خطا: %s" % e)
    err("")
    err("سه چیز را به ترتیب بررسی کنید:")
    err("  ۱) SNMP روی هاست فعال است؟   esxcli system snmp get")
    err("  ۲) فایروال ESXi باز است؟      esxcli network firewall ruleset list | grep snmp")
    err("  ۳) نام جامعه درست است؟")
    err("")
    err("SNMP روی UDP است، پس پاسخ‌دادن ping چیزی را ثابت نمی‌کند.")


def main():
    ap = argparse.ArgumentParser(description="جمع‌کننده VMware ESXi برای پنل پاسارگاد میزبان")
    ap.add_argument("--host", required=True, help="آی‌پی یا نام هاست ESXi")
    ap.add_argument("--community", default=os.environ.get("SNMP_COMMUNITY", "public"),
                    help="نام جامعه SNMP فقط‌خواندنی")
    ap.add_argument("--snmp-port", type=int, default=161)
    ap.add_argument("--url", help="آدرس پنل، مثلا https://panel.example.com")
    ap.add_argument("--token", help="توکن ایجنت این سرور در پنل")
    ap.add_argument("--iface", default="vmnic0",
                    help="رابط آپلینک؛ چند تا را با ویرگول جدا کنید تا جمع شوند")
    ap.add_argument("--disk-match", default="",
                    help="بخشی از نام دیتااستوری که فضایش گزارش شود")
    ap.add_argument("--interval", type=int, default=30, help="فاصله ارسال به ثانیه")
    ap.add_argument("--insecure", action="store_true", help="گواهی TLS پنل بررسی نشود")
    ap.add_argument("--probe", action="store_true",
                    help="فقط بخوان و نشان بده هاست چه چیزی دارد؛ چیزی به پنل نمی‌رود")
    ap.add_argument("--once", action="store_true", help="یک بار بفرست و خارج شو")
    args = ap.parse_args()

    snmp = Snmp(args.host, args.community, args.snmp_port)

    if args.probe:
        try:
            probe(snmp)
        except SnmpError as e:
            unreachable(args.host, e)
            return 1
        return 0

    if not args.url or not args.token:
        err("خطا: برای ارسال به پنل هم --url لازم است هم --token")
        err("      اگر فقط می‌خواهید ببینید هاست چه دارد، --probe را بزنید.")
        return 2

    endpoint = args.url.rstrip("/") + "/api/ingest"

    # ── آماده‌سازی: یک بار خوانده می‌شود و ثابت می‌ماند ──
    try:
        descr = snmp.get_one(OID_SYS_DESCR, "")
    except SnmpError as e:
        unreachable(args.host, e)
        return 1
    hostname = str(snmp.get_one(OID_SYS_NAME, args.host)).strip() or args.host
    system = os_name(descr)

    names = interface_table(snmp)
    picked, missing = resolve_ifaces(names, args.iface)
    if missing:
        err("خطا: این رابط‌ها روی هاست نیستند: %s" % ", ".join(missing))
        err("      رابط‌های موجود: %s" % ", ".join(sorted(set(names.values()))))
        err("      با --probe فهرست کامل را ببینید.")
        return 2
    say("رابط شمرده‌شده: %s" % ", ".join("%s (ردیف %s)" % p for p in picked))

    _pct, cores = cpu_percent(snmp)
    if cores == 0:
        err("هشدار: hrProcessorLoad برنگشت — درصد پردازنده گزارش نمی‌شود")

    rows = storage_table(snmp)
    if not pick_memory(rows):
        err("هشدار: ردیف حافظه در hrStorage پیدا نشد — حافظه گزارش نمی‌شود")
    if not pick_disk(rows, args.disk_match):
        err("هشدار: دیتااستوری با این مشخصات پیدا نشد — فضای دیسک گزارش نمی‌شود")

    prev_in, prev_out, used_32 = iface_counters(snmp, picked)
    if used_32:
        err("هشدار: هاست فقط شمارنده ۳۲ بیتی دارد. روی پیوند پرسرعت این "
            "شمارنده زود سرریز می‌کند؛ فاصله ارسال را کوتاه نگه دارید.")
    prev_time = time.time()

    # حجمی که به‌خاطر شکست ارسال هنوز گزارش نشده
    pending_rx = 0
    pending_tx = 0

    say("جمع‌کننده ESXi نسخه %s شروع شد. هاست: %s، مقصد: %s"
        % (VERSION, args.host, endpoint))

    # اولین بازه فقط مبنای دلتا را می‌سازد
    if not args.once:
        time.sleep(args.interval)

    while True:
        started = time.time()
        d_rx = d_tx = 0
        sent = False

        try:
            now = time.time()
            elapsed = max(0.001, now - prev_time)

            cur_in, cur_out, _ = iface_counters(snmp, picked)
            # منفی یعنی ریبوت هاست یا سرریز شمارنده؛ صفر حساب می‌شود نه
            # یک عدد نجومی که کل آمار ماه را خراب کند
            d_rx = max(0, cur_in - prev_in)
            d_tx = max(0, cur_out - prev_out)
            prev_in, prev_out = cur_in, cur_out
            prev_time = now

            payload = {
                "token": args.token,
                "hostname": hostname,
                "os": system,
                "agent_version": "esxi/" + VERSION,
                "net": {
                    "rx_bytes": d_rx + pending_rx,
                    "tx_bytes": d_tx + pending_tx,
                    # سرعت لحظه‌ای فقط از همین بازه، نه از حجم معوق
                    "rx_bps": int(d_rx * 8 / elapsed),
                    "tx_bps": int(d_tx * 8 / elapsed),
                    "iface": args.iface,
                },
            }

            pct, cores = cpu_percent(snmp)
            if pct is not None:
                payload["cpu"] = {"percent": round(pct, 2), "cores": cores,
                                  "model": "VMware ESXi"}

            rows = storage_table(snmp)
            mem = pick_memory(rows)
            if mem:
                payload["mem"] = {"used": mem["used"], "total": mem["total"]}
            disk = pick_disk(rows, args.disk_match)
            if disk:
                payload["disk"] = {"used": disk["used"], "total": disk["total"]}

            up = uptime_seconds(snmp)
            if up is not None:
                payload["uptime"] = up

            post(endpoint, payload, args.token, args.insecure)
            sent = True
            pending_rx = pending_tx = 0

        except HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:200]
            except Exception:
                pass
            err("ارسال به پنل شکست خورد: %s %s" % (e.code, detail))
        except SnmpError as e:
            # خواندن از هاست نشد. عمدا چیزی به پنل نمی‌رود: نبود گزارش
            # یعنی پنل خودش سرور را قطع تشخیص می‌دهد، که همان واقعیت است.
            err("خواندن از هاست شکست خورد: %s" % e)
        except Exception as e:
            err("خطای غیرمنتظره: %s" % e)

        if not sent:
            pending_rx += d_rx
            pending_tx += d_tx

        if args.once:
            return 0 if sent else 1

        time.sleep(max(1, args.interval - (time.time() - started)))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
