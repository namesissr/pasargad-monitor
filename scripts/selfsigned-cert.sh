#!/usr/bin/env bash
# ساخت گواهی خودامضا برای راه‌اندازی اولیه.
#
# برای محیط واقعی از Let's Encrypt استفاده کنید (راهنما در docs/deploy.md).
# با گواهی خودامضا مرورگر هشدار می‌دهد و ایجنت‌ها باید با --insecure نصب شوند.

set -euo pipefail

DOMAIN="${1:-panel.local}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/nginx/certs"

mkdir -p "$DIR"

openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
  -keyout "$DIR/privkey.pem" \
  -out "$DIR/fullchain.pem" \
  -subj "/CN=$DOMAIN/O=Pasargad Mizban" \
  -addext "subjectAltName=DNS:$DOMAIN,DNS:localhost,IP:127.0.0.1"

chmod 600 "$DIR/privkey.pem"

echo "گواهی خودامضا برای $DOMAIN در $DIR ساخته شد."
echo "هشدار: ایجنت‌ها را با گزینه --insecure نصب کنید تا گواهی را بپذیرند."
