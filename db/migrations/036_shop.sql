-- فروشگاه: بسته ترافیک و محصول
--
-- دو چیز فروخته می‌شود و هر دو از همان خط لوله فاکتور و پرداخت رد
-- می‌شوند که برای تمدید ساخته شد. تفاوتشان فقط در «پس از پرداخت چه
-- اتفاقی می‌افتد» است:
--
--   traffic → ردیف traffic_topups روی سروری که مشتری انتخاب کرده
--   order   → سفارش ثبت می‌شود و ادمین باید سرور را تحویل دهد
--
-- ── چرا شرایط روی خود فاکتور کپی می‌شود ────────────────────
--
-- فاکتور traffic_package_id دارد ولی مقدار گیگ را هم **جداگانه** نگه
-- می‌دارد. اگر فقط ارجاع بود، ویرایش بسته پس از صدور فاکتور، شرایط
-- فاکتور پرداخت‌نشده را عوض می‌کرد — مشتری چیزی می‌دید و چیز دیگری
-- می‌گرفت.
--
-- همین درباره قیمت هم صدق می‌کند: amount_toman از قبل روی فاکتور بود.
--
-- ── موجودی محصول ───────────────────────────────────────────
--
-- stock تهی یعنی نامحدود. کم‌شدنش هنگام **پرداخت** انجام می‌شود نه
-- هنگام صدور فاکتور، وگرنه فاکتور پرداخت‌نشده‌ای که رها شده، موجودی را
-- تا ابد قفل می‌کرد.
--
-- عوارضش این است که دو نفر می‌توانند همزمان فاکتور یک محصول تک‌موجودی
-- را بسازند. آن حالت با هشدار صریح به ادمین مدیریت می‌شود، نه با رد
-- کردن پرداختی که پولش گرفته شده — رد کردن پول گرفته‌شده بدتر است.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/036_shop.sql

BEGIN;

-- ── بسته‌های ترافیک ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS traffic_packages (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  gb           NUMERIC(12, 2) NOT NULL CHECK (gb > 0),
  price_toman  BIGINT NOT NULL CHECK (price_toman > 0),
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS packages_active ON traffic_packages (is_active, sort_order);

-- ── محصولات ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  -- dedicated: سرور اختصاصی · other: هر چیز دیگر
  kind              TEXT NOT NULL DEFAULT 'dedicated',
  summary           TEXT,

  -- مشخصات، برای نمایش. متن آزادند چون هر محصول شکل خودش را دارد.
  spec_cpu          TEXT,
  spec_ram          TEXT,
  spec_disk         TEXT,
  spec_bandwidth    TEXT,
  spec_location     TEXT,

  price_toman       BIGINT NOT NULL CHECK (price_toman > 0),
  -- هزینه راه‌اندازی، یک بار. صفر یعنی ندارد.
  setup_toman       BIGINT NOT NULL DEFAULT 0,
  -- دوره صورتحساب محصول به ماه
  billing_months    INT NOT NULL DEFAULT 1,

  -- تهی یعنی نامحدود
  stock             INT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_active ON products (is_active, sort_order);

-- ── سفارش‌ها ───────────────────────────────────────────────
--
-- سفارش پس از پرداخت به حالت paid می‌رود و منتظر تحویل می‌ماند. تحویل
-- دستی است: سرور اختصاصی خودکار ساخته نمی‌شود.
CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  number       TEXT NOT NULL UNIQUE,
  customer_id  INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id   INT REFERENCES products(id) ON DELETE SET NULL,
  invoice_id   INT REFERENCES invoices(id) ON DELETE SET NULL,

  -- عنوان و قیمت روی خود سفارش کپی می‌شوند، تا ویرایش یا حذف محصول
  -- سابقه سفارش را عوض نکند
  product_name TEXT NOT NULL,
  price_toman  BIGINT NOT NULL,

  -- pending: در انتظار پرداخت · paid: پرداخت شد، منتظر تحویل
  -- provisioned: تحویل شد · canceled: لغو
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'paid', 'provisioned', 'canceled')),

  -- سروری که پس از تحویل ساخته شد
  server_id    INT REFERENCES servers(id) ON DELETE SET NULL,

  note         TEXT,        -- یادداشت مشتری هنگام سفارش
  admin_note   TEXT,        -- یادداشت داخلی؛ مشتری نمی‌بیند
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_customer ON orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status, created_at DESC);

-- ── فاکتور: چه چیزی باید پس از پرداخت انجام شود ────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS traffic_package_id INT
  REFERENCES traffic_packages(id) ON DELETE SET NULL;

-- مقدار گیگ، کپی‌شده از بسته در لحظه صدور فاکتور
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS traffic_gb NUMERIC(12, 2);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id INT
  REFERENCES orders(id) ON DELETE SET NULL;

-- نوع تازه فاکتور: order
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_kind_valid;
ALTER TABLE invoices ADD CONSTRAINT invoices_kind_valid
  CHECK (kind IN ('renewal', 'traffic', 'manual', 'order'));

-- دنباله شماره سفارش، جدا از فاکتور
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;

INSERT INTO settings (key, value) VALUES
  -- نمایش فروشگاه به مشتری
  ('shop_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

COMMIT;
