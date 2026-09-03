#!/usr/bin/env bash
# استخراج تاریخچه روزانه vnstat برای وارد کردن در پنل.
#
# اجرا روی خود سرور اختصاصی:
#   curl -fsSL https://panel.example.com/agent/vnstat-export.sh | bash -s -- eno1 40
#
# آرگومان اول: نام رابط شبکه (همان که ایجنت می‌شمارد)
# آرگومان دوم: چند روز اخیر، پیش‌فرض ۶۰
#
# خروجی سه ستونی است و مستقیم در پنل، بخش «وارد کردن مصرف گذشته» چسبانده
# می‌شود. واحد بایت است، پس هنگام چسباندن واحد را روی «بایت» بگذارید.
#
# چرا vnstat: ایجنت گذشته را نمی‌سازد. شمارنده‌های /proc/net/dev تجمعی از
# زمان بوت‌اند و تفکیک روزانه‌شان هیچ‌جا ذخیره نشده. vnstat اگر از قبل روی
# نود بوده، تنها منبع محلی تاریخچه روزانه است.

set -euo pipefail

IFACE="${1:-}"
DAYS="${2:-60}"

red() { printf '\033[31m%s\033[0m\n' "$1" >&2; }

if [ -z "$IFACE" ]; then
  red "نام رابط شبکه لازم است."
  echo "نمونه: bash -s -- eno1 40" >&2
  echo "" >&2
  echo "اگر نمی‌دانید کدام رابط، این را بزنید:" >&2
  echo "  \$(command -v python3 || command -v python2) /usr/local/bin/pasargad-agent.py --list-ifaces" >&2
  exit 1
fi

if ! command -v vnstat >/dev/null 2>&1; then
  red "vnstat روی این سرور نصب نیست."
  echo "" >&2
  echo "بدون آن، تاریخچه روزانه روی خود نود وجود ندارد و باید عدد را از پنل" >&2
  echo "دیتاسنتر بردارید — که دقیق‌تر هم هست، چون همان چیزی است که فاکتور" >&2
  echo "بر مبنایش صادر می‌شود." >&2
  exit 1
fi

PY="$(command -v python3 || command -v python2 || true)"
if [ -z "$PY" ]; then
  red "پایتون پیدا نشد. برای پارس خروجی vnstat لازم است."
  exit 1
fi

vnstat --json d -i "$IFACE" 2>/dev/null | "$PY" -c '
import json, sys

try:
    data = json.load(sys.stdin)
except Exception as err:
    sys.stderr.write("خروجی vnstat خوانده نشد: %s\n" % err)
    sys.exit(1)

limit = int(sys.argv[1]) if len(sys.argv) > 1 else 60

# نسخه یک vnstat مقادیر را به کیبی‌بایت می‌دهد، نسخه دو به بایت.
# بدون این تبدیل، عددها هزار برابر کوچک‌تر وارد می‌شوند.
version = str(data.get("jsonversion", "2"))
factor = 1024 if version.startswith("1") else 1

interfaces = data.get("interfaces", [])
if not interfaces:
    sys.stderr.write("هیچ رابطی در خروجی vnstat نبود.\n")
    sys.exit(1)

traffic = interfaces[0].get("traffic", {})
days = traffic.get("day") or traffic.get("days") or []

rows = []
for entry in days:
    date = entry.get("date", {})
    try:
        stamp = "%04d-%02d-%02d" % (date["year"], date["month"], date["day"])
    except (KeyError, TypeError):
        continue
    rx = int(entry.get("rx", 0)) * factor
    tx = int(entry.get("tx", 0)) * factor
    rows.append((stamp, rx, tx))

rows.sort()
for stamp, rx, tx in rows[-limit:]:
    print("%s,%d,%d" % (stamp, rx, tx))

sys.stderr.write("\n%d روز استخراج شد. واحد: بایت.\n" % len(rows[-limit:]))
sys.stderr.write("در پنل: لاگ ترافیک ← وارد کردن مصرف گذشته ← واحد را روی «بایت» بگذارید.\n")
' "$DAYS"
