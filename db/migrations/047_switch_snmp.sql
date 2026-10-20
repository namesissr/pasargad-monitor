-- سوییچ با SNMP v2c و v3 — کنار NX-API، و برای هر برندی
--
-- ── چرا SNMP هم ────────────────────────────────────────────
--
-- NX-API فقط روی نکسوس سیسکو هست. SNMP روی تقریبا هر سوییچی هست —
-- میکروتیک، جونیپر، هوآوی، آریستا، و سیسکوهای قدیمی‌تر — و پورت‌ها و
-- شمارنده‌هایش در IF-MIB استاندارد است. پردازنده و سخت‌افزار برای هر
-- برند MIB خودش را دارد؛ ورکر هرکدام را که سوییچ جواب بدهد می‌خواند.
--
-- ── چرا نوشتن با SNMP اختیاری است ──────────────────────────
--
-- کامیونیتی v2c بی‌رمز در هر بسته می‌رود؛ کامیونیتی نوشتنی یعنی هرکس
-- بسته‌ای ببیند می‌تواند پورت خاموش کند. پس shut/no shut با SNMP فقط وقتی
-- فعال است که صریحا خواسته شود: در v2c با دادن کامیونیتی نوشتنی جدا، در
-- v3 با روشن کردن «اجازه نوشتن» برای همان کاربر. پیشنهاد برای نوشتن، v3
-- با authPriv است.
--
-- ── چرا شماره اینترفیس روی پورت ذخیره می‌شود ───────────────
--
-- SNMP پورت را با ifIndex می‌شناسد نه با نام. ولی ifIndex روی بعضی
-- سوییچ‌ها پس از ریبوت یا تعویض ماژول عوض می‌شود. پس کلید پورت همچنان
-- نام است، و ورکر پیش از هر SET دوباره می‌پرسد «این ifIndex هنوز همان
-- پورت است؟». خاموش کردن پورت اشتباه بدترین خطای ممکن این بخش است.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/047_switch_snmp.sql

BEGIN;

ALTER TABLE switches ADD COLUMN IF NOT EXISTS protocol TEXT NOT NULL DEFAULT 'nxapi';
ALTER TABLE switches DROP CONSTRAINT IF EXISTS switches_protocol_chk;
ALTER TABLE switches ADD CONSTRAINT switches_protocol_chk CHECK (protocol IN ('nxapi', 'snmp'));

-- برای سوییچ SNMP این‌ها خالی‌اند
ALTER TABLE switches ALTER COLUMN url DROP NOT NULL;
ALTER TABLE switches ALTER COLUMN username DROP NOT NULL;
ALTER TABLE switches ALTER COLUMN password DROP NOT NULL;

ALTER TABLE switches ADD COLUMN IF NOT EXISTS snmp_version TEXT;
ALTER TABLE switches DROP CONSTRAINT IF EXISTS switches_snmp_version_chk;
ALTER TABLE switches ADD CONSTRAINT switches_snmp_version_chk
  CHECK (snmp_version IS NULL OR snmp_version IN ('2c', '3'));

ALTER TABLE switches ADD COLUMN IF NOT EXISTS snmp_host TEXT;
ALTER TABLE switches ADD COLUMN IF NOT EXISTS snmp_port INT NOT NULL DEFAULT 161;

-- v2c. مثل گذرواژه NX-API نوشتنی‌اند و هرگز به پنل برنمی‌گردند.
ALTER TABLE switches ADD COLUMN IF NOT EXISTS snmp_community TEXT;
-- خالی یعنی سوییچ v2c از پنل خاموش و روشن نمی‌شود
ALTER TABLE switches ADD COLUMN IF NOT EXISTS snmp_write_community TEXT;

-- v3
ALTER TABLE switches ADD COLUMN IF NOT EXISTS snmp_user TEXT;
ALTER TABLE switches ADD COLUMN IF NOT EXISTS snmp_auth_proto TEXT NOT NULL DEFAULT 'sha';
ALTER TABLE switches DROP CONSTRAINT IF EXISTS switches_snmp_auth_chk;
ALTER TABLE switches ADD CONSTRAINT switches_snmp_auth_chk
  CHECK (snmp_auth_proto IN ('none', 'md5', 'sha', 'sha224', 'sha256', 'sha384', 'sha512'));
ALTER TABLE switches ADD COLUMN IF NOT EXISTS snmp_auth_pass TEXT;
ALTER TABLE switches ADD COLUMN IF NOT EXISTS snmp_priv_proto TEXT NOT NULL DEFAULT 'aes';
ALTER TABLE switches DROP CONSTRAINT IF EXISTS switches_snmp_priv_chk;
-- aes256b و aes256r دو پیاده‌سازی ناهمسان AES-256 در SNMPv3اند (Blumenthal
-- برای سیسکو، Reeder برای بقیه)؛ استاندارد واحدی ندارد
ALTER TABLE switches ADD CONSTRAINT switches_snmp_priv_chk
  CHECK (snmp_priv_proto IN ('none', 'des', 'aes', 'aes256b', 'aes256r'));
ALTER TABLE switches ADD COLUMN IF NOT EXISTS snmp_priv_pass TEXT;
-- v3: همان کاربر اجازه SET دارد و پنل از آن استفاده کند
ALTER TABLE switches ADD COLUMN IF NOT EXISTS snmp_write BOOLEAN NOT NULL DEFAULT FALSE;

-- از sysObjectID: cisco، juniper، mikrotik، huawei و…
ALTER TABLE switches ADD COLUMN IF NOT EXISTS vendor TEXT;
ALTER TABLE switches ADD COLUMN IF NOT EXISTS sys_object_id TEXT;

ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS if_index INT;

COMMIT;
