-- اطلاع‌رسانی به تلگرام مشتری
--
-- ── چرا شناسه گفتگو را خود مشتری نمی‌نویسد ─────────────────
--
-- شناسه گفتگوی تلگرام عددی است که کاربر عادی نه می‌داند نه پیدا
-- می‌کند. و مهم‌تر: اگر دستی وارد شود، هر کسی می‌تواند شناسه یک نفر
-- دیگر را بنویسد و هشدارهای او را بگیرد.
--
-- پس اتصال با یک کد یکبارمصرف انجام می‌شود: پرتال کد می‌سازد، مشتری در
-- تلگرام /start <کد> می‌فرستد، و ورکر شناسه گفتگو را از خود پیام
-- تلگرام برمی‌دارد. آن شناسه از تلگرام می‌آید نه از مرورگر، پس
-- جعل‌شدنی نیست.
--
-- ── چرا اتصال با ورکر انجام می‌شود، نه با وب‌هوک ────────────
--
-- وب‌هوک یک مسیر عمومی تازه می‌خواهد و یک قدم راه‌اندازی (setWebhook)
-- که فراموش‌شدنش هیچ خطایی نمی‌سازد: اتصال‌ها فقط بی‌صدا کار نمی‌کنند.
--
-- ورکر از قبل همیشه در حال اجراست و برای فرستادن پیام هم به تلگرام
-- وصل می‌شود. خواندن با getUpdates هیچ راه‌اندازی تازه‌ای نمی‌خواهد.
--
-- ── چرا offset در settings است ─────────────────────────────
--
-- getUpdates هر پیام را تا وقتی تأیید نشده دوباره می‌دهد. بدون نگه‌داشتن
-- offset بین ری‌استارت‌ها، ورکر پس از هر ری‌استارت همان /start قدیمی را
-- دوباره پردازش می‌کند.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/043_customer_telegram.sql

BEGIN;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMPTZ;

COMMENT ON COLUMN customers.telegram_chat_id IS
  'از خود پیام تلگرام گرفته می‌شود، نه از فرم مشتری';

-- یک گفتگوی تلگرام نباید به دو مشتری وصل باشد: پیام‌های دو نفر در یک
-- جا جمع می‌شود و معلوم نیست کدام مال کیست.
CREATE UNIQUE INDEX IF NOT EXISTS customers_telegram_uq
  ON customers (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id <> '';

-- ── کد اتصال ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  id          SERIAL PRIMARY KEY,
  -- کد کوتاه و خوانا؛ در آدرس deep link می‌رود
  code        TEXT NOT NULL UNIQUE,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_tokens_customer
  ON telegram_link_tokens (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS telegram_tokens_expires
  ON telegram_link_tokens (expires_at);

INSERT INTO settings (key, value) VALUES
  -- اطلاع‌رسانی به تلگرام مشتری
  ('telegram_customer_enabled', 'true'),
  -- نام کاربری ربات، برای ساختن لینک t.me. ورکر خودش با getMe پرش
  -- می‌کند؛ خالی‌بودنش یعنی هنوز به تلگرام وصل نشده.
  ('telegram_bot_username', ''),
  -- آخرین به‌روزرسانی پردازش‌شده تلگرام
  ('telegram_updates_offset', '0')
ON CONFLICT (key) DO NOTHING;

COMMIT;
