#!/usr/bin/env bash
# کاربر SFTP محدود برای سوییچ‌های SNMP (محدودیت سرعت و پشتیبان پیکربندی).
#
# سوییچ با CISCO-CONFIG-COPY-MIB فایل را از این سرور برمی‌دارد یا به آن
# می‌فرستد. آن MIB پورت ندارد و سوییچ همیشه به پورت ۲۲ وصل می‌شود، پس از
# sshd خود سرور استفاده می‌شود — با کاربری که:
#   - فقط SFTP دارد (بدون شل، بدون تونل)
#   - در پوشه خودش زندانی است (chroot)
# پوشه نوشتنی همان است که در docker-compose به ورکر وصل است (SWITCH_SFTP_DIR).
#
# اجرا:   sudo bash scripts/setup-switch-sftp.sh [نام-کاربر]
# دوباره اجرا کردنش بی‌خطر است و گذرواژه تازه می‌سازد.

set -euo pipefail

USER_NAME="${1:-switchxfer}"
BASE="${SWITCH_SFTP_BASE:-/srv/pasargad-sftp}"
CONF=/etc/ssh/sshd_config
BEGIN='# >>> pasargad-switch-sftp'
END='# <<< pasargad-switch-sftp'

if [ "$(id -u)" -ne 0 ]; then
  echo "با sudo اجرا کنید" >&2
  exit 1
fi
if ! [[ "$USER_NAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "نام کاربر نامعتبر: $USER_NAME" >&2
  exit 1
fi

if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir / --shell /usr/sbin/nologin "$USER_NAME"
fi

# chroot: خود پوشه باید مال root و غیرقابل‌نوشتن برای بقیه باشد؛ فقط
# زیرپوشه files نوشتنی است
mkdir -p "$BASE/files"
chown root:root "$BASE"
chmod 755 "$BASE"
chown "$USER_NAME:$USER_NAME" "$BASE/files"
chmod 770 "$BASE/files"

PASS="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
echo "$USER_NAME:$PASS" | chpasswd

# Match در انتهای خود sshd_config، نه در sshd_config.d: Match در فایل
# Include شده در برخی نسخه‌های OpenSSH تا انتهای پیکربندی اصلی ادامه
# پیدا می‌کرد و بقیه تنظیمات را فقط برای این کاربر می‌کرد.
cp "$CONF" "$CONF.bak.pasargad"
sed -i "/^$BEGIN\$/,/^$END\$/d" "$CONF"
cat >>"$CONF" <<EOF
$BEGIN
Match User $USER_NAME
    ChrootDirectory $BASE
    ForceCommand internal-sftp -u 0002
    PasswordAuthentication yes
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
$END
EOF

if ! sshd -t; then
  echo "پیکربندی sshd خطا داد؛ نسخه قبلی برگردانده شد" >&2
  cp "$CONF.bak.pasargad" "$CONF"
  exit 1
fi
systemctl reload ssh 2>/dev/null || systemctl reload sshd

cat <<EOF

کاربر SFTP آماده است. در پنل، تنظیمات ← پایش ← «انتقال پیکربندی سوییچ با SNMP»:

  کاربر SFTP     $USER_NAME
  گذرواژه SFTP   $PASS
  مسیر پوشه      /files

و در .env:   SWITCH_SFTP_DIR=$BASE/files
سپس:         docker compose up -d worker

اگر فایروال دارید، پورت ۲۲ را برای آی‌پی مدیریت سوییچ‌ها باز کنید.
EOF
