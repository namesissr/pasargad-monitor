# راه‌اندازی روی سرور واقعی

## پیش‌نیاز

- اوبونتو ۲۲ یا ۲۴
- داکر و افزونه compose
- یک زیردامنه که به آی‌پی سرور اشاره کند، مثلا `panel.example.com`

```bash
curl -fsSL https://get.docker.com | sh
```

**بیلد از داخل ایران:** اگر `npm install` گیر کرد، آینه رجیستری بگذارید. در `Dockerfile` پیش از `npm ci` این خط را اضافه کنید:

```dockerfile
RUN npm config set registry https://registry.npmmirror.com
```

و برای خود داکر، در `/etc/docker/daemon.json` آینه ایمیج تنظیم کنید.

---

## گواهی Let's Encrypt

پس از بالا آمدن سرویس‌ها با گواهی موقت:

```bash
apt-get update && apt-get install -y certbot

# پوشه چالش را انجین‌ایکس روی /var/www/acme سرو می‌کند
certbot certonly --webroot -w /root/pasargad-monitor/nginx/acme \
  -d panel.example.com --agree-tos -m you@example.com --non-interactive

# کپی گواهی به جایی که کامپوز سوار می‌کند
install -m 644 /etc/letsencrypt/live/panel.example.com/fullchain.pem \
  /root/pasargad-monitor/nginx/certs/fullchain.pem
install -m 600 /etc/letsencrypt/live/panel.example.com/privkey.pem \
  /root/pasargad-monitor/nginx/certs/privkey.pem

docker compose restart edge
```

### تمدید خودکار

```bash
cat > /etc/cron.d/pasargad-cert <<'EOF'
0 3 * * 1 root certbot renew --quiet --webroot -w /root/pasargad-monitor/nginx/acme && install -m 644 /etc/letsencrypt/live/panel.example.com/fullchain.pem /root/pasargad-monitor/nginx/certs/fullchain.pem && install -m 600 /etc/letsencrypt/live/panel.example.com/privkey.pem /root/pasargad-monitor/nginx/certs/privkey.pem && docker compose -f /root/pasargad-monitor/docker-compose.yml restart edge
EOF
```

---

## دیوار آتش

پنل فقط به دو پورت نیاز دارد:

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

**پورت ۵۴۳۲ را باز نکنید.** پستگرس در کامپوز روی `127.0.0.1` بسته شده و نباید از بیرون در دسترس باشد.

بررسی دوره‌ای:

```bash
curl -s --max-time 5 telnet://<آی‌پی-عمومی>:5432 \
  && echo "خطر: پستگرس از اینترنت باز است" || echo "امن"
```

---

## پشتیبان‌گیری

مهم‌ترین چیز جدول `server_metrics_daily` است — تاریخچه مصرف که دوباره ساخته نمی‌شود.

```bash
cat > /etc/cron.d/pasargad-backup <<'EOF'
30 2 * * * root cd /root/pasargad-monitor && docker compose exec -T postgres pg_dump -U pasargad pasargad_monitor | gzip > /root/backups/pm-$(date +\%F).sql.gz && find /root/backups -name 'pm-*.sql.gz' -mtime +30 -delete
EOF
mkdir -p /root/backups
```

بازیابی:

```bash
gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U pasargad -d pasargad_monitor
```

---

## به‌روزرسانی

```bash
cd /root/pasargad-monitor
git pull
docker compose build
docker compose up -d
```

اگر مهاجرت تازه‌ای آمده، دستی اجرا کنید — مهاجرت‌ها فقط روی دیتابیس خالی و بار اول خودکارند:

```bash
docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/002_xxx.sql
```

**به‌روزرسانی ایجنت‌ها:** همان دستور نصب را دوباره روی سرور اجرا کنید؛ فایل جایگزین و سرویس ری‌استارت می‌شود.

---

## ظرفیت

با فاصله نمونه ۱۰ ثانیه:

| تعداد سرور | ردیف خام در روز | حجم تقریبی (نگهداری ۷ روز) |
|---|---|---|
| ۱۰ | ۸۶ هزار | حدود ۱۲۰ مگابایت |
| ۵۰ | ۴۳۰ هزار | حدود ۶۰۰ مگابایت |
| ۲۰۰ | ۱٫۷ میلیون | حدود ۲٫۴ گیگابایت |

جدول روزانه سالانه حدود ۳۶۵ ردیف به‌ازای هر سرور اضافه می‌کند — ناچیز.

اگر تعداد سرورها از صد گذشت:

- `AGENT_INTERVAL_SEC` را به ۱۵ یا ۲۰ ببرید
- `raw_retention_days` را به ۳ کم کنید
- `PG_POOL_MAX` را بالا ببرید
