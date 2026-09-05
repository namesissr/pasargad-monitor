-- ترافیک پیش‌خرید — ساده‌سازی
--
-- مهاجرت‌های ۰۲۹ و ۰۳۰ فرض می‌کردند سرور اختصاصی یک «سهمیه پایه ماهانه»
-- دارد و خرید ترافیک روی آن سوار می‌شود. مالک پروژه تصحیح کرد: سرور
-- اختصاصی اصلا سهمیه پایه ندارد. مشترک از همان اول ترافیک می‌خرد، و هر
-- وقت تمام شد دوباره می‌خرد.
--
-- پس همه ماشین‌آلات تسویه دوره‌ای — ردیف settlement، ایندکس یکتای دوره،
-- و ستون خط‌کش — بی‌معنی شدند و برداشته می‌شوند. مدل به یک عدد رسید:
--
--   موجودی = مجموع خریدها − مجموع مصرف
--
-- servers.traffic_counted_from می‌گوید مصرف از چه تاریخی شمرده شود. با
-- اولین خرید هر سرور گذاشته می‌شود. بدون آن، سروری که ماه‌ها پیش از
-- شروع فروش پیش‌خرید در حال کار بوده، از همان روز اول بدهکار به دنیا
-- می‌آمد.
--
-- servers.traffic_quota_gb دست‌نخورده می‌ماند و همان معنای قبلی را دارد:
-- سهمیه ماهانه سرورهای خودمان، برای هشدار ادمین و گزارش ماهانه. به
-- ترافیک پیش‌خرید مشتری کاری ندارد.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/031_prepaid_traffic.sql

BEGIN;

-- تاریخ شروع شمارش مصرف
ALTER TABLE servers ADD COLUMN IF NOT EXISTS traffic_counted_from DATE;

COMMENT ON COLUMN servers.traffic_counted_from IS
  'مصرف ترافیک از این تاریخ به بعد از موجودی پیش‌خرید کم می‌شود؛ با اولین خرید گذاشته می‌شود';

-- پر کردن از روی قدیمی‌ترین خرید هر سرور
UPDATE servers s
   SET traffic_counted_from = t.first_day
  FROM (SELECT server_id, MIN(created_at)::date AS first_day
          FROM traffic_topups GROUP BY server_id) t
 WHERE t.server_id = s.id AND s.traffic_counted_from IS NULL;

-- ── برچیدن ماشین‌آلات تسویه دوره‌ای ──────────────────────────
--
-- ردیف‌های تسویه باید بروند: در مدل تازه مصرف مستقیم از server_metrics_daily
-- خوانده می‌شود، و ماندن این ردیف‌ها یعنی مصرف دو بار کم می‌شود.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'traffic_topups' AND column_name = 'kind'
  ) THEN
    DELETE FROM traffic_topups WHERE kind = 'settlement';
  END IF;
END $$;

DROP INDEX IF EXISTS topups_settlement_once;
DROP INDEX IF EXISTS topups_server_period;

ALTER TABLE traffic_topups DROP CONSTRAINT IF EXISTS topups_kind_valid;
ALTER TABLE traffic_topups DROP COLUMN IF EXISTS kind;
-- دوره خرید معنایی ندارد وقتی ترافیک انقضا ندارد؛ created_at تاریخ خرید را دارد
ALTER TABLE traffic_topups DROP COLUMN IF EXISTS period_key;

ALTER TABLE servers DROP COLUMN IF EXISTS topup_settled_period;

CREATE INDEX IF NOT EXISTS topups_server ON traffic_topups (server_id, created_at DESC);

COMMIT;
