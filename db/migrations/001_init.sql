-- ساختار اولیه پنل مانیتورینگ پاسارگاد میزبان
-- اجرا: docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/001_init.sql

BEGIN;

-- ============================================================
-- کاربران پنل
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- قالب scrypt به شکل salt:hash
  full_name     TEXT,
  phone         TEXT,                    -- شماره دریافت پیامک هشدار
  role          TEXT NOT NULL DEFAULT 'admin',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- سرورهای اختصاصی
-- ============================================================
CREATE TABLE IF NOT EXISTS servers (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,              -- نام نمایشی
  hostname          TEXT,
  main_ip           INET NOT NULL,              -- آی‌پی اصلی
  ssh_port          INT NOT NULL DEFAULT 22,    -- پورت بررسی سلامت TCP
  provider          TEXT,                       -- ارائه‌دهنده یا دیتاسنتر
  location          TEXT,                       -- شهر یا کشور
  os                TEXT,
  cpu_model         TEXT,
  cpu_cores         INT,
  ram_total_bytes   BIGINT,
  disk_total_bytes  BIGINT,
  port_mbps         INT DEFAULT 1000,           -- ظرفیت پورت شبکه به مگابیت
  traffic_quota_gb  BIGINT DEFAULT 0,           -- سهمیه ترافیک ماهانه، صفر یعنی نامحدود
  monthly_cost      BIGINT DEFAULT 0,           -- هزینه ماهانه به تومان
  customer          TEXT,                       -- مشتری اجاره‌کننده
  agent_token       TEXT NOT NULL UNIQUE,       -- توکن ایجنت
  agent_version     TEXT,
  net_iface         TEXT,                       -- رابطی که ایجنت ترافیکش را می‌شمارد
  status            TEXT NOT NULL DEFAULT 'unknown',  -- up | down | unknown | maintenance
  last_seen_at      TIMESTAMPTZ,                -- آخرین گزارش ایجنت
  boot_time         TIMESTAMPTZ,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS servers_status_idx ON servers (status) WHERE is_active;

-- ============================================================
-- نمونه خام متریک — هر ۱۰ ثانیه از هر ایجنت
-- نگهداری کوتاه است. گزارش‌ها از جدول‌های تجمیع می‌آیند نه از اینجا.
-- ============================================================
CREATE TABLE IF NOT EXISTS server_metrics (
  server_id        INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts               TIMESTAMPTZ NOT NULL,
  cpu_percent      REAL,
  ram_used_bytes   BIGINT,
  ram_total_bytes  BIGINT,
  swap_used_bytes  BIGINT,
  swap_total_bytes BIGINT,
  disk_used_bytes  BIGINT,
  disk_total_bytes BIGINT,
  load1            REAL,
  load5            REAL,
  load15           REAL,
  rx_bytes         BIGINT NOT NULL DEFAULT 0,   -- حجم دریافتی در همین بازه
  tx_bytes         BIGINT NOT NULL DEFAULT 0,   -- حجم ارسالی در همین بازه
  rx_bps           BIGINT NOT NULL DEFAULT 0,   -- سرعت لحظه‌ای دریافت، بیت بر ثانیه
  tx_bps           BIGINT NOT NULL DEFAULT 0,   -- سرعت لحظه‌ای ارسال، بیت بر ثانیه
  disk_read_bps    BIGINT DEFAULT 0,
  disk_write_bps   BIGINT DEFAULT 0,
  uptime_sec       BIGINT,
  process_count    INT,
  tcp_conn_count   INT,
  PRIMARY KEY (server_id, ts)
);

CREATE INDEX IF NOT EXISTS server_metrics_ts_idx ON server_metrics (ts);

-- ============================================================
-- تجمیع ساعتی — نمودار چندروزه و گزارش روزانه از اینجا می‌آید
-- ============================================================
CREATE TABLE IF NOT EXISTS server_metrics_hourly (
  server_id    INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  hour         TIMESTAMPTZ NOT NULL,          -- ابتدای ساعت
  cpu_avg      REAL,
  cpu_max      REAL,
  ram_pct_avg  REAL,
  ram_pct_max  REAL,
  disk_pct_max REAL,
  load_avg     REAL,
  rx_bytes     BIGINT NOT NULL DEFAULT 0,
  tx_bytes     BIGINT NOT NULL DEFAULT 0,
  rx_bps_max   BIGINT NOT NULL DEFAULT 0,
  tx_bps_max   BIGINT NOT NULL DEFAULT 0,
  rx_bps_avg   BIGINT NOT NULL DEFAULT 0,
  tx_bps_avg   BIGINT NOT NULL DEFAULT 0,
  samples      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, hour)
);

-- ============================================================
-- تجمیع روزانه — پایه گزارش ماهانه و سالانه. هرگز پاک نمی‌شود.
-- ============================================================
CREATE TABLE IF NOT EXISTS server_metrics_daily (
  server_id    INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  day          DATE NOT NULL,
  cpu_avg      REAL,
  cpu_max      REAL,
  ram_pct_avg  REAL,
  ram_pct_max  REAL,
  disk_pct_max REAL,
  load_avg     REAL,
  rx_bytes     BIGINT NOT NULL DEFAULT 0,
  tx_bytes     BIGINT NOT NULL DEFAULT 0,
  rx_bps_max   BIGINT NOT NULL DEFAULT 0,
  tx_bps_max   BIGINT NOT NULL DEFAULT 0,
  uptime_ratio REAL,                          -- درصد در دسترس بودن آن روز
  down_seconds INT NOT NULL DEFAULT 0,
  samples      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, day)
);

CREATE INDEX IF NOT EXISTS metrics_daily_day_idx ON server_metrics_daily (day);

-- ============================================================
-- بلوک‌های آی‌پی
-- ============================================================
CREATE TABLE IF NOT EXISTS ip_subnets (
  id         SERIAL PRIMARY KEY,
  cidr       CIDR NOT NULL UNIQUE,
  version    SMALLINT NOT NULL DEFAULT 4,
  gateway    INET,
  provider   TEXT,
  location   TEXT,
  label      TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- تک‌تک آی‌پی‌ها
-- ============================================================
CREATE TABLE IF NOT EXISTS ip_addresses (
  id           SERIAL PRIMARY KEY,
  ip           INET NOT NULL UNIQUE,
  version      SMALLINT NOT NULL DEFAULT 4,
  subnet_id    INT REFERENCES ip_subnets(id) ON DELETE SET NULL,
  server_id    INT REFERENCES servers(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'free',   -- free | assigned | reserved | blocked | abuse
  customer     TEXT,
  ptr          TEXT,                            -- رکورد معکوس
  mac          TEXT,
  is_monitored BOOLEAN NOT NULL DEFAULT FALSE,  -- پینگ دوره‌ای شود یا نه
  ping_ok      BOOLEAN,
  ping_ms      REAL,
  last_ping_at TIMESTAMPTZ,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ip_status_idx  ON ip_addresses (status);
CREATE INDEX IF NOT EXISTS ip_server_idx  ON ip_addresses (server_id);
CREATE INDEX IF NOT EXISTS ip_monitor_idx ON ip_addresses (is_monitored) WHERE is_monitored;

-- ============================================================
-- نتیجه بررسی سلامت سرور — پایه محاسبه آپ‌تایم
-- ============================================================
CREATE TABLE IF NOT EXISTS server_checks (
  id         BIGSERIAL PRIMARY KEY,
  server_id  INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok         BOOLEAN NOT NULL,
  method     TEXT NOT NULL,          -- agent | tcp | icmp
  latency_ms REAL,
  detail     TEXT
);

CREATE INDEX IF NOT EXISTS checks_server_ts_idx ON server_checks (server_id, ts DESC);
-- برای پاک‌سازی و تجمیع روزانه که فقط با ts فیلتر می‌کنند
CREATE INDEX IF NOT EXISTS checks_ts_idx ON server_checks (ts);

-- ============================================================
-- قوانین هشدار. اگر server_id خالی باشد یعنی روی همه سرورها.
-- ============================================================
CREATE TABLE IF NOT EXISTS alert_rules (
  id           SERIAL PRIMARY KEY,
  server_id    INT REFERENCES servers(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,            -- down | cpu | ram | disk | traffic | load
  threshold    REAL NOT NULL DEFAULT 0,  -- درصد یا مقدار
  duration_sec INT NOT NULL DEFAULT 300, -- چند ثانیه پیوسته از آستانه رد شود
  send_sms     BOOLEAN NOT NULL DEFAULT TRUE,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- رویدادهای قطعی و هشدار
-- ============================================================
CREATE TABLE IF NOT EXISTS incidents (
  id          SERIAL PRIMARY KEY,
  server_id   INT REFERENCES servers(id) ON DELETE CASCADE,
  ip_id       INT REFERENCES ip_addresses(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                    -- down | agent_lost | cpu | ram | disk | traffic | ip_down
  severity    TEXT NOT NULL DEFAULT 'critical', -- critical | warning
  message     TEXT NOT NULL,
  value       REAL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ,
  ack_at      TIMESTAMPTZ,
  ack_by      INT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS incidents_open_idx ON incidents (server_id, kind) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS incidents_started_idx ON incidents (started_at DESC);

-- ============================================================
-- لاگ پیامک‌های ارسالی
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  incident_id INT REFERENCES incidents(id) ON DELETE SET NULL,
  channel     TEXT NOT NULL DEFAULT 'sms',
  recipient   TEXT NOT NULL,
  body        TEXT NOT NULL,
  ok          BOOLEAN NOT NULL,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (created_at DESC);

-- ============================================================
-- تنظیمات زمان اجرا — تغییرشان نیاز به بیلد ندارد
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
  ('sms_enabled',        'true'),
  ('sms_recipients',     ''),        -- شماره‌ها با کاما جدا می‌شوند
  ('alert_repeat_min',   '60'),      -- فاصله تکرار پیامک تا وقتی مشکل باز است
  ('down_after_sec',     '120'),     -- بعد از چند ثانیه بی‌خبری، سرور داون حساب شود
  ('raw_retention_days', '7'),       -- نگهداری نمونه‌های خام
  ('check_interval_sec', '30'),
  ('traffic_calendar',   'jalali'),  -- jalali یا gregorian — مبنای دوره ماهانه
  ('panel_title',        'پاسارگاد میزبان')
ON CONFLICT (key) DO NOTHING;

-- قوانین پیش‌فرض هشدار برای همه سرورها
INSERT INTO alert_rules (server_id, kind, threshold, duration_sec, send_sms)
SELECT NULL, k, t, d, TRUE
FROM (VALUES
  ('down', 0::REAL, 120),
  ('cpu', 90::REAL, 600),
  ('ram', 92::REAL, 600),
  ('disk', 90::REAL, 900),
  ('traffic', 90::REAL, 0)
) AS v(k, t, d)
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE server_id IS NULL AND kind = v.k);

COMMIT;
