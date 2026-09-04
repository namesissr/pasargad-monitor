-- پاک‌کردن برچسب‌هایی که مهاجرت ۰۲۵ اشتباه کپی کرد
--
-- آن مهاجرت هنگام ساختن ردیف بلوک برای هایپروایزر دوم، برچسب را از ردیف
-- اول کپی می‌کرد. نتیجه‌اش این بود که نام بلوک سولوس روی ردیف ویژالیزور
-- می‌نشست و دو ردیف یکسان به نظر می‌رسیدند.
--
-- ردیفی که هنوز vz_poolid ندارد یعنی کشف بعد از تقسیم رویش اجرا نشده،
-- پس برچسبش قابل اعتماد نیست. پاک می‌شود و کشف بعدی نام درست را
-- می‌نویسد.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/026_fix_copied_labels.sql

BEGIN;

DO $$
DECLARE
  n INT;
BEGIN
  UPDATE ip_subnets
     SET label = NULL, vz_total_ips = NULL
   WHERE vz_node_id IS NOT NULL AND vz_poolid IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'برچسب % بلوک پاک شد — کشف بعدی نام درست را می‌نویسد', n;
END $$;

COMMIT;
