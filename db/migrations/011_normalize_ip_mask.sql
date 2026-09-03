-- عادی‌سازی آدرس‌های ذخیره‌شده با ماسک
--
-- باگ: ایمپورت بلوک آدرس را با «(network($1::cidr) + i)::inet» می‌ساخت.
-- تبدیل cidr به inet ماسک را نگه می‌دارد، پس ۹۵٫۳۸٫۱۰۱٫۱۳۱ به شکل
-- «۹۵٫۳۸٫۱۰۱٫۱۳۱/۲۴» ذخیره می‌شد.
--
-- مقایسه inet در پستگرس ماسک را هم حساب می‌کند:
--   '95.38.101.131/24'::inet = '95.38.101.131'::inet  →  false
--
-- نتیجه: دیدبان فهرست را با host() می‌گرفت (بدون ماسک) و نتیجه را با همان
-- می‌فرستاد، ولی جست‌وجوی «ip = $1::inet» هیچ‌وقت مطابقت نمی‌کرد. همه
-- نتیجه‌ها بی‌صدا دور ریخته می‌شدند و وضعیت هیچ آی‌پی‌ای عوض نمی‌شد.
--
-- آدرس‌هایی که دستی اضافه شده‌اند ماسک ندارند، پس فقط ردیف‌های ایمپورت
-- تحت تأثیرند — و همان‌ها معمولاً اکثریت‌اند.
--
-- این مهاجرت هیچ ردیفی حذف نمی‌کند. اگر هر دو نسخه یک آدرس وجود داشته
-- باشد (یکی ماسک‌دار از ایمپورت، یکی بدون ماسک از افزودن دستی)، تغییر
-- باعث نقض یکتایی می‌شود؛ آن‌ها دست‌نخورده می‌مانند و فهرستشان چاپ
-- می‌شود تا خودتان تصمیم بگیرید کدام بماند.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/011_normalize_ip_mask.sql

BEGIN;

UPDATE ip_addresses a
   SET ip = host(a.ip)::inet,
       updated_at = now()
 WHERE a.version = 4
   AND masklen(a.ip) <> 32
   AND NOT EXISTS (
     SELECT 1 FROM ip_addresses b
      WHERE b.id <> a.id AND host(b.ip) = host(a.ip) AND masklen(b.ip) = 32
   );

DO $$
DECLARE
  leftover TEXT;
BEGIN
  SELECT string_agg(host(ip), ', ' ORDER BY ip) INTO leftover
    FROM ip_addresses WHERE version = 4 AND masklen(ip) <> 32;
  IF leftover IS NOT NULL THEN
    RAISE NOTICE 'این آدرس‌ها هر دو نسخه را دارند و دستی باید یکی‌شان حذف شود: %', leftover;
  ELSE
    RAISE NOTICE 'همه آدرس‌ها عادی شدند.';
  END IF;
END $$;

COMMIT;
