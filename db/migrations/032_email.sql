-- ارسال ایمیل
--
-- سومین کانال، کنار پیامک و تلگرام. همان جاهایی که پیامک یا تلگرام
-- می‌رود، ایمیل هم می‌رود — هشدار قطعی سرور، آستانه‌ها، و هشدارهای
-- مشتری (رسیدن به ۹۰ درصد ترافیک، اتمام ترافیک، موعد تمدید).
--
-- **تنظیمات SMTP در جدول settings است نه در .env.** دلیلش این است که
-- عوض‌کردن سرور ایمیل نباید بیلد بخواهد؛ جدول settings در زمان اجرا
-- خوانده می‌شود.
--
-- smtp_pass در همین جدول ذخیره می‌شود. ای‌پی‌آی تنظیمات آن را هرگز
-- برنمی‌گرداند — فقط می‌گوید تنظیم شده یا نه، و فقط وقتی می‌نویسد که
-- مقدار تازه‌ای فرستاده شده باشد. مثل گذرواژه حساب مشتری.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/032_email.sql

BEGIN;

-- نشانی ایمیل کاربران پنل. مثل شماره تلفن، خودکار به گیرندگان هشدار
-- اضافه می‌شود.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

INSERT INTO settings (key, value) VALUES
  ('email_enabled',    'false'),   -- تا وقتی SMTP تنظیم نشده، خاموش
  ('email_recipients', ''),        -- نشانی‌ها با کاما؛ ایمیل کاربران هم اضافه می‌شود
  ('smtp_host',        ''),
  ('smtp_port',        '587'),
  -- none: بدون رمزنگاری · starttls: ارتقا روی همان پورت · tls: رمزنگاری از ابتدا (۴۶۵)
  ('smtp_security',    'starttls'),
  ('smtp_user',        ''),
  ('smtp_pass',        ''),
  ('smtp_from',        ''),
  ('smtp_from_name',   'پاسارگاد میزبان'),
  -- گواهی نامعتبر پذیرفته شود. فقط برای سرور ایمیل داخلی با گواهی
  -- خودامضا؛ روی سرور بیرونی این یعنی ترافیک قابل شنود است.
  ('smtp_insecure',    'false')
ON CONFLICT (key) DO NOTHING;

-- کانال email در جدول notifications: ستون channel متن آزاد است و
-- محدودیتی ندارد، پس تغییری لازم نیست. این ایندکس فقط برای فیلتر
-- سریع‌تر لاگ بر اساس کانال است.
CREATE INDEX IF NOT EXISTS notifications_channel ON notifications (channel, created_at DESC);

COMMIT;
