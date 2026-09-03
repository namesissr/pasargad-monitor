-- تنظیمات هشدار تلگرام
--
-- توکن ربات در .env می‌ماند نه اینجا — مثل کلید کاوه‌نگار. تنظیمات جدول
-- settings در پنل نمایش داده می‌شود و راز نباید آنجا باشد.
--
-- شناسه گفتگو راز نیست و در پنل قابل ویرایش است، پس بدون بیلد عوض می‌شود.
--
-- پیش‌فرض خاموش: کسی که .env را پر نکرده نباید هشدارهایش بی‌صدا شکست بخورند.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/013_telegram_settings.sql

BEGIN;

INSERT INTO settings (key, value) VALUES
  ('telegram_enabled', 'false'),
  ('telegram_chat_ids', '')
ON CONFLICT (key) DO NOTHING;

COMMIT;
