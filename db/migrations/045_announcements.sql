-- اطلاعیه به مشتری، و ارسال همگانی ایمیل و پیامک
--
-- ── چرا خوانده‌شدن ردیف جدا دارد ───────────────────────────
--
-- می‌شد یک ستون «دیده شد» روی خود اطلاعیه گذاشت، ولی اطلاعیه برای همه
-- مشتری‌هاست و هرکس باید جداگانه ببندش. بدون جدول جدا، اولین کسی که
-- «متوجه شدم» را می‌زد آن را برای همه می‌بست.
--
-- کلید یکتای (اطلاعیه، مشتری) هم یعنی زدن دوباره دکمه خطا نمی‌دهد.
--
-- ── چرا ارسال همگانی صف دارد ───────────────────────────────
--
-- ارسال به چند صد مشتری در یک درخواست HTTP قطعا تایم‌اوت می‌شود، و آن
-- وقت معلوم نیست چند نفر پیام گرفته‌اند و چند نفر نه. بدترین حالت این
-- است که ادمین دوباره بفرستد و نصف مشتری‌ها دو بار پیام بگیرند.
--
-- پس مسیر ای‌پی‌آی فقط ردیف‌ها را در صف می‌گذارد و ورکر می‌فرستد. هر
-- گیرنده ردیف خودش را دارد، پس هم پیشرفت دیده می‌شود و هم ارسال
-- نیمه‌تمام از همان‌جا ادامه پیدا می‌کند.
--
-- ── چرا وضعیت روی خود گیرنده است ───────────────────────────
--
-- شمارنده روی ردیف اصلی تنها، بعد از یک ری‌استارت وسط کار بی‌معنی
-- می‌شود. با وضعیت روی هر گیرنده، «چه کسی پیام گرفت» همیشه قابل
-- پرسیدن است — و همان سوالی است که مشتری معترض می‌پرسد.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/045_announcements.sql

BEGIN;

-- ── اطلاعیه ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,

  -- رنگ و آیکون پاپ‌آپ از این می‌آید
  severity    TEXT NOT NULL DEFAULT 'info'
              CHECK (severity IN ('info', 'warn', 'danger')),

  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  -- بازه نمایش. هر دو اختیاری: تهی یعنی بدون محدودیت.
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,

  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcements_active
  ON announcements (is_active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id INT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  customer_id     INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, customer_id)
);

-- ── ارسال همگانی ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broadcasts (
  id          SERIAL PRIMARY KEY,

  -- email و sms کاملا جدا از هم‌اند: متن، گیرنده و هزینه‌شان فرق دارد
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'sms')),

  -- برای پیامک استفاده نمی‌شود
  subject     TEXT,
  body        TEXT NOT NULL,

  -- all: همه مشتری‌های فعال · selected: فقط انتخاب‌شده‌ها
  target      TEXT NOT NULL DEFAULT 'all' CHECK (target IN ('all', 'selected')),

  -- queued: در صف · sending: در حال ارسال · done: تمام
  status      TEXT NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued', 'sending', 'done', 'canceled')),

  total       INT NOT NULL DEFAULT 0,
  sent        INT NOT NULL DEFAULT 0,
  failed      INT NOT NULL DEFAULT 0,

  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS broadcasts_pending ON broadcasts (status, created_at);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id           SERIAL PRIMARY KEY,
  broadcast_id INT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  customer_id  INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- نشانی در لحظه صف کپی می‌شود: اگر مشتری بعدا ایمیلش را عوض کند،
  -- سابقه باید بگوید به کجا فرستاده شد
  address      TEXT NOT NULL,

  -- pending: نرفته · sent: رفت · failed: نرفت
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'sent', 'failed')),
  error        TEXT,
  sent_at      TIMESTAMPTZ
);

-- یک مشتری در یک ارسال، فقط یک بار
CREATE UNIQUE INDEX IF NOT EXISTS broadcast_recipient_once
  ON broadcast_recipients (broadcast_id, customer_id);

CREATE INDEX IF NOT EXISTS broadcast_recipients_pending
  ON broadcast_recipients (broadcast_id, status);

COMMIT;
