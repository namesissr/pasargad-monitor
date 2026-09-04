-- پشتیبانی از چند نوع هایپروایزر
--
-- تا حالا فقط ویژالیزور بود. حالا سولوس‌وی‌ام ۲ هم اضافه می‌شود و هر دو
-- کنار هم کار می‌کنند.
--
-- موتور کشف، تصمیم، پایش و آزادسازی مشترک می‌ماند — فقط کلاینت ای‌پی‌آی
-- فرق می‌کند. دلیلش این است که آن منطق در دو روز گذشته چندین باگ خطرناک
-- داشت و رفع شد؛ نسخه دومش دیر یا زود واگرا می‌شود و همان باگ‌ها را از نو
-- می‌سازد.
--
-- نام جدول‌ها عوض نمی‌شود. تغییر اسم وقتی ده‌ها کوئری به آن اشاره دارند،
-- ریسک بی‌مورد است؛ پیشوند vz تاریخی است نه معنایی.
--
-- برای سولوس، api_key توکن است و api_pass استفاده نمی‌شود.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/021_node_kind.sql

BEGIN;

ALTER TABLE vz_nodes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'virtualizor';

ALTER TABLE vz_nodes DROP CONSTRAINT IF EXISTS vz_nodes_kind_chk;
ALTER TABLE vz_nodes ADD CONSTRAINT vz_nodes_kind_chk
  CHECK (kind IN ('virtualizor', 'solusvm2'));

-- برای سولوس رمز جدا وجود ندارد
ALTER TABLE vz_nodes ALTER COLUMN api_pass DROP NOT NULL;

COMMIT;
