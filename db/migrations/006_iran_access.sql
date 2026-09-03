-- پایش «ایران اکسس» — تشخیص اینکه کدام آی‌پی از سمت زیرساخت بسته شده و کی آزاد می‌شود
--
-- جهت فیلترینگ مهم است و برعکس شهود اولیه است:
--   آی‌پی اکسس‌شده از داخل ایران پینگ می‌دهد ولی از خارج نه.
--   پس تشخیص آزادشدن فقط از یک دیدبان «خارج از ایران» ممکن است، و دیدبان
--   «داخل ایران» فقط برای اثبات زنده‌بودن آی‌پی است (تا آی‌پی خاموش با
--   آی‌پی اکسس‌شده قاطی نشود).
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/006_iran_access.sql

BEGIN;

-- ============================================================
-- دیدبان‌ها — نقطه‌های آزمایش پینگ، داخل یا خارج ایران
-- ============================================================
CREATE TABLE IF NOT EXISTS probes (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  location     TEXT NOT NULL,            -- inside | outside
  token        TEXT NOT NULL UNIQUE,
  last_seen_at TIMESTAMPTZ,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT probes_location_chk CHECK (location IN ('inside', 'outside'))
);

-- ============================================================
-- وضعیت اکسس هر آی‌پی
-- ============================================================
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS access_watch        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS iran_access_status  TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS access_blocked_since TIMESTAMPTZ;
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS access_released_at   TIMESTAMPTZ;

-- سرور لنگر: آی‌پی بیکار خودش به پینگ جواب نمی‌دهد؛ به این سرور بایند
-- می‌شود تا زنده باشد و بشود وضعیتش را سنجید
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS bind_server_id INT REFERENCES servers(id) ON DELETE SET NULL;
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS bind_ok    BOOLEAN;
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS bind_at    TIMESTAMPTZ;
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS bind_error TEXT;

ALTER TABLE ip_addresses DROP CONSTRAINT IF EXISTS ip_iran_access_chk;
ALTER TABLE ip_addresses ADD CONSTRAINT ip_iran_access_chk
  CHECK (iran_access_status IN ('blocked', 'released', 'unknown'));

CREATE INDEX IF NOT EXISTS ip_access_watch_idx ON ip_addresses (access_watch) WHERE access_watch;

-- ============================================================
-- آخرین نتیجه هر دیدبان برای هر آی‌پی، با شمارش پیاپی
-- پادلرزش از همین شمارش‌ها می‌آید: یک افت پکت گذرا وضعیت را عوض نمی‌کند
-- ============================================================
CREATE TABLE IF NOT EXISTS ip_probe_state (
  ip_id       INT NOT NULL REFERENCES ip_addresses(id) ON DELETE CASCADE,
  probe_id    INT NOT NULL REFERENCES probes(id) ON DELETE CASCADE,
  ok          BOOLEAN,
  ms          REAL,
  ok_streak   INT NOT NULL DEFAULT 0,
  fail_streak INT NOT NULL DEFAULT 0,
  checked_at  TIMESTAMPTZ,
  PRIMARY KEY (ip_id, probe_id)
);

COMMIT;
