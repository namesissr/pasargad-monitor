-- چند نود ویژالیزور به‌جای یکی
--
-- طراحی قبلی یک نود را از .env می‌خواند. با شش نود این کار نمی‌کند، پس
-- اطلاعات اتصال به دیتابیس می‌آید.
--
-- پیامد امنیتی که باید آگاهانه پذیرفته شود: کلید ای‌پی‌آی دیگر فقط در
-- .env نیست. جبرانش سه چیز است — ای‌پی‌آی هرگز کلید و رمز را برنمی‌گرداند
-- (فقط علامت «تنظیم شده»)، دسترسی پنل پشت نشست ادمین است، و پستگرس فقط
-- روی ۱۲۷.۰.۰.۱ گوش می‌دهد.
--
-- کشف خودکار: هر ساعت فهرست آی‌پی‌ها، مخزن‌ها، وی‌پی‌اس‌ها و کاربران هر
-- نود خوانده می‌شود. آی‌پی تخصیص‌یافته نام مشتری‌اش را می‌گیرد.
--
-- چرا همه کار ویژالیزور در ورکر است و نه در اپ وب: این عملیات روی پنل
-- واقعی می‌نویسد. دو پیاده‌سازی از یک عملیات مخرب، دیر یا زود از هم واگرا
-- می‌شوند. پنل فقط درخواست می‌گذارد و نتیجه را می‌خواند.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/015_vz_nodes.sql

BEGIN;

CREATE TABLE IF NOT EXISTS vz_nodes (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  api_key       TEXT NOT NULL,
  api_pass      TEXT NOT NULL,
  -- وی‌پی‌اس لنگر این نود. خالی یعنی روی این نود چیزی نوشته نشود و فقط
  -- کشف انجام شود — حالت امن پیش‌فرض.
  anchor_vpsid  TEXT,
  max_per_run   INT NOT NULL DEFAULT 200,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name)
);

ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS vz_node_id INT REFERENCES vz_nodes(id) ON DELETE SET NULL;
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS vz_hostname TEXT;
-- کشف خودکار پرش نکند روی چیزی که ادمین دستی نوشته
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS customer_manual BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ip_vz_node_idx ON ip_addresses (vz_node_id) WHERE vz_node_id IS NOT NULL;

ALTER TABLE ip_subnets ADD COLUMN IF NOT EXISTS vz_node_id INT REFERENCES vz_nodes(id) ON DELETE SET NULL;
ALTER TABLE ip_subnets ADD COLUMN IF NOT EXISTS vz_poolid TEXT;

ALTER TABLE vz_sync_runs ADD COLUMN IF NOT EXISTS node_id INT REFERENCES vz_nodes(id) ON DELETE CASCADE;
ALTER TABLE vz_sync_runs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'apply';
ALTER TABLE vz_sync_runs ADD COLUMN IF NOT EXISTS discovered INT NOT NULL DEFAULT 0;

-- صف درخواست از پنل. ورکر هر نیم دقیقه نگاه می‌کند.
CREATE TABLE IF NOT EXISTS vz_sync_queue (
  id           SERIAL PRIMARY KEY,
  node_id      INT REFERENCES vz_nodes(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  dry_run      BOOLEAN NOT NULL DEFAULT TRUE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  taken_at     TIMESTAMPTZ,
  CHECK (kind IN ('discover', 'apply'))
);

CREATE INDEX IF NOT EXISTS vz_queue_pending_idx ON vz_sync_queue (requested_at) WHERE taken_at IS NULL;

INSERT INTO settings (key, value) VALUES ('vz_discover_hours', '1')
ON CONFLICT (key) DO NOTHING;

-- کلیدهای تک‌نودی دیگر استفاده نمی‌شوند؛ جایشان در جدول vz_nodes است
DELETE FROM settings WHERE key IN ('vz_anchor_vpsid', 'vz_pool_id', 'vz_max_per_run');

COMMIT;
