-- ورود با شماره موبایل و کد یکبارمصرف
--
-- ── چرا کد در دیتابیس هش می‌شود ────────────────────────────
--
-- کد شش‌رقمی سه دقیقه اعتبار دارد، ولی تا وقتی زنده است هرکسی که
-- دیتابیس را ببیند می‌تواند با آن وارد حساب مشتری شود — پشتیبان
-- دیتابیس، لاگ کوئری، یا هر کسی که یک لحظه دسترسی خواندن دارد.
--
-- پس خود کد ذخیره نمی‌شود؛ HMAC آن با SESSION_SECRET ذخیره می‌شود.
-- دامپ دیتابیس بدون آن کلید هیچ کدی را برنمی‌گرداند.
--
-- **اگر SESSION_SECRET عوض شود، کدهای در جریان باطل می‌شوند.** این
-- مشکلی نیست: سه دقیقه بعد همه‌شان به‌هرحال منقضی‌اند.
--
-- ── چرا شمارنده تلاش روی خود ردیف است ──────────────────────
--
-- بدون آن، کد شش‌رقمی با یک میلیون درخواست حدس زده می‌شود. سقف نرخِ
-- آی‌پی جلوی سیل را می‌گیرد ولی حمله آهسته از چند آی‌پی را نه.
--
-- پنج تلاش، بعدش همان ردیف سوخته است حتی اگر هنوز منقضی نشده باشد.
--
-- ── چرا ردیف پاک نمی‌شود بلکه consumed_at می‌گیرد ──────────
--
-- کد مصرف‌شده باید بماند تا اگر همان کد دوباره فرستاده شد، «مصرف شده»
-- بگوییم نه «اشتباه است». تفاوتشان برای کسی که دکمه را دو بار زده
-- مهم است.
--
-- پاک‌سازی دوره‌ای در worker/rollup.mjs انجام می‌شود.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/042_otp_login.sql

BEGIN;

CREATE TABLE IF NOT EXISTS otp_codes (
  id          SERIAL PRIMARY KEY,
  -- شماره یکسان‌سازی‌شده: همیشه شکل ۰۹…
  phone       TEXT NOT NULL,
  -- HMAC کد با SESSION_SECRET؛ خود کد هیچ‌جا ذخیره نمی‌شود
  code_hash   TEXT NOT NULL,

  purpose     TEXT NOT NULL DEFAULT 'login'
              CHECK (purpose IN ('login')),

  attempts    INT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,

  -- برای پیگیری سوءاستفاده؛ سقف نرخ خودش در حافظه پروسه است
  request_ip  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- جستجوی همیشگی: تازه‌ترین کد یک شماره
CREATE INDEX IF NOT EXISTS otp_phone_recent ON otp_codes (phone, created_at DESC);

-- برای پاک‌سازی دوره‌ای
CREATE INDEX IF NOT EXISTS otp_expires ON otp_codes (expires_at);

INSERT INTO settings (key, value) VALUES
  -- ورود با کد پیامکی
  ('otp_login_enabled', 'true'),
  -- حالت توسعه: کد به‌جای پیامک در لاگ ای‌پی‌آی نوشته می‌شود.
  -- روی محیط واقعی حتما false — وگرنه هر کسی که لاگ را ببیند
  -- می‌تواند وارد حساب هر مشتری شود.
  ('sms_dev_mode', 'false')
ON CONFLICT (key) DO NOTHING;

COMMIT;
