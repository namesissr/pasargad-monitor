#!/usr/bin/env bash
# راه‌اندازی اولیه پنل روی سرور اوبونتو.
#
# اجرا:  bash scripts/setup.sh panel.example.com

set -euo pipefail

DOMAIN="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
info()  { printf '\033[36m%s\033[0m\n' "$1"; }

cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  red "داکر نصب نیست. اول داکر و افزونه compose را نصب کنید."
  exit 1
fi

# ── فایل .env ────────────────────────────────────────────────
if [ ! -f .env ]; then
  info "ساخت فایل .env …"
  cp .env.example .env

  SECRET="$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48)"
  DBPASS="$(openssl rand -base64 24 | tr -d '\n=+/' | cut -c1-24)"
  ADMINPASS="$(openssl rand -base64 18 | tr -d '\n=+/' | cut -c1-16)"

  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$SECRET|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$DBPASS|" .env
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$ADMINPASS|" .env

  green "فایل .env ساخته شد."
  echo
  echo "  نام کاربری: admin"
  echo "  گذرواژه:    $ADMINPASS"
  echo
  red "این گذرواژه را همین حالا جایی ذخیره کنید. بعداً نمایش داده نمی‌شود."
  echo
else
  info "فایل .env از قبل وجود دارد؛ دست‌نخورده ماند."
fi

# ── گواهی ────────────────────────────────────────────────────
if [ ! -f nginx/certs/fullchain.pem ]; then
  info "گواهی موقت خودامضا ساخته می‌شود…"
  bash scripts/selfsigned-cert.sh "${DOMAIN:-panel.local}"
fi

# ── بالا آوردن سرویس‌ها ──────────────────────────────────────
info "در حال بیلد و اجرا… (بار اول چند دقیقه طول می‌کشد)"
docker compose build
docker compose up -d

echo
info "وضعیت سرویس‌ها:"
docker compose ps

echo
green "پنل بالا آمد."
[ -n "$DOMAIN" ] && echo "آدرس: https://$DOMAIN" || echo "آدرس: https://<آی‌پی-سرور>"
echo
echo "لاگ ورکر:  docker compose logs worker -f"
echo "لاگ وب:    docker compose logs web --tail 60"
