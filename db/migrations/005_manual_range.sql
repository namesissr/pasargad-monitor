-- منشأ تازه: مجموع یک بازه که بین روزها پخش شده
--
-- وقتی پنل دیتاسنتر فقط جمع دوره را می‌دهد و نه تفکیک روزانه، آن مجموع
-- به‌طور مساوی بین روزهای بازه پخش می‌شود تا نمودار روزانه و محاسبه
-- تجمعی سهمیه کار کنند.
--
-- ولی آن اعداد روزانه تخمین‌اند نه اندازه‌گیری. اگر با ردیف‌های واقعاً
-- روزانه یک برچسب می‌گرفتند، شش ماه بعد کسی که یازده ستون هم‌قد در نمودار
-- می‌بیند فکر می‌کرد مصرف واقعاً یکنواخت بوده.
--
-- جمع بازه دقیق است؛ فقط توزیعش درون بازه ساختگی است.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/005_manual_range.sql

BEGIN;

ALTER TABLE server_metrics_daily
  DROP CONSTRAINT IF EXISTS metrics_daily_source_chk;

ALTER TABLE server_metrics_daily
  ADD CONSTRAINT metrics_daily_source_chk
  CHECK (source IN ('agent', 'manual', 'vnstat', 'manual_range'));

COMMIT;
