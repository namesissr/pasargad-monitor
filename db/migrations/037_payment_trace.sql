-- رد پرداخت ناموفق
--
-- تا حالا وقتی تأیید پرداخت شکست می‌خورد، فقط یک خط در لاگ کانتینر
-- می‌ماند و بس. یعنی بدترین حالت ممکن بی‌سروصدا اتفاق می‌افتاد:
--
--   پول از حساب مشتری کم شده، فاکتور باز مانده، و هیچ‌کس نمی‌داند چرا.
--
-- ادمین در پنل فقط می‌دید فاکتور پرداخت‌نشده است. مشتری هم فقط یک پیام
-- عمومی می‌گرفت. علت واقعی — پاسخ درگاه — جایی ذخیره نمی‌شد.
--
-- حالا هر تلاش ناموفق روی خود فاکتور می‌نشیند:
--
--   payment_error  پیام خطای درگاه، همان‌طور که آمد
--   callback_raw   پارامترهایی که درگاه در بازگشت فرستاد
--
-- دومی برای وقتی است که نام پارامترها با انتظار ما نخواند. بدون دیدن
-- آنچه واقعا آمده، تشخیصش ممکن نیست.
--
-- **رمز عبور سرور اینجا ذخیره نمی‌شود.** هنگام تحویل سفارش، ادمین آن را
-- در فرم می‌نویسد و فقط در ایمیل مشتری می‌رود. نگهداری‌اش در دیتابیس
-- یعنی یک دامپ، رمز همه سرورهای تحویل‌شده را لو می‌دهد.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/037_payment_trace.sql

BEGIN;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_error TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS callback_raw TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN invoices.payment_error IS
  'پیام خطای آخرین تلاش تأیید؛ تهی یعنی تلاش ناموفقی نبوده';
COMMENT ON COLUMN invoices.callback_raw IS
  'پارامترهای بازگشتی درگاه، برای وقتی که نام‌ها با انتظار ما نمی‌خواند';

CREATE INDEX IF NOT EXISTS invoices_failed
  ON invoices (last_attempt_at DESC)
  WHERE status = 'unpaid' AND payment_error IS NOT NULL;

COMMIT;
