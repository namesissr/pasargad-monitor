-- هر هایپروایزر ردیف بلوک خودش را داشته باشد
--
-- یک سی‌آی‌دی‌آر می‌تواند در دو هایپروایزر تعریف شده باشد. مثال واقعی:
-- ۹۵٫۳۸٫۱۰۱٫۰/۲۴ با ۵۰ آدرس در سولوس و ۴۶ در ویژالیزور.
--
-- تا حالا ستون cidr یکتا بود، پس هر دو در یک ردیف می‌نشستند. سه پیامد:
--
--   ۱. شمارش هر دو را جمع می‌کرد و با هیچ‌کدام نمی‌خواند
--   ۲. ستون vz_node_id هر بار با کشف بعدی عوض می‌شد، پس عدد بین ۵۰ و ۴۶
--      می‌پرید
--   ۳. و مهم‌تر: لنگر هر بلوک یکی است، در حالی که این دو بخش روی دو
--      هایپروایزر متفاوت‌اند و لنگرهای متفاوتی لازم دارند
--
-- حالا یکتایی ترکیبی است. دو ایندکس جزئی به‌جای یکی، تا روی هر نسخه
-- پستگرس کار کند بدون تکیه بر NULLS NOT DISTINCT.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/025_subnet_per_node.sql

BEGIN;

ALTER TABLE ip_subnets DROP CONSTRAINT IF EXISTS ip_subnets_cidr_key;

CREATE UNIQUE INDEX IF NOT EXISTS ip_subnets_cidr_node_uq
  ON ip_subnets (cidr, vz_node_id) WHERE vz_node_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ip_subnets_cidr_manual_uq
  ON ip_subnets (cidr) WHERE vz_node_id IS NULL;

-- برای هر ترکیب بلوک و نودی که آدرس دارد ولی ردیف ندارد، ردیف بساز.
-- لنگر و برچسب از ردیف موجود کپی می‌شوند تا پیکربندی از دست نرود.
INSERT INTO ip_subnets (cidr, version, gateway, label, provider, location, notes,
                        anchor_id, vz_node_id)
SELECT DISTINCT s.cidr, s.version, s.gateway, s.label, s.provider, s.location, s.notes,
       s.anchor_id, i.vz_node_id
  FROM ip_addresses i
  JOIN ip_subnets s ON s.id = i.subnet_id
 WHERE i.vz_node_id IS NOT NULL
   AND s.vz_node_id IS DISTINCT FROM i.vz_node_id
ON CONFLICT DO NOTHING;

-- هر آدرس به ردیف بلوک نود خودش وصل شود
UPDATE ip_addresses i
   SET subnet_id = t.id, updated_at = now()
  FROM ip_subnets cur
  JOIN ip_subnets t ON t.cidr = cur.cidr
 WHERE i.subnet_id = cur.id
   AND i.vz_node_id IS NOT NULL
   AND t.vz_node_id = i.vz_node_id
   AND t.id <> cur.id;

DO $$
DECLARE
  n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM ip_subnets WHERE vz_node_id IS NOT NULL;
  RAISE NOTICE '% ردیف بلوک متصل به هایپروایزر', n;
END $$;

COMMIT;
