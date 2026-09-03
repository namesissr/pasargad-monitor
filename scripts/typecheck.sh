#!/bin/sh
# بررسی تایپ پیش از بیلد.
#
# چرا جدا از بیلد: «next build» اول کامپایل می‌کند و بعد تایپ را بررسی —
# یعنی خطای تایپ بعد از یک دقیقه‌ونیم معلوم می‌شود. این حدود بیست ثانیه
# طول می‌کشد و همان خطاها را می‌گیرد.
#
# «scripts/check-code.py» جای این را نمی‌گیرد: آن الگوهای شناخته‌شده را
# می‌گیرد، این خود کامپایلر است.
#
# اجرا:  sh scripts/typecheck.sh
set -e
cd "$(dirname "$0")/.."
docker run --rm -v "$PWD:/app" -w /app node:20-alpine   sh -c 'if [ ! -d node_modules ]; then npm ci --silent; fi; npx tsc --noEmit'
echo "تایپ‌ها سالم‌اند."
