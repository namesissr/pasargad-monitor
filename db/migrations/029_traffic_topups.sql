-- شارژ ترافیک
--
-- وقتی سهمیه مشتری تمام می‌شود، ترافیک تازه می‌خرد. این جدول هر شارژ را
-- ثبت می‌کند و سهمیه مؤثر همان دوره را بالا می‌برد.
--
-- شارژ به **دوره** بسته است نه دائمی: ماه بعد سهمیه پایه از نو شروع
-- می‌شود. اگر دائمی بود، شارژ یک ماه تا ابد به سهمیه اضافه می‌ماند و
-- صورتحساب با واقعیت نمی‌خواند.
--
-- period_key همان تاریخ شروع دوره صورتحساب است — دقیقا همان کلیدی که
-- هشدارهای سهمیه استفاده می‌کنند، تا این دو با هم بخوانند.
--
-- created_by نگه داشته می‌شود چون شارژ ترافیک یک تصمیم مالی است و باید
-- معلوم باشد چه کسی ثبتش کرده.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/029_traffic_topups.sql

BEGIN;

CREATE TABLE IF NOT EXISTS traffic_topups (
  id           SERIAL PRIMARY KEY,
  server_id    INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  -- مقدار شارژ به گیگابایت. منفی هم مجاز است، برای اصلاح اشتباه.
  gb           NUMERIC(12, 2) NOT NULL,
  -- دوره‌ای که این شارژ به آن اضافه می‌شود
  period_key   DATE NOT NULL,
  price_toman  BIGINT,
  note         TEXT,
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS topups_server_period ON traffic_topups (server_id, period_key);
CREATE INDEX IF NOT EXISTS topups_recent ON traffic_topups (created_at DESC);

COMMIT;
