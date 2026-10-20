-- محدودیت سرعت و پشتیبان پیکربندی برای Cisco Nexus با SNMP (v3)
--
-- در SNMP راه استانداردی برای تنظیم QoS یا خواندن running-config نیست.
-- سیسکو یک راه دارد: CISCO-CONFIG-COPY-MIB. پنل با SNMP SET به سوییچ
-- می‌گوید فایلی را از سرور پنل بردارد و در running-config ادغام کند، یا
-- running-config را برای سرور پنل بفرستد. پس جهت اتصال برعکس است: سوییچ
-- به سرور پنل وصل می‌شود.
--
-- این MIB ستون پورت ندارد؛ سوییچ همیشه به پورت استاندارد وصل می‌شود:
--   sftp  پورت ۲۲ — sshd خود سرور پنل با کاربر محدود (chroot)، و پوشه‌ای
--         که با ورکر مشترک است. رمزنگاری‌شده؛ پیش‌فرض.
--   tftp  پورت UDP ۶۹ — سرور کوچک داخل ورکر. بی‌رمز؛ پیکربندی (با هش
--         گذرواژه‌ها) روی شبکه مدیریت باز منتقل می‌شود.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/049_switch_snmp_transfer.sql

BEGIN;

-- nxos | ios | iosxe — نحو فرمان‌های پیکربندی به آن بستگی دارد
ALTER TABLE switches ADD COLUMN IF NOT EXISTS os_family TEXT;
UPDATE switches SET os_family = 'nxos' WHERE protocol = 'nxapi' AND os_family IS NULL;

ALTER TABLE switches ADD COLUMN IF NOT EXISTS config_transfer TEXT NOT NULL DEFAULT 'none';
ALTER TABLE switches DROP CONSTRAINT IF EXISTS switches_config_transfer_chk;
ALTER TABLE switches ADD CONSTRAINT switches_config_transfer_chk
  CHECK (config_transfer IN ('none', 'sftp', 'tftp'));

INSERT INTO settings (key, value) VALUES
  ('switch_transfer_host', ''),   -- آی‌پی سرور پنل از دید سوییچ‌ها
  ('switch_sftp_user', ''),       -- کاربر محدود sshd سرور پنل
  ('switch_sftp_pass', ''),       -- گذرواژه همان کاربر؛ فقط‌نوشتنی
  ('switch_sftp_path', '/files')  -- مسیر پوشه مشترک از دید همان کاربر
ON CONFLICT (key) DO NOTHING;

COMMIT;
