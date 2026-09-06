-- کد تخفیف
--
-- تخفیف **مبلغی** است نه درصدی: مبلغ ثابت از فاکتور کم می‌شود.
--
-- ── قاعده‌ای که نباید شکسته شود ────────────────────────────
--
-- **کد فقط پس از پرداخت موفق مصرف می‌شود.**
--
-- اگر هنگام ساخت فاکتور مصرف شود، هر کسی با شروع و لغو مکرر خرید
-- می‌تواند ظرفیت کد را بسوزاند بدون اینکه یک ریال پرداخت کند. ردیف
-- مصرف داخل همان تراکنش قفل‌شده‌ای درج می‌شود که فاکتور را paid
-- می‌کند.
--
-- ── دو نوع کد ──────────────────────────────────────────────
--
--   customer_id تهی    → همه مشتریان می‌توانند استفاده کنند
--   customer_id مقدار  → فقط همان مشتری
--
-- ── چرا مبلغ تخفیف روی فاکتور کپی می‌شود ───────────────────
--
-- invoices.discount_toman مبلغ واقعی کم‌شده را نگه می‌دارد، نه فقط
-- ارجاع به کد. ویرایش کد پس از صدور فاکتور نباید مبلغ فاکتور
-- پرداخت‌نشده را عوض کند — مشتری چیزی می‌بیند و چیز دیگری می‌پردازد.
--
-- ── مبلغ صفر ───────────────────────────────────────────────
--
-- تخفیفی که کل مبلغ را بپوشاند، فاکتور صفر تومانی می‌سازد. درگاه
-- پرداخت صفر را نمی‌پذیرد، پس قید amount_toman > 0 به >= 0 تغییر
-- می‌کند و فاکتور صفر بدون درگاه و بلافاصله تسویه می‌شود.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/038_discounts.sql

BEGIN;

CREATE TABLE IF NOT EXISTS discount_codes (
  id                SERIAL PRIMARY KEY,
  -- همیشه با حروف بزرگ ذخیره می‌شود تا مقایسه بی‌ابهام باشد
  code              TEXT NOT NULL UNIQUE,
  title             TEXT,

  -- تخفیف مبلغی، به تومان
  amount_toman      BIGINT NOT NULL CHECK (amount_toman > 0),

  -- تهی یعنی همه مشتریان
  customer_id       INT REFERENCES customers(id) ON DELETE CASCADE,

  -- all: هر خریدی · traffic: فقط بسته ترافیک · product: فقط محصول
  scope             TEXT NOT NULL DEFAULT 'all'
                    CHECK (scope IN ('all', 'traffic', 'product')),

  -- حداقل مبلغ خرید برای استفاده. صفر یعنی بدون شرط.
  min_amount_toman  BIGINT NOT NULL DEFAULT 0,

  -- سقف دفعات استفاده در کل. تهی یعنی نامحدود.
  max_uses          INT,
  used_count        INT NOT NULL DEFAULT 0,

  -- هر مشتری فقط یک بار. برای کد عمومی معمولا درست است.
  once_per_customer BOOLEAN NOT NULL DEFAULT TRUE,

  starts_at         DATE,
  expires_at        DATE,

  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  note              TEXT,
  created_by        INT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discounts_active ON discount_codes (is_active, expires_at);

-- سابقه مصرف. هر ردیف یعنی یک پرداخت موفق با این کد.
CREATE TABLE IF NOT EXISTS discount_uses (
  id           SERIAL PRIMARY KEY,
  code_id      INT NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
  customer_id  INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invoice_id   INT REFERENCES invoices(id) ON DELETE SET NULL,
  amount_toman BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- یک فاکتور فقط یک بار می‌تواند کد را مصرف کند. اگر تسویه به هر دلیلی
-- دو بار اجرا شود، ردیف دوم درج نمی‌شود و شمارنده هم دو برابر نمی‌رود.
CREATE UNIQUE INDEX IF NOT EXISTS discount_uses_once_per_invoice
  ON discount_uses (invoice_id) WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS discount_uses_code ON discount_uses (code_id, customer_id);

-- ── فاکتور ─────────────────────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_code_id INT
  REFERENCES discount_codes(id) ON DELETE SET NULL;

-- مبلغ واقعی کم‌شده، کپی‌شده در لحظه صدور فاکتور
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_toman BIGINT NOT NULL DEFAULT 0;

-- مبلغ پیش از تخفیف، برای نمایش در فاکتور
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal_toman BIGINT;

-- فاکتور صفر تومانی وقتی تخفیف کل مبلغ را بپوشاند
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_amount_toman_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_amount_positive
  CHECK (amount_toman >= 0);

COMMIT;
