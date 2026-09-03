-- منشأ هر ردیف تجمیع روزانه
--
-- وقتی ایجنت وسط ماه نصب می‌شود، روزهای قبلش داده ندارند و باید از منبع
-- دیگری وارد شوند: پنل دیتاسنتر یا vnstat خود نود. آن ردیف‌ها باید از
-- ردیف‌های ایجنت قابل تشخیص باشند، وگرنه کسی که ماه بعد گزارش را می‌بیند
-- نمی‌فهمد کدام عدد اندازه‌گیری شده و کدام دستی وارد شده.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/004_traffic_source.sql

BEGIN;

ALTER TABLE server_metrics_daily
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'agent';

-- agent  : از ایجنت، تجمیع خودکار
-- manual : دستی وارد شده (پنل دیتاسنتر یا فاکتور)
-- vnstat : از تاریخچه vnstat خود نود
ALTER TABLE server_metrics_daily
  DROP CONSTRAINT IF EXISTS metrics_daily_source_chk;
ALTER TABLE server_metrics_daily
  ADD CONSTRAINT metrics_daily_source_chk CHECK (source IN ('agent', 'manual', 'vnstat'));

-- یادداشت اختیاری برای ردیف‌های وارد شده: از کجا آمده، چه کسی وارد کرده
ALTER TABLE server_metrics_daily
  ADD COLUMN IF NOT EXISTS note TEXT;

COMMIT;
