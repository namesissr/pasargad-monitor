-- سوییچ: همسایه‌ها و MAC، پیشنهاد اتصال، هشدارهای تازه، پشتیبان پیکربندی،
-- صدک ۹۵، و فرمان‌های تازه (توضیح پورت، محدودیت سرعت)
--
-- ── چرا MAC و ARP ──────────────────────────────────────────
--
-- با صدها پورت، اینکه کدام پورت مال کدام سرور است معمولا فقط در ذهن کسی
-- است که کابل را زده. ولی سوییچ می‌داند: MAC هر دستگاه روی کدام پورت
-- دیده شده، و جدول ARP (روی همین سوییچ یا روتر/سوییچ لایه‌سه دیگری که در
-- پنل هست) می‌گوید آن MAC کدام آی‌پی است. آی‌پی هم در پنل به سرور وصل
-- است. پس پنل می‌تواند پیشنهاد بدهد — ولی فقط پیشنهاد: اتصال پورت به
-- سرور روی سهمیه و حسابداری اثر دارد و باید آدمی تأییدش کند.
--
-- ARP جدا از پورت نگه داشته می‌شود چون اغلب روی سوییچ دیگری است: سوییچ
-- دسترسی MAC را می‌بیند و سوییچ هسته آی‌پی را.
--
-- ── چرا رویداد پورت جدول جدا دارد ──────────────────────────
--
-- «فلپ» یعنی چند بار قطع و وصل در چند دقیقه. last_change_at فقط آخرین
-- تغییر را دارد؛ برای شمردن، تاریخچه لازم است. همین تاریخچه در پنجره پورت
-- هم نشان داده می‌شود.
--
-- ── چرا تجمیع پنج‌دقیقه‌ای ─────────────────────────────────
--
-- دیتاسنترها پهنای باند را با صدک ۹۵ از نمونه‌های پنج‌دقیقه‌ای فاکتور
-- می‌کنند. نمونه خام فقط چند روز می‌ماند و میانگین ساعتی اوج‌ها را صاف
-- می‌کند و صدک را کمتر از واقع نشان می‌دهد.
--
-- ── چرا پیکربندی فقط وقتی عوض شده ذخیره می‌شود ─────────────
--
-- پیکربندی نکسوس ده‌ها کیلوبایت است و بیشتر روزها عوض نمی‌شود. نسخه
-- تکراری چیزی به تاریخچه اضافه نمی‌کند جز حجم. زمان آخرین بررسی جدا روی
-- خود سوییچ است.
--
-- پیکربندی رازها را هم دارد (هش گذرواژه، کامیونیتی SNMP، کلید تاکاکس)؛
-- مسیر API آن فقط مدیر است و رازها را پیش‌فرض می‌پوشاند.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/048_switch_insight.sql

BEGIN;

-- ── همسایه، MAC و پیشنهاد اتصال ────────────────────────────
ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS neighbors JSONB;
-- حداکثر ۵۰ مورد برای نمایش؛ تعداد کامل جدا
ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS macs JSONB;
ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS mac_count INT;
ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;
ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS suggested_server_id INT REFERENCES servers(id) ON DELETE SET NULL;
ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS suggest_reason TEXT;
-- پیشنهادی که ادمین رد کرده دوباره نیاید
ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS suggest_dismissed_server_id INT;

CREATE TABLE IF NOT EXISTS switch_arp (
  switch_id  INT NOT NULL REFERENCES switches(id) ON DELETE CASCADE,
  ip         INET NOT NULL,
  mac        TEXT NOT NULL,                 -- همیشه به شکل aa:bb:cc:dd:ee:ff
  interface  TEXT,
  seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (switch_id, ip)
);
CREATE INDEX IF NOT EXISTS switch_arp_mac_idx ON switch_arp (mac);

-- ── هشدارهای تازه ──────────────────────────────────────────
-- اشباع: میانگین پنج‌دقیقه از آستانه گذشت. پیش‌فرض برای پورت‌های
-- محافظت‌شده (آپلینک‌ها) روشن است، چون اشباع آپلینک یعنی همه کند شده‌اند.
ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS alert_util BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE switch_ports SET alert_util = TRUE WHERE is_protected AND kind <> 'mgmt' AND NOT alert_util;

-- برای تشخیص تغییرِ میان دو خواندن در SNMP (ifLastChange)
ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS last_change_ticks BIGINT;

CREATE TABLE IF NOT EXISTS switch_port_events (
  id       BIGSERIAL PRIMARY KEY,
  port_id  INT NOT NULL REFERENCES switch_ports(id) ON DELETE CASCADE,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- وضعیت پس از رویداد؛ تهی یعنی قطع و وصل کوتاهی که میان دو خواندن
  -- رخ داده و برگشته (فقط SNMP با ifLastChange می‌بیندش)
  oper_up  BOOLEAN,
  detail   TEXT
);
CREATE INDEX IF NOT EXISTS switch_port_events_port_idx ON switch_port_events (port_id, ts DESC);
CREATE INDEX IF NOT EXISTS switch_port_events_ts_idx ON switch_port_events (ts);

-- ── صدک ۹۵ ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS switch_port_5min (
  port_id  INT NOT NULL REFERENCES switch_ports(id) ON DELETE CASCADE,
  ts       TIMESTAMPTZ NOT NULL,           -- ابتدای بازه پنج‌دقیقه‌ای
  in_bps   BIGINT NOT NULL DEFAULT 0,
  out_bps  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (port_id, ts)
);
CREATE INDEX IF NOT EXISTS switch_port_5min_ts_idx ON switch_port_5min (ts);

-- ── محدودیت سرعت (NX-API) ──────────────────────────────────
-- آنچه پنل روی پورت گذاشته؛ وضعیت واقعی پس از هر فرمان از سوییچ خوانده می‌شود
ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS rate_limit_mbps INT;
ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS rate_limit_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE switch_ports ADD COLUMN IF NOT EXISTS rate_limit_out BOOLEAN NOT NULL DEFAULT FALSE;

-- ── پشتیبان پیکربندی ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS switch_configs (
  id         SERIAL PRIMARY KEY,
  switch_id  INT NOT NULL REFERENCES switches(id) ON DELETE CASCADE,
  taken_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  config     TEXT NOT NULL,
  sha256     TEXT NOT NULL,
  size_bytes INT NOT NULL,
  -- auto | manual | action
  trigger    TEXT NOT NULL DEFAULT 'auto',
  taken_by   TEXT
);
CREATE INDEX IF NOT EXISTS switch_configs_switch_idx ON switch_configs (switch_id, taken_at DESC);

ALTER TABLE switches ADD COLUMN IF NOT EXISTS config_checked_at TIMESTAMPTZ;
ALTER TABLE switches ADD COLUMN IF NOT EXISTS config_changed_at TIMESTAMPTZ;
ALTER TABLE switches ADD COLUMN IF NOT EXISTS config_error TEXT;

-- ── فرمان‌های تازه در صف ───────────────────────────────────
ALTER TABLE switch_actions ADD COLUMN IF NOT EXISTS value TEXT;
ALTER TABLE switch_actions ALTER COLUMN port_name DROP NOT NULL;
ALTER TABLE switch_actions DROP CONSTRAINT IF EXISTS switch_actions_action_check;
ALTER TABLE switch_actions DROP CONSTRAINT IF EXISTS switch_actions_action_chk;
ALTER TABLE switch_actions ADD CONSTRAINT switch_actions_action_chk
  CHECK (action IN ('shutdown', 'no_shutdown', 'description', 'rate_limit', 'backup'));
-- یک پشتیبان‌گیری باز در هر لحظه برای هر سوییچ
CREATE UNIQUE INDEX IF NOT EXISTS switch_actions_one_backup
  ON switch_actions (switch_id) WHERE action = 'backup' AND status IN ('pending', 'running');

INSERT INTO settings (key, value) VALUES
  ('switch_util_threshold', '90'),   -- درصد ظرفیت پورت، میانگین پنج دقیقه
  ('switch_err_threshold', '100'),   -- خطای ورودی+خروجی+CRC در پانزده دقیقه
  ('switch_flap_threshold', '5'),    -- تعداد قطع و وصل در پانزده دقیقه
  ('switch_backup_hours', '24'),     -- فاصله پشتیبان‌گیری خودکار پیکربندی
  ('switch_5min_days', '70')         -- نگهداری تجمیع پنج‌دقیقه‌ای (صدک ۹۵)
ON CONFLICT (key) DO NOTHING;

COMMIT;
