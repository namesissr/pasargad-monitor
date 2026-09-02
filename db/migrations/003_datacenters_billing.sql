-- دیتاسنترها و حسابداری هزینه ترافیک و آی‌پی
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/003_datacenters_billing.sql

BEGIN;

-- ============================================================
-- دیتاسنترها — سرورهای اختصاصی زیر آن‌ها گروه می‌شوند
-- قیمت‌ها اینجا یک بار وارد می‌شوند و همه سرورهای آن دیتاسنتر
-- از آن ارث می‌برند، مگر سروری صریح مقدار دیگری داشته باشد.
-- ============================================================
CREATE TABLE IF NOT EXISTS datacenters (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,          -- نام دیتاسنتر
  country           TEXT,
  city              TEXT,
  website           TEXT,
  contact           TEXT,                          -- شماره قرارداد، ایمیل پشتیبانی، شناسه پنل
  -- قیمت‌گذاری، همه به تومان
  price_per_tb      NUMERIC(14, 2) NOT NULL DEFAULT 0,  -- هزینه هر ترابایت ترافیک
  price_per_ip      NUMERIC(14, 2) NOT NULL DEFAULT 0,  -- هزینه ماهانه هر آی‌پی
  included_tb       NUMERIC(10, 3) NOT NULL DEFAULT 0,  -- ترافیک رایگان هر سرور در ماه
  included_ips      INT NOT NULL DEFAULT 1,             -- آی‌پی رایگان همراه هر سرور
  -- کدام ترافیک مبنای صورتحساب است. قرارداد دیتاسنترها فرق دارد و
  -- اختلاف «مجموع» با «فقط ارسالی» می‌تواند تا دو برابر باشد.
  billing_direction TEXT NOT NULL DEFAULT 'total',      -- total | out | in | max
  -- مبنای ترابایت در صورتحساب دیتاسنتر.
  -- بیشتر دیتاسنترها ترافیک را با مبنای ۱۰۰۰ حساب می‌کنند (یک ترابایت =
  -- هزار میلیارد بایت) ولی بعضی‌ها مبنای ۱۰۲۴ دارند. اختلافشان حدود ده
  -- درصد است — یعنی روی قبض ماهانه رقم قابل توجهی. اشتباه بودنش هیچ
  -- نشانه‌ای ندارد جز اینکه عدد پنل با فاکتور دیتاسنتر نمی‌خواند.
  tb_base           INT NOT NULL DEFAULT 1000,
  notes             TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT datacenters_direction_chk CHECK (billing_direction IN ('total', 'out', 'in', 'max')),
  CONSTRAINT datacenters_tb_base_chk CHECK (tb_base IN (1000, 1024))
);

-- ============================================================
-- اتصال سرور به دیتاسنتر و امکان بازنویسی قیمت برای یک سرور خاص
-- مقدار خالی یعنی «از دیتاسنتر ارث ببر»
-- ============================================================
ALTER TABLE servers ADD COLUMN IF NOT EXISTS datacenter_id INT REFERENCES datacenters(id) ON DELETE SET NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS price_per_tb  NUMERIC(14, 2);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS price_per_ip  NUMERIC(14, 2);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS included_tb   NUMERIC(10, 3);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS included_ips  INT;

CREATE INDEX IF NOT EXISTS servers_datacenter_idx ON servers (datacenter_id);

-- اجاره ماهانه ممکن است رقم اعشاری داشته باشد
ALTER TABLE servers ALTER COLUMN monthly_cost TYPE NUMERIC(14, 2);

-- ============================================================
-- انتقال داده: اگر سرورهایی از قبل فیلد «ارائه‌دهنده» داشته‌اند،
-- برای هرکدام یک دیتاسنتر ساخته و وصل می‌شود تا چیزی جا نماند.
-- قیمت‌ها صفر می‌مانند تا خودتان واردشان کنید.
-- ============================================================
INSERT INTO datacenters (name, country)
SELECT DISTINCT trim(provider), max(location)
  FROM servers
 WHERE provider IS NOT NULL AND trim(provider) <> ''
 GROUP BY trim(provider)
ON CONFLICT (name) DO NOTHING;

UPDATE servers s
   SET datacenter_id = d.id
  FROM datacenters d
 WHERE s.datacenter_id IS NULL
   AND s.provider IS NOT NULL
   AND trim(s.provider) = d.name;

COMMIT;
