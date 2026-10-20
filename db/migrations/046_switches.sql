-- سوییچ‌های شبکه (Cisco Nexus) — پایش پورت‌ها، منابع خود سوییچ، و shut/no shut
--
-- ── چرا NX-API و نه SNMP ───────────────────────────────────
--
-- SNMP فقط خواندن را خوب انجام می‌دهد. shut کردن پورت با SNMP یعنی
-- کامیونیتی نوشتنی روی سوییچ — رازی که در هر بسته UDP بی‌رمز می‌رود و
-- روی سوییچ هم ردی از اینکه چه کسی چه کرد نمی‌گذارد. NX-API روی HTTPS
-- است، با کاربر واقعی سوییچ احراز می‌شود و هر فرمانش در accounting
-- خود سوییچ ثبت می‌شود. یک پروتکل برای خواندن و نوشتن.
--
-- ── چرا شمارنده آخر روی خود پورت ذخیره می‌شود ──────────────
--
-- ایجنت سرور دلتا را در حافظه نگه می‌دارد و با ری‌استارتش آن بازه گم
-- می‌شود. شمارنده سوییچ ولی پایدار است؛ اگر آخرین مقدارش در دیتابیس
-- باشد، ری‌استارت ورکر هیچ بایتی را گم نمی‌کند — دلتای بعدی کل فاصله را
-- می‌پوشاند.
--
-- ── چرا جهت‌ها از دید سوییچ نام‌گذاری شده‌اند ──────────────
--
-- in یعنی ورودی به سوییچ از سمت دستگاه متصل، out یعنی خروجی سوییچ به
-- سمت آن. برای پورتی که به سرور وصل است، in همان آپلود سرور است و out
-- دانلودش. این برگردان فقط یک جا انجام می‌شود (ورکر، هنگام تبدیل به
-- مصرف سرور)؛ اگر جدول‌ها از دید سرور نام‌گذاری می‌شدند، پورت آپلینک
-- که به هیچ سروری وصل نیست معنای برعکس پیدا می‌کرد.
--
-- ── چرا shut/no shut صف دارد ───────────────────────────────
--
-- همان قاعده ویژالیزور: عملیاتی که روی دستگاه واقعی می‌نویسد فقط یک
-- پیاده‌سازی دارد و آن در ورکر است. پنل فقط درخواست می‌گذارد. ردیف
-- درخواست همان تاریخچه است: چه کسی، کی، کدام پورت، چرا، و نتیجه.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/046_switches.sql

BEGIN;

-- ── سوییچ ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS switches (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  -- آدرس NX-API، مثلا https://10.0.0.5 یا https://10.0.0.5:8443
  url             TEXT NOT NULL,
  username        TEXT NOT NULL,
  -- مثل کلید ویژالیزور: نوشتنی از پنل، هرگز خواندنی
  password        TEXT NOT NULL,
  -- گواهی NX-API پیش‌فرض خودامضاست؛ بدون این، اولین اتصال شکست می‌خورد
  insecure_tls    BOOLEAN NOT NULL DEFAULT TRUE,
  datacenter_id   INT REFERENCES datacenters(id) ON DELETE SET NULL,
  location        TEXT,
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,

  -- از خود سوییچ خوانده می‌شوند
  hostname        TEXT,
  model           TEXT,
  serial          TEXT,
  os_version      TEXT,
  uptime_sec      BIGINT,

  -- وضعیت آخرین خواندن
  status          TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (status IN ('up', 'down', 'unknown')),
  last_seen_at    TIMESTAMPTZ,
  last_poll_at    TIMESTAMPTZ,
  last_poll_ms    INT,
  last_error      TEXT,
  -- چند خواندن پشت‌سرهم شکست خورده؛ یک شکست تنها قطعی اعلام نمی‌شود
  fail_streak     INT NOT NULL DEFAULT 0,

  cpu_percent     REAL,
  mem_used_bytes  BIGINT,
  mem_total_bytes BIGINT,
  load1           REAL,
  max_temp_c      REAL,
  -- دما، فن و منبع تغذیه به شکل خوانده‌شده؛ ساختارش بین نسخه‌های
  -- NX-OS فرق می‌کند، پس ستون جدا برایش ساخته نمی‌شود
  env             JSONB,
  env_ok          BOOLEAN,
  env_checked_at  TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── پورت ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS switch_ports (
  id              SERIAL PRIMARY KEY,
  switch_id       INT NOT NULL REFERENCES switches(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                  -- Ethernet1/1، port-channel10، mgmt0
  kind            TEXT NOT NULL DEFAULT 'ethernet'
                  CHECK (kind IN ('ethernet', 'port-channel', 'mgmt', 'vlan', 'loopback', 'other')),
  description     TEXT,
  admin_up        BOOLEAN,
  oper_up         BOOLEAN,
  -- علت قطعی از دید سوییچ: «Link not connected»، «err-disabled» و…
  oper_reason     TEXT,
  speed_mbps      INT,
  mtu             INT,
  mode            TEXT,                           -- access | trunk | routed
  vlan            TEXT,                           -- شماره ویلن دسترسی، یا trunk/routed
  mac             TEXT,
  -- پورت‌چنلی که این پورت عضو آن است
  member_of       TEXT,
  hw_type         TEXT,
  xcvr_type       TEXT,
  last_flap       TEXT,

  -- آخرین شمارنده خام. پایه دلتای خواندن بعدی.
  in_bytes        BIGINT,
  out_bytes       BIGINT,
  in_errors       BIGINT,
  out_errors      BIGINT,
  in_discards     BIGINT,
  out_discards    BIGINT,
  crc_errors      BIGINT,
  counters_at     TIMESTAMPTZ,

  -- سرعت در آخرین بازه، بیت بر ثانیه
  in_bps          BIGINT NOT NULL DEFAULT 0,
  out_bps         BIGINT NOT NULL DEFAULT 0,

  -- توان نوری و دمای ماژول. هر چند دقیقه یک بار خوانده می‌شود.
  transceiver     JSONB,

  -- ── تنظیمات سمت پنل ──
  server_id       INT REFERENCES servers(id) ON DELETE SET NULL,
  -- مصرف این پورت مبنای ترافیک سرور باشد، به‌جای عدد ایجنت
  count_traffic   BOOLEAN NOT NULL DEFAULT FALSE,
  -- از کی شمرده می‌شود. ساعت‌های پیش از این از ایجنت می‌مانند.
  count_since     TIMESTAMPTZ,
  -- پورت محافظت‌شده (آپلینک، مدیریت) از پنل shut نمی‌شود
  is_protected    BOOLEAN NOT NULL DEFAULT FALSE,
  -- قطع لینک این پورت رویداد و پیامک بسازد
  alert_down      BOOLEAN NOT NULL DEFAULT FALSE,
  note            TEXT,

  -- در آخرین خواندن بود یا نه. پورتی که از سوییچ حذف شده (پورت‌چنل
  -- پاک‌شده، بریک‌اوت عوض‌شده) پاک نمی‌شود تا تاریخچه‌اش بماند.
  is_present      BOOLEAN NOT NULL DEFAULT TRUE,
  last_change_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- «شمردن ترافیک بدون سرور» عمدا CHECK ندارد: با حذف سرور، server_id
  -- خودکار تهی می‌شود و چنین CHECKی حذف خود سرور را می‌شکست. ورکر پورت
  -- بی‌سرور را هرگز نمی‌شمارد.
  UNIQUE (switch_id, name)
);

CREATE INDEX IF NOT EXISTS switch_ports_server_idx ON switch_ports (server_id) WHERE server_id IS NOT NULL;

-- ── نمونه خام منابع سوییچ ──────────────────────────────────
CREATE TABLE IF NOT EXISTS switch_metrics (
  switch_id       INT NOT NULL REFERENCES switches(id) ON DELETE CASCADE,
  ts              TIMESTAMPTZ NOT NULL,
  cpu_percent     REAL,
  mem_used_bytes  BIGINT,
  mem_total_bytes BIGINT,
  load1           REAL,
  max_temp_c      REAL,
  PRIMARY KEY (switch_id, ts)
);

CREATE INDEX IF NOT EXISTS switch_metrics_ts_idx ON switch_metrics (ts);

CREATE TABLE IF NOT EXISTS switch_metrics_hourly (
  switch_id    INT NOT NULL REFERENCES switches(id) ON DELETE CASCADE,
  hour         TIMESTAMPTZ NOT NULL,
  cpu_avg      REAL,
  cpu_max      REAL,
  mem_pct_avg  REAL,
  mem_pct_max  REAL,
  temp_max     REAL,
  samples      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (switch_id, hour)
);

-- ── نمونه خام پورت ─────────────────────────────────────────
-- حجم و سرعت در همان بازه، نه شمارنده تجمعی
CREATE TABLE IF NOT EXISTS switch_port_metrics (
  port_id   INT NOT NULL REFERENCES switch_ports(id) ON DELETE CASCADE,
  ts        TIMESTAMPTZ NOT NULL,
  in_bytes  BIGINT NOT NULL DEFAULT 0,
  out_bytes BIGINT NOT NULL DEFAULT 0,
  in_bps    BIGINT NOT NULL DEFAULT 0,
  out_bps   BIGINT NOT NULL DEFAULT 0,
  errors    BIGINT NOT NULL DEFAULT 0,
  discards  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (port_id, ts)
);

CREATE INDEX IF NOT EXISTS switch_port_metrics_ts_idx ON switch_port_metrics (ts);

CREATE TABLE IF NOT EXISTS switch_port_hourly (
  port_id     INT NOT NULL REFERENCES switch_ports(id) ON DELETE CASCADE,
  hour        TIMESTAMPTZ NOT NULL,
  in_bytes    BIGINT NOT NULL DEFAULT 0,
  out_bytes   BIGINT NOT NULL DEFAULT 0,
  in_bps_max  BIGINT NOT NULL DEFAULT 0,
  out_bps_max BIGINT NOT NULL DEFAULT 0,
  in_bps_avg  BIGINT NOT NULL DEFAULT 0,
  out_bps_avg BIGINT NOT NULL DEFAULT 0,
  errors      BIGINT NOT NULL DEFAULT 0,
  discards    BIGINT NOT NULL DEFAULT 0,
  samples     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (port_id, hour)
);

-- مثل server_metrics_daily هرگز پاک نمی‌شود
CREATE TABLE IF NOT EXISTS switch_port_daily (
  port_id     INT NOT NULL REFERENCES switch_ports(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  in_bytes    BIGINT NOT NULL DEFAULT 0,
  out_bytes   BIGINT NOT NULL DEFAULT 0,
  in_bps_max  BIGINT NOT NULL DEFAULT 0,
  out_bps_max BIGINT NOT NULL DEFAULT 0,
  errors      BIGINT NOT NULL DEFAULT 0,
  discards    BIGINT NOT NULL DEFAULT 0,
  samples     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (port_id, day)
);

CREATE INDEX IF NOT EXISTS switch_port_daily_day_idx ON switch_port_daily (day);

-- ── صف و تاریخچه shut/no shut ──────────────────────────────
CREATE TABLE IF NOT EXISTS switch_actions (
  id                SERIAL PRIMARY KEY,
  switch_id         INT NOT NULL REFERENCES switches(id) ON DELETE CASCADE,
  port_id           INT REFERENCES switch_ports(id) ON DELETE SET NULL,
  -- رونوشت؛ ردیف پورت ممکن است بعدا نباشد ولی تاریخچه باید خوانا بماند
  port_name         TEXT NOT NULL,
  action            TEXT NOT NULL CHECK (action IN ('shutdown', 'no_shutdown')),
  -- copy running-config startup-config پس از تغییر
  save_config       BOOLEAN NOT NULL DEFAULT FALSE,
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  requested_by      INT REFERENCES users(id) ON DELETE SET NULL,
  requested_by_name TEXT,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  result            TEXT
);

CREATE INDEX IF NOT EXISTS switch_actions_pending_idx ON switch_actions (requested_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS switch_actions_switch_idx ON switch_actions (switch_id, requested_at DESC);
-- دو درخواست همزمان روی یک پورت (دو ادمین، یا دوبار کلیک) نتیجه
-- نامعلوم می‌سازد؛ تا اولی تمام نشده دومی پذیرفته نمی‌شود
CREATE UNIQUE INDEX IF NOT EXISTS switch_actions_one_open
  ON switch_actions (port_id) WHERE status IN ('pending', 'running');

-- ── رویدادها ───────────────────────────────────────────────
-- بدون این دو ستون، «قطعی سوییچ» دو سوییچ مختلف یک رویداد باز مشترک
-- می‌شدند، چون کلید یکتایی رویداد باز «نوع + سرور + آی‌پی» است.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS switch_id INT REFERENCES switches(id) ON DELETE CASCADE;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS switch_port_id INT REFERENCES switch_ports(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS incidents_switch_idx ON incidents (switch_id) WHERE switch_id IS NOT NULL;

INSERT INTO settings (key, value) VALUES
  ('switch_poll_sec', '30'),        -- فاصله خواندن هر سوییچ
  ('switch_cpu_threshold', '90')    -- میانگین پنج‌دقیقه‌ای پردازنده سوییچ
ON CONFLICT (key) DO NOTHING;

COMMIT;
