-- تیکت پشتیبانی، و هدف‌گیری کد تخفیف روی یک محصول
--
-- ── کد تخفیف برای یک محصول یا بسته مشخص ────────────────────
--
-- تا حالا دامنه کد فقط سه حالت داشت: همه، بسته ترافیک، محصول. حالا
-- می‌شود کد را به **یک** محصول یا **یک** بسته بست.
--
-- خالی‌بودن هر دو یعنی همان رفتار قبلی. پس کدهای موجود دست‌نخورده
-- کار می‌کنند.
--
-- ── تیکت ───────────────────────────────────────────────────
--
-- وضعیت تیکت از دید **ما** نوشته می‌شود، نه از دید مشتری:
--
--   open      منتظر پاسخ ماست
--   answered  پاسخ داده‌ایم، منتظر مشتری
--   closed    بسته شده
--
-- با این تعریف، فهرست «open» دقیقا همان چیزی است که کار دارد. اگر از
-- دید مشتری نوشته می‌شد، پشتیبان باید هر بار فکر می‌کرد کدام‌ها نوبت
-- اوست.
--
-- پاسخ مشتری روی تیکت بسته، دوباره بازش می‌کند: مشتری‌ای که پیگیری
-- می‌کند نباید مجبور شود تیکت تازه بسازد و سابقه را از هم بپاشد.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/039_tickets.sql

BEGIN;

-- ── هدف‌گیری کد تخفیف ──────────────────────────────────────
ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS product_id INT
  REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS package_id INT
  REFERENCES traffic_packages(id) ON DELETE CASCADE;

COMMENT ON COLUMN discount_codes.product_id IS
  'تهی یعنی همه محصولات؛ مقدار یعنی فقط همان محصول';
COMMENT ON COLUMN discount_codes.package_id IS
  'تهی یعنی همه بسته‌ها؛ مقدار یعنی فقط همان بسته';

-- کد نمی‌تواند همزمان به یک محصول و یک بسته بسته شود؛ آن ترکیب هیچ
-- خریدی را پوشش نمی‌دهد و فقط سردرگمی می‌سازد.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discount_one_target') THEN
    ALTER TABLE discount_codes ADD CONSTRAINT discount_one_target
      CHECK (product_id IS NULL OR package_id IS NULL);
  END IF;
END $$;

-- ── تیکت ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id            SERIAL PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  customer_id   INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- تیکت می‌تواند درباره یک سرور مشخص باشد
  server_id     INT REFERENCES servers(id) ON DELETE SET NULL,

  subject       TEXT NOT NULL,

  -- وضعیت از دید ما: open یعنی نوبت پاسخ ماست
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'answered', 'closed')),
  priority      TEXT NOT NULL DEFAULT 'normal'
                CHECK (priority IN ('low', 'normal', 'high')),

  last_reply_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- customer یا admin؛ برای مرتب‌سازی و نشان‌دادن نوبت
  last_reply_by TEXT NOT NULL DEFAULT 'customer',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tickets_customer ON tickets (customer_id, last_reply_at DESC);
CREATE INDEX IF NOT EXISTS tickets_status ON tickets (status, last_reply_at DESC);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id            SERIAL PRIMARY KEY,
  ticket_id     INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  -- customer یا admin
  author        TEXT NOT NULL CHECK (author IN ('customer', 'admin')),
  -- کدام همکار پاسخ داده؛ برای پیام مشتری تهی است
  author_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_messages_thread
  ON ticket_messages (ticket_id, created_at);

CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START 1;

INSERT INTO settings (key, value) VALUES
  ('tickets_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

COMMIT;
