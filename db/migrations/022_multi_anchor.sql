-- چند لنگر برای هر هایپروایزر
--
-- تا حالا هر نود یک لنگر داشت. با نودهایی که در دیتاسنترهای مختلف‌اند
-- این کار نمی‌کند: آدرس یک دیتاسنتر روی لنگری که در دیتاسنتر دیگری است
-- هرگز روت نمی‌شود.
--
-- کلید تقسیم، بلوک آی‌پی است نه نود. دلیلش این است که روت‌شدن یک آدرس به
-- بلوکش بستگی دارد، نه به اینکه کدام نود آن را استفاده می‌کند. هر بلوک
-- لنگر خودش را می‌گیرد و هر آدرس لنگرش را از بلوکش به ارث می‌برد.
--
-- بلوکی که لنگر تعیین‌شده ندارد به لنگر پیش‌فرض همان هایپروایزر می‌رود،
-- تا پیکربندی موجود بدون تغییر کار کند.
--
-- ستون‌های anchor_vpsid و bind_server_id روی vz_nodes می‌مانند ولی دیگر
-- استفاده نمی‌شوند؛ مقدارشان به یک ردیف لنگر پیش‌فرض منتقل می‌شود.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/022_multi_anchor.sql

BEGIN;

CREATE TABLE IF NOT EXISTS vz_anchors (
  id             SERIAL PRIMARY KEY,
  node_id        INT NOT NULL REFERENCES vz_nodes(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  -- شناسه وی‌پی‌اس لنگر در خود هایپروایزر
  anchor_vpsid   TEXT NOT NULL,
  -- رکورد همان وی‌پی‌اس در بخش سرورها، تا ایجنت بایند فهرستش را بگیرد
  bind_server_id INT REFERENCES servers(id) ON DELETE SET NULL,
  max_per_run    INT NOT NULL DEFAULT 200,
  -- بلوکی که لنگر تعیین‌شده ندارد به این می‌رود
  is_default     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, anchor_vpsid)
);

-- فقط یک لنگر پیش‌فرض برای هر هایپروایزر
CREATE UNIQUE INDEX IF NOT EXISTS vz_anchor_one_default
  ON vz_anchors (node_id) WHERE is_default;

ALTER TABLE ip_subnets ADD COLUMN IF NOT EXISTS anchor_id INT REFERENCES vz_anchors(id) ON DELETE SET NULL;
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS anchor_id INT REFERENCES vz_anchors(id) ON DELETE SET NULL;

-- انتقال پیکربندی تک‌لنگری موجود
INSERT INTO vz_anchors (node_id, name, anchor_vpsid, bind_server_id, max_per_run, is_default)
SELECT id, 'لنگر پیش‌فرض', anchor_vpsid, bind_server_id, max_per_run, TRUE
  FROM vz_nodes
 WHERE COALESCE(anchor_vpsid, '') <> ''
ON CONFLICT (node_id, anchor_vpsid) DO NOTHING;

COMMIT;
