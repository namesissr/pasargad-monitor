-- فاکتور و پرداخت
--
-- تا حالا موعد تمدید فقط اطلاع‌رسانی می‌شد: پیامک می‌رفت و بعدش هیچ.
-- مشتری جایی نداشت که مبلغ را ببیند، پرداخت کند، یا سابقه پرداخت‌هایش
-- را مرور کند.
--
-- ── قیمت فروش، جدا از هزینه ما ─────────────────────────────
--
-- servers.monthly_cost هزینه‌ای است که ما می‌دهیم. قیمتی که مشتری
-- می‌پردازد ستون جداگانه‌ای است. یکی‌کردنشان یعنی حاشیه سود ما در
-- فاکتور مشتری چاپ می‌شود.
--
-- ── یکتایی فاکتور تمدید ────────────────────────────────────
--
-- ایندکس یکتا روی (server_id, period_from) برای فاکتورهای تمدید.
-- بدون آن، هر بار که چرخه ورکر اجرا می‌شود یک فاکتور تازه برای همان
-- دوره ساخته می‌شود و مشتری ده‌ها فاکتور تکراری می‌بیند.
--
-- ── وضعیت پرداخت ───────────────────────────────────────────
--
-- payment_code کدی است که درگاه هنگام شروع پرداخت می‌دهد،
-- payment_ref شناسه پیگیری پس از تأیید. هر دو نگه داشته می‌شوند چون
-- پیگیری اختلاف با درگاه بدون هر دو ممکن نیست.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/035_invoices.sql

BEGIN;

-- قیمت تمدید که مشتری می‌پردازد. صفر یعنی فاکتور خودکار ساخته نشود.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS renewal_price_toman BIGINT NOT NULL DEFAULT 0;

-- طول دوره تمدید به ماه. سه یا شش یا دوازده هم رایج است.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS renewal_months INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN servers.renewal_price_toman IS
  'قیمتی که مشتری بابت هر دوره تمدید می‌پردازد؛ با monthly_cost که هزینه ماست فرق دارد';

CREATE TABLE IF NOT EXISTS invoices (
  id            SERIAL PRIMARY KEY,
  -- شماره خوانا برای پیگیری، مثل ۱۴۰۴-۰۰۰۱۲
  number        TEXT NOT NULL UNIQUE,
  customer_id   INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  server_id     INT REFERENCES servers(id) ON DELETE SET NULL,

  -- renewal: تمدید سرور · traffic: خرید ترافیک · manual: دستی
  kind          TEXT NOT NULL DEFAULT 'renewal',
  title         TEXT NOT NULL,
  amount_toman  BIGINT NOT NULL CHECK (amount_toman > 0),

  -- دوره‌ای که فاکتور بابتش است؛ برای تمدید یعنی دوره تازه
  period_from   DATE,
  period_to     DATE,
  due_at        DATE,

  -- unpaid: در انتظار پرداخت · paid: پرداخت‌شده · canceled: لغو‌شده
  status        TEXT NOT NULL DEFAULT 'unpaid'
                CHECK (status IN ('unpaid', 'paid', 'canceled')),
  paid_at       TIMESTAMPTZ,

  gateway       TEXT,
  payment_code  TEXT,
  payment_ref   TEXT,
  card_number   TEXT,

  note          TEXT,
  created_by    INT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_customer ON invoices (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_status ON invoices (status, due_at);
CREATE INDEX IF NOT EXISTS invoices_server ON invoices (server_id);

-- هر دوره تمدید هر سرور، فقط یک فاکتور.
--
-- فاکتور لغوشده کنار گذاشته می‌شود تا اگر فاکتوری اشتباه صادر شد بشود
-- لغوش کرد و دوباره صادر کرد.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_renewal_once
  ON invoices (server_id, period_from)
  WHERE kind = 'renewal' AND status <> 'canceled';

-- شماره‌گذاری فاکتور. دنباله جدا از شناسه است تا شماره‌ها پیوسته بمانند
-- حتی اگر ردیفی حذف شود.
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

INSERT INTO settings (key, value) VALUES
  -- چند روز پیش از موعد، فاکتور تمدید صادر شود
  ('invoice_days_before', '7'),
  -- درگاه پرداخت: خالی یعنی خاموش
  ('payping_enabled', 'false'),
  ('payping_token', ''),
  -- نسخه ای‌پی‌آی درگاه: v2 یا v3
  ('payping_version', 'v2'),
  -- واحد مبلغی که درگاه می‌پذیرد: toman یا rial
  ('payping_unit', 'toman')
ON CONFLICT (key) DO NOTHING;

COMMIT;
