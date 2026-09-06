-- جزئیات فاکتور: مشخصات فروشنده، و رد تحویل هر فاکتور
--
-- ── چرا مشخصات فروشنده در settings است، نه در کد ────────────
--
-- فاکتوری که مشتری چاپ می‌کند باید بگوید از چه کسی خریده: نام قانونی،
-- شناسه ملی، نشانی، تلفن. این‌ها در کد جای درستی ندارند — عوض‌شدنشان
-- نباید بیلد بخواهد، و در جدول settings زمان اجرا خوانده می‌شوند.
--
-- خالی‌بودنشان خطا نیست: فاکتور بدون بخش فروشنده چاپ می‌شود و هیچ
-- چیزی نمی‌شکند. ولی صفحه تنظیمات یادآوری می‌کند.
--
-- ── چرا traffic_topups.invoice_id ──────────────────────────
--
-- تا حالا تنها ردِ اینکه یک شارژ ترافیک از کدام فاکتور آمده، متن
-- یادداشتش بود («خرید آنلاین — فاکتور ۲۰۲۶-۰۰۰۱۲»). برای نمایش به آدم
-- کافی است، برای پرس‌وجو نه: نمی‌شد پرسید «این فاکتور دقیقا چه چیزی
-- تحویل داد».
--
-- ستون تهی یعنی شارژ دستی ادمین، که اکثر ردیف‌های قدیمی همین‌اند.
--
-- ON DELETE SET NULL نه CASCADE: حذف فاکتور نباید ترافیکی را که مشتری
-- خریده و شاید مصرف هم کرده از موجودی‌اش کم کند.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/040_invoice_detail.sql

BEGIN;

ALTER TABLE traffic_topups ADD COLUMN IF NOT EXISTS invoice_id INT
  REFERENCES invoices(id) ON DELETE SET NULL;

COMMENT ON COLUMN traffic_topups.invoice_id IS
  'فاکتوری که این شارژ را تحویل داد؛ تهی یعنی شارژ دستی ادمین';

CREATE INDEX IF NOT EXISTS topups_invoice ON traffic_topups (invoice_id)
  WHERE invoice_id IS NOT NULL;

-- ردیف‌های موجودی که از خرید آنلاین آمده‌اند، از روی همان یادداشت به
-- فاکتورشان وصل می‌شوند. یک بار، برای داده‌ای که قبلا ثبت شده.
UPDATE traffic_topups t
   SET invoice_id = i.id
  FROM invoices i
 WHERE t.invoice_id IS NULL
   AND t.note = 'خرید آنلاین — فاکتور ' || i.number;

-- ── مشخصات فروشنده روی فاکتور ──────────────────────────────
INSERT INTO settings (key, value) VALUES
  ('invoice_seller_name', 'پاسارگاد میزبان'),
  ('invoice_seller_id', ''),
  ('invoice_seller_phone', ''),
  ('invoice_seller_address', ''),
  -- یک خط پایین فاکتور: شرایط، شماره حساب، هر چیزی که همیشه باید بیاید
  ('invoice_footer', '')
ON CONFLICT (key) DO NOTHING;

COMMIT;
