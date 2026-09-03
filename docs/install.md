# نصب قدم‌به‌قدم روی سرور

از سرور خالی اوبونتو تا پنل بالا و اولین سرور تحت پایش.

**زمان تقریبی:** ۲۰ تا ۳۰ دقیقه، که بیشترش صرف بیلد می‌شود.

---

## پیش‌نیازها

| چیز | مقدار |
|---|---|
| سرور | اوبونتو ۲۲ یا ۲۴، حداقل ۲ گیگ رم و ۲۰ گیگ دیسک |
| دسترسی | کاربر روت با SSH |
| دامنه | یک زیردامنه مثل `panel.example.com` که رکورد A آن به آی‌پی سرور اشاره کند |

پنل خودش سبک است. با ۵۰ سرور تحت پایش، ۲ گیگ رم کافی است.

> **دامنه هنوز آماده نیست؟** اشکالی ندارد. با گواهی خودامضا و آی‌پی هم بالا می‌آید؛
> بعداً دامنه و گواهی واقعی را اضافه می‌کنید.

---

## قدم ۰ — کد را پوش کنید

روی همان کامپیوتری که کد را دارید:

```bash
cd C:\pasargad-monitor
git push origin main
```

**این قدم را رد نکنید.** اگر کد جدید پوش نشده باشد، روی سرور نسخه قدیمی کلون می‌شود.

---

## قدم ۱ — ورود به سرور و به‌روزرسانی

```bash
ssh root@آی‌پی-سرور
```

```bash
apt-get update && apt-get upgrade -y
```

منطقه زمانی سرور را روی تهران بگذارید تا لاگ‌ها با ساعت خودتان بخواند:

```bash
timedatectl set-timezone Asia/Tehran
```

---

## قدم ۲ — نصب داکر

```bash
curl -fsSL https://get.docker.com | sh
```

بررسی نصب:

```bash
docker --version
docker compose version
```

هر دو باید عدد بدهند. اگر `docker compose version` خطا داد، افزونه کامپوز نصب نشده:

```bash
apt-get install -y docker-compose-plugin
```

> **دقت:** دستور درست `docker compose` است (با فاصله)، نه `docker-compose` قدیمی.

### اگر از داخل ایران نصب می‌کنید

اگر دریافت ایمیج‌ها گیر کرد، آینه رجیستری تنظیم کنید:

```bash
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://docker.arvancloud.ir"]
}
EOF
systemctl restart docker
```

---

## قدم ۳ — دیوار آتش

پنل فقط به سه پورت نیاز دارد:

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

**پورت ۵۴۳۲ را باز نکنید.** پستگرس در کامپوز فقط روی `127.0.0.1` باز است و نباید از اینترنت در دسترس باشد.

---

## قدم ۴ — گرفتن کد

### اگر مخزن عمومی است

```bash
cd /root
git clone https://github.com/namesissr/pasargad-monitor.git
cd pasargad-monitor
```

### اگر مخزن خصوصی است

**گیت‌هاب از اوت ۲۰۲۱ گذرواژه حساب را برای گیت قبول نمی‌کند.** اگر گذرواژه بزنید این خطا را می‌گیرید:

```
error: RPC failed; HTTP 401 curl 22 The requested URL returned error: 401
fatal: expected flush after ref listing
```

این یعنی «گذرواژه پذیرفته نیست»، نه «گذرواژه اشتباه است». دو راه دارید.

#### راه اول — کلید SSH استقراری (پیشنهادی)

برای سروری که مرتب `git pull` می‌زند بهترین گزینه است: فقط-خواندنی، محدود به همین یک مخزن، و منقضی نمی‌شود.

```bash
ssh-keygen -t ed25519 -C "pasargad-panel-server" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

خروجی را کپی کنید، بعد در گیت‌هاب:
صفحه مخزن ← **Settings** ← **Deploy keys** ← **Add deploy key** ← کلید را بچسبانید ←
**تیک Allow write access را نزنید** ← **Add key**

تست و کلون:

```bash
ssh -T git@github.com
```

اولین بار `yes` بزنید. جواب موفق: `Hi namesissr/pasargad-monitor! You've successfully authenticated,
but GitHub does not provide shell access.` — همین پیام یعنی درست شد.

```bash
cd /root
git clone git@github.com:namesissr/pasargad-monitor.git
cd pasargad-monitor
```

#### راه دوم — توکن دسترسی

گیت‌هاب ← آواتار ← **Settings** ← **Developer settings** ← **Personal access tokens** ←
**Tokens (classic)** ← **Generate new token (classic)** ← فقط تیک `repo` ← **Generate token**

توکن فقط یک بار نشان داده می‌شود؛ کپی‌اش کنید.

```bash
cd /root
git clone https://github.com/namesissr/pasargad-monitor.git
# Username: namesissr
# Password: توکن را بچسبانید، نه گذرواژه حساب
cd pasargad-monitor
```

تا هر بار نپرسد:

```bash
git config --global credential.helper store
```

> توکن را به‌شکل متن ساده در `~/.git-credentials` ذخیره می‌کند. روی سروری که فقط خودتان روت
> دارید قابل قبول است، ولی کلید SSH تمیزتر است.

### اگر گیت‌هاب از سرور در دسترس نیست

اگر سرور در ایران است ممکن است گیت‌هاب جواب ندهد.

**SSH روی پورت ۴۴۳،** وقتی پورت ۲۲ بسته است:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  Hostname ssh.github.com
  Port 443
EOF
```

**یا کد را مستقیم بفرستید** و اصلاً سراغ گیت‌هاب نروید. از ویندوز:

```bash
scp -r C:\pasargad-monitor root@آی‌پی-سرور:/root/pasargad-monitor
```

در این حالت `.env` نباید برود — روی سرور تازه بسازیدش (قدم بعد).

---

## قدم ۵ — تنظیمات

```bash
cp .env.example .env
```

سه مقدار تصادفی بسازید:

```bash
echo "SESSION_SECRET : $(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48)"
echo "POSTGRES_PASS  : $(openssl rand -base64 24 | tr -d '\n=+/' | cut -c1-24)"
echo "ADMIN_PASSWORD : $(openssl rand -base64 18 | tr -d '\n=+/' | cut -c1-16)"
```

خروجی را جایی ذخیره کنید، بعد فایل را باز کنید:

```bash
nano .env
```

این‌ها را پر کنید:

```ini
POSTGRES_PASSWORD=<مقدار POSTGRES_PASS>
SESSION_SECRET=<مقدار SESSION_SECRET>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<مقدار ADMIN_PASSWORD>
ADMIN_PHONE=09121234567
KAVENEGAR_API_KEY=<کلید کاوه‌نگار، فعلاً می‌تواند خالی بماند>
REPORT_TZ=Asia/Tehran
```

ذخیره با `Ctrl+O` سپس `Enter`، خروج با `Ctrl+X`.

**نکته‌های مهم:**

- `SESSION_SECRET` باید حداقل ۱۶ کاراکتر باشد وگرنه اپ بالا نمی‌آید. اگر بعداً عوضش کنید، همه نشست‌ها باطل می‌شوند.
- `ADMIN_PASSWORD` فقط بار اول و وقتی جدول کاربران خالی است استفاده می‌شود. بعد از اولین ورود می‌توانید خالی‌اش کنید.
- `KAVENEGAR_API_KEY` بدون مقدار یعنی هیچ پیامک هشداری ارسال نمی‌شود. بقیه پنل کار می‌کند.
- **`REPORT_TZ` را بعد از شروع جمع‌آوری داده عوض نکنید.** مرز روز در تجمیع با آن تعیین می‌شود و تغییرش گزارش‌های قبلی را ناهماهنگ می‌کند.

فایل `.env` نباید در گیت برود — از قبل در `.gitignore` هست.

---

## قدم ۶ — گواهی موقت

```bash
bash scripts/selfsigned-cert.sh panel.example.com
```

مرورگر برای این گواهی هشدار می‌دهد. طبیعی است؛ در قدم ۱۰ گواهی واقعی می‌گیریم.

---

## قدم ۷ — بیلد و اجرا

```bash
docker compose build
```

**بار اول چند دقیقه طول می‌کشد** — نکست باید پروژه را کامپایل کند. صبور باشید.

### اگر بیلد از داخل ایران گیر کرد

اگر روی `npm install` متوقف شد، آینه رجیستری npm اضافه کنید. در `Dockerfile` و `Dockerfile.worker`، درست قبل از خط `RUN if [ -f package-lock.json ]` این را بگذارید:

```dockerfile
RUN npm config set registry https://registry.npmmirror.com
```

بعد دوباره `docker compose build`.

### اجرا

```bash
docker compose up -d
docker compose ps
```

هر چهار سرویس باید بالا باشند: `postgres`، `web`، `worker`، `edge`.

---

## قدم ۸ — بررسی سلامت

```bash
docker compose exec web wget -qO- http://127.0.0.1:3000/api/health
```

جواب درست: `{"ok":true,"db":true}`

جدول‌ها ساخته شده‌اند؟

```bash
docker compose exec postgres psql -U pasargad -d pasargad_monitor -c "\dt"
```

باید حدود دوازده جدول ببینید: `servers`، `datacenters`، `ip_addresses`، `incidents` و بقیه.

> **مهاجرت‌ها فقط روی دیتابیس خالی و بار اول خودکار اجرا می‌شوند.** اگر جدول‌ها نبودند،
> یعنی والیوم از قبل وجود داشته. آن وقت دستی بزنید:
> ```bash
> for f in db/migrations/*.sql; do
>   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < "$f"
> done
> ```

کاربر مدیر ساخته شده؟

```bash
docker compose logs worker | grep "کاربر مدیر"
```

---

## قدم ۹ — اولین ورود

مرورگر را باز کنید:

```
https://panel.example.com
```

یا اگر دامنه هنوز آماده نیست، `https://آی‌پی-سرور`. هشدار گواهی را بپذیرید.

با `admin` و گذرواژه‌ای که در `.env` گذاشتید وارد شوید.

**اگر «نام کاربری یا گذرواژه درست نیست» گرفتید،** کاربر ساخته نشده. دستی بسازید:

```bash
docker compose exec worker node worker/create-user.mjs
```

---

## قدم ۱۰ — گواهی واقعی

فقط وقتی رکورد A دامنه به آی‌پی سرور اشاره می‌کند:

```bash
apt-get install -y certbot

certbot certonly --webroot -w /root/pasargad-monitor/nginx/acme \
  -d panel.example.com --agree-tos -m you@example.com --non-interactive

install -m 644 /etc/letsencrypt/live/panel.example.com/fullchain.pem \
  /root/pasargad-monitor/nginx/certs/fullchain.pem
install -m 600 /etc/letsencrypt/live/panel.example.com/privkey.pem \
  /root/pasargad-monitor/nginx/certs/privkey.pem

docker compose restart edge
```

تمدید خودکار:

```bash
cat > /etc/cron.d/pasargad-cert <<'EOF'
0 3 * * 1 root certbot renew --quiet --webroot -w /root/pasargad-monitor/nginx/acme && install -m 644 /etc/letsencrypt/live/panel.example.com/fullchain.pem /root/pasargad-monitor/nginx/certs/fullchain.pem && install -m 600 /etc/letsencrypt/live/panel.example.com/privkey.pem /root/pasargad-monitor/nginx/certs/privkey.pem && docker compose -f /root/pasargad-monitor/docker-compose.yml restart edge
EOF
```

دامنه را در فایل بالا با دامنه خودتان عوض کنید.

---

## قدم ۱۱ — اولین دیتاسنتر

در پنل: **دیتاسنترها ← افزودن دیتاسنتر**

نام و قیمت‌ها را وارد کنید. دو تنظیم که اگر اشتباه باشند عدد حسابداری با فاکتور نمی‌خواند:

- **کدام ترافیک محاسبه می‌شود** — مجموع دو جهت، یا فقط ارسالی. اختلافشان تا دو برابر است.
- **مبنای ترابایت** — ۱۰۰۰ یا ۱۰۲۴. اختلافشان حدود ده درصد است.

قرارداد دیتاسنتر را نگاه کنید، حدس نزنید.

---

## قدم ۱۲ — اولین سرور و نصب ایجنت

در پنل: **سرورها ← افزودن سرور**. نام، آی‌پی اصلی و دیتاسنتر را بدهید.

پنل یک دستور نصب می‌دهد. آن را **روی خود سرور اختصاصی** اجرا کنید (نه روی سرور پنل):

```bash
curl -fsSL https://panel.example.com/agent/install.sh | bash -s -- https://panel.example.com TOKEN
```

**اگر هنوز گواهی خودامضا دارید،** آخر دستور `--insecure` اضافه کنید.

**اگر آن سرور نود مجازی‌ساز است** (SolusVM یا Virtualizor با KVM)، اول رابط شبکه را بررسی کنید:

```bash
$(command -v python3 || command -v python2) /usr/local/bin/pasargad-agent.py --list-ifaces
```

اگر رابط انتخاب‌شده کارت فیزیکی نبود، نصب را با `--iface eth0` تکرار کنید. جزئیات در [hypervisor.md](hypervisor.md).

تا یک دقیقه بعد، آمار سرور در پنل ظاهر می‌شود.

بررسی روی سرور اختصاصی:

```bash
systemctl status pasargad-agent
journalctl -u pasargad-agent -f
```

---

## قدم ۱۳ — پیامک هشدار

کلید کاوه‌نگار را در `.env` بگذارید و سرویس‌ها را تازه کنید:

```bash
nano .env          # KAVENEGAR_API_KEY را پر کنید
docker compose up -d
```

بعد در پنل: **تنظیمات ← هشدار پیامکی** و یک پیامک آزمایشی بفرستید. اگر خطا داد، متن خطای کاوه‌نگار به فارسی نشان داده می‌شود.

---

## قدم ۱۴ — پشتیبان‌گیری

مهم‌ترین چیز جدول `server_metrics_daily` است: تاریخچه مصرف که دوباره ساخته نمی‌شود.

```bash
mkdir -p /root/backups
cat > /etc/cron.d/pasargad-backup <<'EOF'
30 2 * * * root cd /root/pasargad-monitor && docker compose exec -T postgres pg_dump -U pasargad pasargad_monitor | gzip > /root/backups/pm-$(date +\%F).sql.gz && find /root/backups -name 'pm-*.sql.gz' -mtime +30 -delete
EOF
```

یک بار دستی هم بگیرید تا مطمئن شوید کار می‌کند:

```bash
cd /root/pasargad-monitor
docker compose exec -T postgres pg_dump -U pasargad pasargad_monitor | gzip > /root/backups/test.sql.gz
ls -lh /root/backups/
```

---

## عیب‌یابی

### سرویس بالا نمی‌آید

```bash
docker compose ps
docker compose logs web --tail 60
docker compose logs worker --tail 60
docker compose logs postgres --tail 30
```

| پیام در لاگ | علت | راه‌حل |
|---|---|---|
| `SESSION_SECRET تنظیم نشده یا کوتاه‌تر از ۱۶ کاراکتر` | مقدارش خالی یا کوتاه است | مقدار بلندتری در `.env` بگذارید و `docker compose up -d` |
| `DATABASE_URL تنظیم نشده` | `POSTGRES_PASSWORD` خالی است | پرش کنید |
| `دیتابیس هنوز آماده نیست` در لاگ ورکر | طبیعی است، چند ثانیه اول | خودش وصل می‌شود |
| `password authentication failed` | گذرواژه `.env` با والیوم قدیمی نمی‌خواند | یا گذرواژه قبلی را برگردانید، یا والیوم را پاک کنید (**همه داده می‌رود**) |

### مرورگر ۵۰۲ می‌دهد

معمولاً یعنی `web` بالا نیست یا تازه بازسازی شده:

```bash
docker compose ps
docker compose restart edge
```

انجین‌ایکس نام سرویس را با `resolver` داخلی حل می‌کند، پس ۵۰۲ پس از بازسازی نباید ماندگار باشد.

### ایجنت آمار نمی‌فرستد

روی خود سرور اختصاصی:

```bash
journalctl -u pasargad-agent -n 50
```

| پیام | علت | راه‌حل |
|---|---|---|
| `توکن پذیرفته نشد` | توکن غلط یا سرور بایگانی شده | از پنل توکن تازه بگیرید و دوباره نصب کنید |
| `ارسال ناموفق` | سرور به پنل دسترسی ندارد | فایروال و DNS آن سرور را بررسی کنید |
| خطای گواهی | گواهی خودامضاست | نصب را با `--insecure` تکرار کنید |

### نود سنت‌اواس ۷: نصب پایتون با خطای ۴۰۴

سنت‌اواس ۷ در ژوئن ۲۰۲۴ به پایان پشتیبانی رسید و محتوایش از آینه‌ها حذف شد. هر
`yum install` با انبوهی از `HTTP Error 404` شکست می‌خورد.

**معمولاً لازم نیست کاری کنید.** ایجنت با پایتون ۲٫۷ هم کار می‌کند و سنت‌اواس ۷ آن را از قبل
دارد؛ اسکریپت نصب خودش تشخیص می‌دهد و سراغ `yum` نمی‌رود.

اگر باز هم پایتون ۳ خواستید، مخزن را به آرشیو ببرید:

```bash
mkdir -p /root/yum-backup && mv /etc/yum.repos.d/*.repo /root/yum-backup/

cat > /etc/yum.repos.d/CentOS-Vault.repo <<'EOF'
[base]
name=CentOS-7 Base (vault)
baseurl=https://vault.centos.org/7.9.2009/os/$basearch/
gpgcheck=0
enabled=1

[updates]
name=CentOS-7 Updates (vault)
baseurl=https://vault.centos.org/7.9.2009/updates/$basearch/
gpgcheck=0
enabled=1

[extras]
name=CentOS-7 Extras (vault)
baseurl=https://vault.centos.org/7.9.2009/extras/$basearch/
gpgcheck=0
enabled=1
EOF

yum clean all && yum makecache && yum install -y python3
```

> آدرس آرشیو حتماً `https` باشد. با `http` کد ۳۰۱ می‌گیرید و yum قدیمی تغییر مسیر را
> دنبال نمی‌کند. بررسی پیش از شروع — باید `200` بدهد:
> ```bash
> curl -sI https://vault.centos.org/7.9.2009/os/x86_64/repodata/repomd.xml | head -1
> ```

بازگرداندن مخزن‌های قبلی: `mv /root/yum-backup/*.repo /etc/yum.repos.d/`

### گزارش و حسابداری خالی است

تجمیع هر پنج دقیقه اجرا می‌شود. صبر کنید و لاگ ورکر را ببینید:

```bash
docker compose logs worker | grep -i "تجمیع\|پاک‌سازی"
```

---

## دستورهای روزمره

```bash
cd /root/pasargad-monitor

docker compose ps                       # وضعیت
docker compose logs worker -f           # لاگ زنده ورکر
docker compose restart edge             # بعد از بازسازی سرویس

# به‌روزرسانی کد
git pull
docker compose build
docker compose up -d

# مهاجرت تازه پس از به‌روزرسانی
docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/00X_name.sql

# ساخت یا تغییر گذرواژه کاربر
docker compose exec worker node worker/create-user.mjs
```

---

## بررسی امنیتی دوره‌ای

پستگرس نباید از اینترنت در دسترس باشد. از یک ماشین دیگر:

```bash
nc -z -w 5 آی‌پی-عمومی-سرور 5432 && echo "خطر: پستگرس باز است" || echo "امن"
```

نتیجه باید «امن» باشد.
