-- شارژ ترافیک بدون انقضا
--
-- مدل قبلی (مهاجرت ۰۲۹) شارژ را به یک دوره می‌بست: هر شارژ فقط همان ماه
-- اعتبار داشت. مالک پروژه تصمیم گرفت ترافیک خریداری‌شده تاریخ انقضا
-- نداشته باشد و تا مصرف کامل بماند.
--
-- برای همین، این جدول از «فهرست شارژها» به یک **دفتر** تبدیل می‌شود:
--
--   purchase    خرید مشتری — عدد مثبت، بدون انقضا
--   settlement  تسویه پایان دوره — عدد منفی، به اندازه شارژی که آن دوره
--               واقعا مصرف شده
--
--   موجودی شارژ = SUM(gb) روی همه ردیف‌های سرور
--
-- چرا تسویه لازم است: سهمیه پایه هر ماه از نو شروع می‌شود ولی شارژ نه.
-- اگر ردیف تسویه نبود، موجودی هرگز کم نمی‌شد و مشتری هر ماه همان شارژ
-- را دوباره می‌گرفت — یعنی ترافیکی که پولش را نداده، بی هیچ خطایی در
-- هیچ لاگی.
--
--   مصرف شارژ در یک دوره = کمینه( موجودی ، بیشینه(۰ ، مصرف − سهمیه پایه) )
--
-- کمینه با موجودی لازم است: کسی نمی‌تواند بیشتر از شارژی که دارد مصرف
-- کند. مصرف بیشتر از «پایه + موجودی» اضافه‌مصرف است و کار حسابداری،
-- نه کار این دفتر.
--
-- topup_settled_period خط‌کش هر سرور است: آخرین دوره‌ای که تسویه شده.
-- بدون آن، دوره‌ای که با موجودی صفر پر مصرف شده بود می‌توانست ماه‌ها
-- بعد — وقتی مشتری شارژ تازه خرید — به‌عقب تسویه شود و خرید تازه‌اش را
-- بابت بدهی گذشته بخورد.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/030_topup_carryover.sql

BEGIN;

ALTER TABLE traffic_topups
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'purchase';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'topups_kind_valid') THEN
    ALTER TABLE traffic_topups
      ADD CONSTRAINT topups_kind_valid CHECK (kind IN ('purchase', 'settlement'));
  END IF;
END $$;

-- period_key معنایش عوض شد و دیگر روی موجودی اثر ندارد:
--   برای خرید      → دوره‌ای که در آن خریده شده، فقط اطلاعاتی
--   برای تسویه     → دوره‌ای که تسویه می‌شود، و باید یکتا باشد
--
-- این ایندکس یکتا تضمین می‌کند هر دوره فقط یک بار تسویه شود. بدون آن،
-- دو اجرای همزمان ورکر موجودی را دو بار کم می‌کردند.
CREATE UNIQUE INDEX IF NOT EXISTS topups_settlement_once
  ON traffic_topups (server_id, period_key) WHERE kind = 'settlement';

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS topup_settled_period DATE;

COMMENT ON COLUMN servers.topup_settled_period IS
  'آخرین دوره‌ای که شارژ ترافیک این سرور تسویه شده؛ تهی یعنی هنوز هیچ دوره‌ای';

COMMIT;
