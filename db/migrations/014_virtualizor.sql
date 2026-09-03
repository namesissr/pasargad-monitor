-- پیوند با ویژالیزور
--
-- سناریو: آی‌پی‌های اکسس‌شده آنقدر زیادند که افزودن دستی ممکن نیست. پس
-- آی‌پی‌های آزاد از پنل ویژالیزور خوانده می‌شوند، به یک وی‌پی‌اس لنگر
-- تخصیص می‌یابند تا زنده و قابل پینگ شوند، و هرکدام که از خارج جواب داد
-- دوباره از آن وی‌پی‌اس برداشته و به مخزن آزاد برمی‌گردد.
--
-- چرا تخصیص در ویژالیزور لازم است و «ip addr add» کافی نیست: ویژالیزور
-- برای هر وی‌پی‌اس قواعد ضدجعل می‌سازد که فقط آی‌پی‌های تخصیص‌یافته را
-- عبور می‌دهد. آدرسی که در پنل ویژالیزور تخصیص نیافته، هرچقدر هم روی
-- کارت شبکه بنشیند، بسته‌ای دریافت نمی‌کند.
--
-- vz_ipid شناسه داخلی ویژالیزور است و برای تشخیص تغییرات لازم است؛ خود
-- آدرس ممکن است حذف و دوباره ساخته شود.
--
-- managed_by_panel جلوی خطر اصلی را می‌گیرد: پنل فقط آدرسی را از وی‌پی‌اس
-- لنگر برمی‌دارد که خودش تخصیصش داده باشد. آدرسی که ادمین دستی روی آن
-- وی‌پی‌اس گذاشته هرگز دست نمی‌خورد.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/014_virtualizor.sql

BEGIN;

ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS vz_ipid TEXT;
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS vz_vpsid TEXT;
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS vz_synced_at TIMESTAMPTZ;
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS managed_by_panel BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ip_vz_ipid_idx ON ip_addresses (vz_ipid) WHERE vz_ipid IS NOT NULL;

-- گزارش هر اجرای همگام‌سازی. بدون این، تغییر روی پنل واقعی بدون رد
-- انجام می‌شود و اگر چیزی خراب شد نمی‌شود فهمید چه شد.
CREATE TABLE IF NOT EXISTS vz_sync_runs (
  id          SERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  dry_run     BOOLEAN NOT NULL,
  imported    INT NOT NULL DEFAULT 0,
  attached    INT NOT NULL DEFAULT 0,
  detached    INT NOT NULL DEFAULT 0,
  ok          BOOLEAN NOT NULL DEFAULT TRUE,
  detail      TEXT
);

INSERT INTO settings (key, value) VALUES
  ('vz_anchor_vpsid', ''),
  ('vz_pool_id', ''),
  ('vz_max_per_run', '200'),
  ('vz_auto_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

COMMIT;
