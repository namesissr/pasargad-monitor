-- ثبت رابط شبکه‌ای که ایجنت ترافیکش را می‌شمارد.
--
-- روی نود مجازی‌ساز (SolusVM یا Virtualizor با KVM) انتخاب اشتباه رابط،
-- ترافیک را چند برابر یا نصف نشان می‌دهد و هیچ نشانه‌ای هم ندارد. با ثبت
-- نام رابط، این اشتباه در پنل دیده می‌شود.
--
-- روی نصب تازه، این ستون از قبل در 001 هست و این مهاجرت بی‌اثر است.
-- روی نصب موجود دستی اجرا کنید:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/002_net_iface.sql

ALTER TABLE servers ADD COLUMN IF NOT EXISTS net_iface TEXT;
