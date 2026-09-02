#!/usr/bin/env bash
# نصب ایجنت پایش پاسارگاد میزبان
#
# اجرا:
#   curl -fsSL https://panel.example.com/agent/install.sh | bash -s -- <آدرس-پنل> <توکن>
#
# گزینه‌های اختیاری بعد از توکن:
#   --iface eth0        فقط ترافیک این رابط شمرده شود
#   --disk /home        فضای این پارتیشن گزارش شود
#   --interval 10       فاصله ارسال به ثانیه
#   --insecure          گواهی TLS بررسی نشود (گواهی خودامضا)

set -euo pipefail

PANEL_URL="${1:-}"
AGENT_TOKEN="${2:-}"
shift 2 2>/dev/null || true
EXTRA_ARGS="$*"

AGENT_PATH="/usr/local/bin/pasargad-agent.py"
SERVICE_PATH="/etc/systemd/system/pasargad-agent.service"

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
info()  { printf '\033[36m%s\033[0m\n' "$1"; }

if [ -z "$PANEL_URL" ] || [ -z "$AGENT_TOKEN" ]; then
  red "آدرس پنل و توکن لازم است."
  echo "نمونه: curl -fsSL https://panel.example.com/agent/install.sh | bash -s -- https://panel.example.com TOKEN"
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  red "این اسکریپت باید با کاربر روت اجرا شود."
  exit 1
fi

# ── پایتون ───────────────────────────────────────────────────────────────
if ! command -v python3 >/dev/null 2>&1; then
  info "پایتون ۳ نصب نیست؛ در حال نصب…"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq python3
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q python3
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q python3
  else
    red "مدیر بسته شناخته نشد. پایتون ۳ را دستی نصب کنید و دوباره اجرا کنید."
    exit 1
  fi
fi

# ── systemd ──────────────────────────────────────────────────────────────
if ! command -v systemctl >/dev/null 2>&1; then
  red "systemd روی این سیستم نیست. ایجنت را دستی اجرا کنید:"
  echo "  python3 $AGENT_PATH --url $PANEL_URL --token $AGENT_TOKEN"
  exit 1
fi

# ── دریافت ایجنت ─────────────────────────────────────────────────────────
info "در حال دریافت ایجنت از $PANEL_URL …"
CURL_OPTS="-fsSL"
case "$EXTRA_ARGS" in *--insecure*) CURL_OPTS="$CURL_OPTS -k" ;; esac

if ! curl $CURL_OPTS "$PANEL_URL/agent/pasargad-agent.py" -o "$AGENT_PATH.tmp"; then
  red "دریافت ایجنت ناموفق بود. آدرس پنل و دسترسی شبکه این سرور را بررسی کنید."
  rm -f "$AGENT_PATH.tmp"
  exit 1
fi

# بررسی سلامت فایل پیش از جایگزینی — نسخه ناقص بدتر از نسخه قدیمی است
if ! python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$AGENT_PATH.tmp" 2>/dev/null; then
  red "فایل دریافتی پایتون معتبر نیست. احتمالاً به‌جای ایجنت، صفحه خطا دریافت شده."
  rm -f "$AGENT_PATH.tmp"
  exit 1
fi

mv "$AGENT_PATH.tmp" "$AGENT_PATH"
chmod 755 "$AGENT_PATH"

# ── تشخیص نود مجازی‌ساز ──────────────────────────────────────────────────
# روی نود SolusVM یا Virtualizor، آی‌پی نود معمولاً روی بریج است و رابط‌های
# مهمان (vnet، tap، vif) هم ترافیک دارند. ایجنت خودش کارت فیزیکی را پیدا
# می‌کند، ولی اینجا نشانش می‌دهیم تا اگر اشتباه بود همان لحظه معلوم شود.
IS_HYPERVISOR=""
for marker in /usr/local/solusvm /usr/local/virtualizor /usr/local/emps /etc/libvirt/qemu; do
  [ -e "$marker" ] && IS_HYPERVISOR="1" && break
done

if [ -n "$IS_HYPERVISOR" ]; then
  echo
  info "نود مجازی‌ساز تشخیص داده شد. رابط‌های شبکه:"
  echo
  python3 "$AGENT_PATH" --list-ifaces ${EXTRA_ARGS} || true
  echo
  case "$EXTRA_ARGS" in
    *--iface*) ;;
    *) info "اگر رابط شمرده‌شده کارت فیزیکی نیست، نصب را با «--iface eth0» تکرار کنید." ;;
  esac
fi

# ── سرویس ────────────────────────────────────────────────────────────────
info "در حال ساخت سرویس systemd…"

# systemd نسخه ۲۱۹ (سنت‌اواس ۷) گزینه MemoryMax را نمی‌شناسد و نام قدیمی‌اش
# MemoryLimit است. گزینه ناشناخته سرویس را نمی‌کشد ولی سقف حافظه هم اعمال
# نمی‌شود — یعنی دقیقاً همان محافظی که می‌خواستیم برقرار نیست.
SYSTEMD_VER="$(systemctl --version 2>/dev/null | head -1 | awk '{print $2}' | tr -cd '0-9')"
if [ -n "$SYSTEMD_VER" ] && [ "$SYSTEMD_VER" -lt 231 ] 2>/dev/null; then
  MEM_DIRECTIVE="MemoryLimit=128M"
else
  MEM_DIRECTIVE="MemoryMax=128M"
fi

cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=Pasargad Mizban monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 $AGENT_PATH --url $PANEL_URL --token $AGENT_TOKEN $EXTRA_ARGS
Restart=always
RestartSec=15
User=root
# اولویت پایین تا روی نود پرمشغله هرگز جلوی مهمان‌ها را نگیرد
Nice=19
IOSchedulingClass=idle
$MEM_DIRECTIVE
CPUQuota=5%
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

chmod 600 "$SERVICE_PATH"   # توکن داخل فایل است؛ فقط روت بخواند

systemctl daemon-reload
systemctl enable pasargad-agent >/dev/null 2>&1
systemctl restart pasargad-agent

sleep 3

if systemctl is-active --quiet pasargad-agent; then
  green "ایجنت نصب شد و در حال اجراست."
  echo
  echo "وضعیت:    systemctl status pasargad-agent"
  echo "لاگ زنده: journalctl -u pasargad-agent -f"
  echo
  info "تا یک دقیقه دیگر آمار این سرور در پنل ظاهر می‌شود."
else
  red "سرویس بالا نیامد. لاگ:"
  journalctl -u pasargad-agent -n 30 --no-pager
  exit 1
fi
