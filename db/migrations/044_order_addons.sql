-- افزودنی‌های سفارش: ترافیک اضافه و آی‌پی اضافه
--
-- ── چرا قیمت آی‌پی روی محصول است ───────────────────────────
--
-- datacenters.price_per_ip هزینه‌ای است که **ما** می‌دهیم. قیمتی که
-- مشتری می‌پردازد چیز دیگری است؛ یکی‌کردنشان یعنی حاشیه سود ما در
-- صفحه فروشگاه چاپ می‌شود.
--
-- روی محصول است نه در یک تنظیم عمومی، چون هر پلن شرایط خودش را دارد:
-- سرور ارزان ممکن است آی‌پی اضافه‌اش گران‌تر باشد.
--
-- max_extra_ips صفر یعنی این محصول اصلا آی‌پی اضافه نمی‌فروشد و آن
-- بخش در فروشگاه نشان داده نمی‌شود.
--
-- ── چرا جدول جدا برای افزودنی‌ها ───────────────────────────
--
-- می‌شد چند ستون به orders اضافه کرد، ولی هر افزودنی تازه یک ستون
-- دیگر می‌خواست و فاکتور هم نمی‌توانست ردیف‌به‌ردیف نشانشان بدهد.
--
-- عنوان و قیمت روی خود ردیف کپی می‌شوند، مثل orders.product_name:
-- ویرایش یا حذف بسته ترافیک نباید سفارشی را که مشتری دیده و پرداخت
-- کرده عوض کند.
--
-- ── ترافیک کِی اعمال می‌شود ────────────────────────────────
--
-- **هنگام تحویل، نه هنگام پرداخت.** سرور اختصاصی موقع پرداخت هنوز
-- وجود ندارد، پس شارژ ترافیک جایی برای نشستن ندارد. وقتی ادمین سفارش
-- را تحویل می‌دهد و سرور را وصل می‌کند، ترافیک روی همان سرور می‌نشیند.
--
-- applied_at جلوی تحویل دوباره را می‌گیرد: ادمین ممکن است فرم تحویل را
-- دو بار بفرستد و ترافیک نباید دو برابر شود.
--
-- آی‌پی اضافه کار دستی است و فقط به ادمین نشان داده می‌شود.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/044_order_addons.sql

BEGIN;

-- ── قیمت فروش آی‌پی اضافه، روی محصول ───────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS extra_ip_price_toman BIGINT NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS max_extra_ips INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN products.extra_ip_price_toman IS
  'قیمتی که مشتری بابت هر آی‌پی اضافه می‌پردازد؛ با price_per_ip دیتاسنتر که هزینه ماست فرق دارد';
COMMENT ON COLUMN products.max_extra_ips IS
  'سقف آی‌پی اضافه در هر سفارش؛ صفر یعنی این محصول آی‌پی اضافه نمی‌فروشد';

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_max_extra_ips_sane;
ALTER TABLE products ADD CONSTRAINT products_max_extra_ips_sane
  CHECK (max_extra_ips >= 0 AND max_extra_ips <= 64);

-- ── افزودنی‌های سفارش ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_addons (
  id           SERIAL PRIMARY KEY,
  order_id     INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  -- traffic: بسته ترافیک · ip: آی‌پی اضافه
  kind         TEXT NOT NULL CHECK (kind IN ('traffic', 'ip')),

  -- عنوان و قیمت در لحظه سفارش کپی می‌شوند
  label        TEXT NOT NULL,
  qty          INT NOT NULL CHECK (qty > 0),
  unit_toman   BIGINT NOT NULL CHECK (unit_toman >= 0),
  total_toman  BIGINT NOT NULL CHECK (total_toman >= 0),

  -- برای افزودنی ترافیک: بسته و مقدارش
  package_id   INT REFERENCES traffic_packages(id) ON DELETE SET NULL,
  gb           NUMERIC(12, 2),

  -- کِی روی سرور اعمال شد. تهی یعنی هنوز نه.
  applied_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_addons_order ON order_addons (order_id);

-- افزودنی ترافیک هر سفارش فقط یک بار اعمال می‌شود. ادمین ممکن است فرم
-- تحویل را دو بار بفرستد؛ ترافیک نباید دو برابر شود.
CREATE INDEX IF NOT EXISTS order_addons_pending
  ON order_addons (order_id) WHERE kind = 'traffic' AND applied_at IS NULL;

COMMIT;
