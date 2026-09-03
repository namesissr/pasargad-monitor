-- حذف آدرس‌های نسخه ۶
--
-- ویژالیزور آدرس‌های نسخه ۶ را در همان فهرست نسخه ۴ برمی‌گرداند و کشف
-- فیلترشان نمی‌کرد. چون درج با «version = 4» ثابت انجام می‌شد، به‌عنوان
-- نسخه ۴ ثبت شدند — یعنی برچسبشان دروغ است.
--
-- سه پیامد داشت: در پایش اکسس می‌آمدند (که فقط برای نسخه ۴ معنی دارد)،
-- در شمارش آی‌پی حسابداری می‌آمدند، و ایجنت لنگر سعی می‌کرد بایندشان کند.
--
-- شرط بر اساس family() است نه ستون version، چون همان ستون است که دروغ
-- می‌گوید.
--
-- ساب‌نت‌های نسخه ۶ فقط وقتی حذف می‌شوند که از کشف آمده باشند. بلوکی که
-- ادمین دستی ثبت کرده دست نمی‌خورد — موجودی دستی را نباید یک مهاجرت
-- پاک کند.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/017_drop_ipv6.sql

BEGIN;

DO $$
DECLARE
  n_ips    INT;
  n_subnet INT;
BEGIN
  SELECT COUNT(*) INTO n_ips FROM ip_addresses WHERE family(ip) = 6;
  DELETE FROM ip_addresses WHERE family(ip) = 6;

  SELECT COUNT(*) INTO n_subnet
    FROM ip_subnets WHERE family(cidr) = 6 AND vz_node_id IS NOT NULL;
  DELETE FROM ip_subnets WHERE family(cidr) = 6 AND vz_node_id IS NOT NULL;

  RAISE NOTICE '% آدرس نسخه ۶ و % بلوک نسخه ۶ حذف شد', n_ips, n_subnet;

  SELECT COUNT(*) INTO n_subnet FROM ip_subnets WHERE family(cidr) = 6;
  IF n_subnet > 0 THEN
    RAISE NOTICE '% بلوک نسخه ۶ دستی باقی ماند — اگر لازم نیستند خودتان حذفشان کنید', n_subnet;
  END IF;
END $$;

-- ستون version با واقعیت هم‌خوان شود، برای رکوردهایی که برچسبشان غلط بود
UPDATE ip_addresses SET version = family(ip) WHERE version <> family(ip);

COMMIT;
