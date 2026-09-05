-- مشتریان و دسترسی آن‌ها به پنل
--
-- تا حالا «مشتری» فقط یک فیلد متنی روی سرور بود. حالا موجودیت مستقل
-- می‌شود تا بشود سرور را به او تخصیص داد و برایش حساب کاربری ساخت.
--
-- نکته امنیتی که پایه این طراحی است: حساب مشتری در همان جدول users
-- می‌نشیند ولی با role = 'customer' و customer_id پرشده. همه مسیرهای
-- موجود پنل از requireUser استفاده می‌کنند؛ آن تابع از این پس نقش
-- «customer» را رد می‌کند، وگرنه یک حساب مشتری به همه چیز دسترسی
-- می‌داشت.
--
-- فیلد متنی customer روی سرور دست‌نخورده می‌ماند: کشف هایپروایزر آن را
-- پر می‌کند و ربطی به مشتری ثبت‌شده در پنل ندارد.
--
-- اجرا روی نصب موجود:
--   docker compose exec -T postgres psql -U pasargad -d pasargad_monitor < db/migrations/027_customers.sql

BEGIN;

CREATE TABLE IF NOT EXISTS customers (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  company     TEXT,
  phone       TEXT,
  email       TEXT,
  national_id TEXT,
  address     TEXT,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customers_name_idx ON customers (name);

-- تخصیص سرور به مشتری
ALTER TABLE servers ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS servers_customer_idx ON servers (customer_id) WHERE customer_id IS NOT NULL;

-- حساب ورود مشتری. حذف مشتری حسابش را هم می‌برد؛ حساب بی‌صاحب یعنی
-- دسترسی بدون مالک.
ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(id) ON DELETE CASCADE;

-- هر مشتری حداکثر یک حساب
CREATE UNIQUE INDEX IF NOT EXISTS users_customer_uq ON users (customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_chk;
ALTER TABLE users ADD CONSTRAINT users_role_chk
  CHECK (role IN ('admin', 'operator', 'viewer', 'customer'));

-- حساب مشتری باید مشتری داشته باشد، و حساب کارکنان نباید
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_role_chk;
ALTER TABLE users ADD CONSTRAINT users_customer_role_chk
  CHECK ((role = 'customer') = (customer_id IS NOT NULL));

COMMIT;
