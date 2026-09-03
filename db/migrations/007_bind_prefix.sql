-- پرفیکس بایند و گیت‌وی اختصاصی آی‌پی
--
-- ایجنت لنگر آی‌پی را با /32 روی رابط اصلی می‌نشاند. این تقریباً همیشه درست
-- است: سرور از قبل مسیر پیش‌فرض دارد پس گیت‌وی لازم نیست، و با /32 کرنل به
-- ARP آن آدرس جواب می‌دهد. دادن ماسک واقعی (مثلا /24) یک مسیر متصل تکراری
-- برای کل ساب‌نت می‌سازد که می‌تواند با مسیر آی‌پی اصلی سرور تداخل کند.
--
-- ولی بعضی چیدمان‌های دیتاسنتری استثنا هستند، پس پرفیکس قابل تغییر است.
-- پیش‌فرض ۳۲ می‌ماند و در رابط هم صریح گفته می‌شود که تغییرش معمولاً لازم نیست.
--
-- گیت‌وی روی خود آی‌پی فقط برای مستندسازی است — چیزی که هنگام تحویل به
-- مشتری لازم می‌شود. اگر خالی باشد، گیت‌وی بلوک استفاده می‌شود. ایجنت لنگر
-- به آن دست نمی‌زند و مسیر پیش‌فرض سرور را عوض نمی‌کند.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/007_bind_prefix.sql

BEGIN;

ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS bind_prefix SMALLINT NOT NULL DEFAULT 32;
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS gateway INET;

ALTER TABLE ip_addresses DROP CONSTRAINT IF EXISTS ip_bind_prefix_chk;
ALTER TABLE ip_addresses ADD CONSTRAINT ip_bind_prefix_chk
  CHECK (bind_prefix BETWEEN 8 AND 32);

COMMIT;
