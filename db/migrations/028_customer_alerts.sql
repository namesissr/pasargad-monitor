-- هشدار سهمیه و موعد تمدید، و پروفایل کامل‌تر مشتری
--
-- سه هشدار:
--   • رسیدن به ۹۰٪ سهمیه ترافیک → پیامک به مشتری
--   • اتمام سهمیه → پیامک به مشتری و به ادمین
--   • رسیدن موعد تمدید → پیامک به مشتری و به ادمین
--
-- جدول customer_notices جلوی تکرار را می‌گیرد. بدون آن، چرخه هر نیم
-- ساعت یک بار همان پیامک را می‌فرستاد — و پیامکی که تکرار شود، خوانده
-- نمی‌شود.
--
-- کلید یکتایی «دوره» است نه زمان: برای سهمیه، ماه صورتحساب؛ برای تمدید،
-- خود تاریخ موعد. یعنی ماه بعد که سهمیه از نو شروع می‌شود، هشدار دوباره
-- می‌آید — که درست است.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/028_customer_alerts.sql

BEGIN;

-- پروفایل: نام و نام خانوادگی جدا. ستون name می‌ماند چون نام نمایشی است
-- و کد موجود از آن استفاده می‌کند؛ از روی این دو پر می‌شود.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_name  TEXT;

-- موعد تمدید سرور
ALTER TABLE servers ADD COLUMN IF NOT EXISTS renews_at DATE;
-- چند روز پیش از موعد هشدار برود. صفر یعنی فقط روز موعد.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS renew_notice_days INT NOT NULL DEFAULT 3;

CREATE TABLE IF NOT EXISTS customer_notices (
  id         SERIAL PRIMARY KEY,
  server_id  INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  -- ماه صورتحساب برای سهمیه، تاریخ موعد برای تمدید
  period_key TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail     TEXT,
  CHECK (kind IN ('quota_90', 'quota_100', 'renewal')),
  UNIQUE (server_id, kind, period_key)
);

CREATE INDEX IF NOT EXISTS customer_notices_recent ON customer_notices (sent_at DESC);

INSERT INTO settings (key, value) VALUES ('customer_alerts_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

COMMIT;
