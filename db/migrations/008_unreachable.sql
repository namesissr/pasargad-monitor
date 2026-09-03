-- تفکیک «در اکسس» از «روت نشده»
--
-- باگی که این مهاجرت رفعش می‌کند: منطق قبلی موفقیت بایند را اثبات
-- زنده‌بودن آی‌پی می‌گرفت. ولی «ip addr add» تقریباً همیشه موفق می‌شود —
-- حتی وقتی دیتاسنتر آن بلوک را اصلاً به این سرور روت نکرده. نتیجه این بود
-- که آی‌پی روت‌نشده تا ابد «در اکسس» گزارش می‌شد و آزادشدنش هرگز تشخیص
-- داده نمی‌شد؛ چون از اول هم از هیچ‌جا در دسترس نبود.
--
-- تشخیص درست، تفکیک سه‌حالته است:
--   از خارج جواب می‌دهد                       → آزاد
--   از خارج نه، از داخل ایران بله             → در اکسس
--   از هیچ‌جا نه، ولی بایند شده               → روت نشده، نیاز به اقدام
--
-- پیامد مهم: دیدبان داخل ایران دیگر اختیاری نیست. بدون آن نمی‌شود
-- «در اکسس» را از «روت نشده» تشخیص داد.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/008_unreachable.sql

BEGIN;

ALTER TABLE ip_addresses DROP CONSTRAINT IF EXISTS ip_iran_access_chk;
ALTER TABLE ip_addresses ADD CONSTRAINT ip_iran_access_chk
  CHECK (iran_access_status IN ('blocked', 'released', 'unreachable', 'unknown'));

-- آیا آی‌پی با آدرس اصلی سرور لنگر هم‌ساب‌نت است؟
-- اگر نه و آی‌پی از هیچ‌جا در دسترس نباشد، تقریباً همیشه یعنی دیتاسنتر
-- بلوک را به این سرور روت نکرده — همان چیزی که ادمین باید پیگیری کند.
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS bind_same_subnet BOOLEAN;

COMMIT;
