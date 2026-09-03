-- آی‌پی آزادشده از پایش خارج می‌شود
--
-- هدف کل این بخش، آزادکردن آی‌پی برای استفاده دوباره است. ولی وضعیت که به
-- «آزاد شد» می‌رفت، تیک پایش روشن می‌ماند؛ لنگر آن را همچنان خواسته
-- می‌دید و روی وی‌پی‌اس ایران نگه می‌داشت. یعنی آی‌پی آزاد می‌شد ولی
-- عملاً اشغال می‌ماند.
--
-- از این پس هنگام آزادشدن، access_watch خاموش می‌شود و لنگر در دور بعدی
-- آدرس را جدا می‌کند. فیلتر «آزادشده‌ها» دیگر به access_watch وابسته نیست،
-- پس همچنان دیده می‌شوند.
--
-- این مهاجرت رکوردهای آزادشده قبلی را هم اصلاح می‌کند.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/012_release_frees_ip.sql

BEGIN;

UPDATE ip_addresses
   SET access_watch = FALSE, updated_at = now()
 WHERE iran_access_status = 'released' AND access_watch;

COMMIT;
