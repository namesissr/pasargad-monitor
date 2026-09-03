#!/usr/bin/env bash
# نصب دیدبان اکسس یا ایجنت لنگر — پاسارگاد میزبان
#
# دیدبان (روی سرور داخل یا خارج ایران؛ توکن از پنل، بخش دیدبان‌ها):
#   curl -fsSL https://panel.example.com/agent/watch-install.sh | bash -s -- https://panel.example.com TOKEN probe
#
# ایجنت لنگر (روی سرور بایند؛ توکن همان توکن ایجنت آن سرور در پنل):
#   curl -fsSL https://panel.example.com/agent/watch-install.sh | bash -s -- https://panel.example.com TOKEN bind
#
# گزینه‌های اضافه بعد از نقش می‌آیند، مثلا --insecure یا --iface eth0

set -euo pipefail

PANEL_URL="${1:-}"
TOKEN="${2:-}"
ROLE="${3:-}"
shift 3 2>/dev/null || true
EXTRA_ARGS="$*"

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
info()  { printf '\033[36m%s\033[0m\n' "$1"; }

if [ -z "$PANEL_URL" ] || [ -z "$TOKEN" ] || { [ "$ROLE" != "probe" ] && [ "$ROLE" != "bind" ]; }; then
  red "استفاده: bash -s -- <آدرس-پنل> <توکن> probe|bind [گزینه‌ها]"
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  red "این اسکریپت باید با کاربر روت اجرا شود."
  exit 1
fi

if [ "$ROLE" = "probe" ]; then
  SCRIPT_NAME="iran-probe.py"
  SERVICE="pasargad-probe"
  DESC="Pasargad Mizban iran-access probe"
else
  SCRIPT_NAME="bind-agent.py"
  SERVICE="pasargad-bind"
  DESC="Pasargad Mizban IP bind agent"
fi

AGENT_PATH="/usr/local/bin/$SCRIPT_NAME"
SERVICE_PATH="/etc/systemd/system/$SERVICE.service"

# ── پایتون: همان منطق ایجنت اصلی — ۲٫۷ هم کافی است ──────────────────────
find_python() {
  for candidate in python3 python2.7 python2 python; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info[:2] >= (2, 7) else 1)' 2>/dev/null; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

PY="$(find_python || true)"
if [ -z "$PY" ]; then
  red "پایتون ۲٫۷ به بالا پیدا نشد."
  exit 1
fi
info "پایتون: $PY"

if ! command -v systemctl >/dev/null 2>&1; then
  red "systemd روی این سیستم نیست."
  exit 1
fi

# ── دریافت ─────────────────────────────────────────────────────────────
CURL_OPTS="-fsSL"
case "$EXTRA_ARGS" in *--insecure*) CURL_OPTS="$CURL_OPTS -k" ;; esac

info "در حال دریافت $SCRIPT_NAME از $PANEL_URL …"
if ! curl $CURL_OPTS "$PANEL_URL/agent/$SCRIPT_NAME" -o "$AGENT_PATH.tmp"; then
  red "دریافت ناموفق بود."
  rm -f "$AGENT_PATH.tmp"
  exit 1
fi

if ! "$PY" -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$AGENT_PATH.tmp" 2>/dev/null; then
  red "فایل دریافتی پایتون معتبر نیست — احتمالاً صفحه خطا دریافت شده."
  rm -f "$AGENT_PATH.tmp"
  exit 1
fi

mv "$AGENT_PATH.tmp" "$AGENT_PATH"
chmod 755 "$AGENT_PATH"

# ── سرویس ──────────────────────────────────────────────────────────────
cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=$DESC
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$PY $AGENT_PATH --url $PANEL_URL --token $TOKEN $EXTRA_ARGS
Restart=always
RestartSec=20
User=root
Nice=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

chmod 600 "$SERVICE_PATH"   # توکن داخل فایل است

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
sleep 3

if systemctl is-active --quiet "$SERVICE"; then
  green "نصب شد و در حال اجراست: $SERVICE"
  echo "لاگ زنده: journalctl -u $SERVICE -f"
else
  red "سرویس بالا نیامد. لاگ:"
  journalctl -u "$SERVICE" -n 30 --no-pager
  exit 1
fi
