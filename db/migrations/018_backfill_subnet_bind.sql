-- پر کردن پیوند ساب‌نت و سرور لنگر برای رکوردهای موجود
--
-- دو ایراد که با هم باعث می‌شدند آی‌پی روی سرور لنگر ننشیند:
--
-- ۱. کشف هرگز subnet_id را ست نمی‌کرد. مسیر بایند پرفیکس را از ساب‌نت
--    آی‌پی می‌گیرد؛ وقتی آن پیوند خالی است، به ۳۲ برمی‌گردد. با /۳۲ آدرس
--    یک شبکه مستقل تک‌عضوی می‌شود نه عضوی از بلوک، و تجهیزات بالادست
--    نمی‌بینندش — همان چیزی که یک بار دستی رفعش کردیم و از راه دیگر
--    برگشت.
--
-- ۲. bind_server_id فقط برای رکورد تازه ست می‌شد. آدرس‌هایی که پیش از
--    تعیین «سرور لنگر در پنل» وارد شده بودند تا ابد بدون لنگر می‌ماندند و
--    ایجنت هرگز نمی‌دیدشان.
--
-- کشف بعدی هم این‌ها را درست می‌کند، ولی این مهاجرت منتظر نمی‌ماند.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/018_backfill_subnet_bind.sql

BEGIN;

DO $$
DECLARE
  n_subnet INT;
  n_bind   INT;
  n_left   INT;
BEGIN
  -- ساب‌نت بر اساس دربرگیری؛ دقیق‌ترین بلوک برنده است
  UPDATE ip_addresses i
     SET subnet_id = s.id, updated_at = now()
    FROM LATERAL (
      SELECT sc.id FROM ip_subnets sc
       WHERE i.ip << sc.cidr
       ORDER BY masklen(sc.cidr) DESC
       LIMIT 1
    ) s
   WHERE i.subnet_id IS NULL AND family(i.ip) = 4;
  GET DIAGNOSTICS n_subnet = ROW_COUNT;

  -- سرور لنگر از روی نود همان آی‌پی
  UPDATE ip_addresses i
     SET bind_server_id = n.bind_server_id, updated_at = now()
    FROM vz_nodes n
   WHERE i.vz_node_id = n.id
     AND i.access_watch
     AND i.bind_server_id IS NULL
     AND n.bind_server_id IS NOT NULL;
  GET DIAGNOSTICS n_bind = ROW_COUNT;

  RAISE NOTICE '% آدرس به بلوکش وصل شد، % آدرس به سرور لنگر', n_subnet, n_bind;

  -- آدرس تحت پایشی که هنوز بلوک ندارد، پرفیکسش ۳۲ می‌ماند و روی سرور
  -- کار نمی‌کند. باید دیده شود، نه اینکه بی‌صدا بماند.
  SELECT COUNT(*) INTO n_left
    FROM ip_addresses
   WHERE access_watch AND subnet_id IS NULL AND bind_prefix IS NULL AND family(ip) = 4;
  IF n_left > 0 THEN
    RAISE NOTICE '% آدرس تحت پایش هنوز بلوک ندارد — بلوکشان را در پنل ثبت کنید وگرنه با /32 بایند می‌شوند', n_left;
  END IF;

  SELECT COUNT(*) INTO n_left
    FROM ip_addresses i JOIN vz_nodes n ON n.id = i.vz_node_id
   WHERE i.access_watch AND i.bind_server_id IS NULL AND n.bind_server_id IS NULL;
  IF n_left > 0 THEN
    RAISE NOTICE '% آدرس تحت پایش لنگر ندارد چون نودشان «سرور لنگر در پنل» ندارد', n_left;
  END IF;
END $$;

COMMIT;
