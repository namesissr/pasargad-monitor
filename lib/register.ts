import { getPool, queryOne } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

/**
 * ثبت‌نام مشتری از فروشگاه عمومی.
 *
 * ── مشتری و حساب، یک تراکنش ────────────────────────────────
 *
 * مشتری بدون حساب یعنی کسی که سفارش داده ولی نمی‌تواند وارد شود.
 * حساب بدون مشتری هم قید دیتابیس را می‌شکند. پس هر دو با هم ساخته
 * می‌شوند یا هیچ‌کدام.
 *
 * ── نقش سخت‌کدشده است ──────────────────────────────────────
 *
 * role همیشه 'customer' است و از ورودی خوانده نمی‌شود. این مسیر از
 * اینترنت باز در دسترس است؛ اگر نقش از بدنه بیاید، هر کسی با فرستادن
 * یک رشته ادمین می‌شود.
 *
 * ── شماره تلفن، نام کاربری ─────────────────────────────────
 *
 * مشتری ایرانی شماره‌اش را از بر است و نام کاربری دلخواه را فراموش
 * می‌کند. شماره هم یکتاست و هم همان چیزی است که پیامک به آن می‌رود.
 */

export interface RegisterInput {
  name: string;
  phone: string;
  password: string;
  email?: string;
  company?: string;
  nationalId?: string;
  address?: string;
}

export interface RegisterResult {
  ok: boolean;
  error?: string;
  status?: number;
  user?: { id: number; username: string; role: string; customer_id: number };
}

/**
 * یکسان‌سازی شماره موبایل ایران.
 *
 * ارقام فارسی و عربی به لاتین، و شکل‌های ۹۸۹…، ۰۰۹۸۹… و ۹… همه به
 * ۰۹… تبدیل می‌شوند. بدون این، یک نفر با نوشتن «+۹۸۹۱۲…» و
 * «۰۹۱۲…» دو حساب می‌سازد و ایندکس یکتا هم جلویش را نمی‌گیرد.
 */
export function normalizePhone(raw: unknown): string {
  let s = String(raw ?? '').trim();

  // ارقام فارسی (۰۶۶۰) و عربی (۰۶۶۰ شرقی) به لاتین
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

  // هر چیزی جز رقم بیرون می‌رود: فاصله، خط تیره، پرانتز، علامت مثبت
  s = s.replace(/\D/g, '');

  if (s.startsWith('0098')) s = s.slice(4);
  else if (s.startsWith('98')) s = s.slice(2);

  if (s.startsWith('9')) s = `0${s}`;
  return s;
}

/** شماره موبایل معتبر ایران: ۱۱ رقم و شروع با ۰۹ */
export function isValidPhone(phone: string): boolean {
  return /^09\d{9}$/.test(phone);
}

/**
 * ایمیل معتبرِ «به‌قدر کافی».
 *
 * اعتبارسنجی کامل ایمیل با الگو ممکن نیست و تلاش برای آن، آدرس‌های
 * درست را رد می‌کند. اینجا فقط شکل بدیهی بررسی می‌شود؛ درست بودن واقعی
 * وقتی معلوم می‌شود که ایمیلی به آن برسد.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** حداقل‌های گذرواژه. کوتاه‌تر از این، حدس‌زدنی است. */
export const PASSWORD_MIN = 8;

export async function registerCustomer(input: RegisterInput): Promise<RegisterResult> {
  const name = String(input.name ?? '').trim().slice(0, 120);
  if (name.length < 3) return { ok: false, error: 'نام و نام خانوادگی را کامل بنویسید', status: 400 };

  const phone = normalizePhone(input.phone);
  if (!isValidPhone(phone)) {
    return { ok: false, error: 'شماره موبایل معتبر نیست — مثل ۰۹۱۲۱۲۳۴۵۶۷', status: 400 };
  }

  const password = String(input.password ?? '');
  if (password.length < PASSWORD_MIN) {
    return { ok: false, error: `گذرواژه باید دست‌کم ${PASSWORD_MIN} کاراکتر باشد`, status: 400 };
  }

  const email = String(input.email ?? '').trim().slice(0, 200);
  if (email && !isValidEmail(email)) {
    return { ok: false, error: 'نشانی ایمیل معتبر نیست', status: 400 };
  }

  // تکراری‌بودن پیش از تراکنش بررسی می‌شود تا پیام روشنی داده شود.
  // ایندکس یکتای دیتابیس همچنان لازم است: بین این بررسی و درج، دو
  // درخواست همزمان می‌توانند هر دو رد شوند.
  const dupCustomer = await queryOne<{ id: number }>(
    `SELECT id FROM customers WHERE phone = $1`,
    [phone],
  );
  const dupUser = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE lower(username) = lower($1)`,
    [phone],
  );
  if (dupCustomer || dupUser) {
    return {
      ok: false,
      error: 'با این شماره قبلا حساب ساخته شده. از گزینه «حساب دارم» وارد شوید.',
      status: 409,
    };
  }

  const passwordHash = await hashPassword(password);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cust = await client.query(
      `INSERT INTO customers (name, company, phone, email, national_id, address, signup_source)
       VALUES ($1, NULLIF($2,''), $3, NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), 'store')
       RETURNING id`,
      [
        name,
        String(input.company ?? '').trim().slice(0, 120),
        phone,
        email,
        String(input.nationalId ?? '').trim().slice(0, 20),
        String(input.address ?? '').trim().slice(0, 500),
      ],
    );
    const customerId = Number(cust.rows[0].id);

    const user = await client.query(
      `INSERT INTO users (username, password_hash, full_name, phone, email, role, customer_id)
       VALUES ($1, $2, $3, $1, NULLIF($4,''), 'customer', $5)
       RETURNING id, username, role, customer_id`,
      [phone, passwordHash, name, email, customerId],
    );

    await client.query('COMMIT');

    return { ok: true, user: user.rows[0] };
  } catch (e) {
    await client.query('ROLLBACK');

    // برخورد با ایندکس یکتا: دو درخواست همزمان با یک شماره. پیام همان
    // پیام تکراری است، نه «خطای سرور».
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('duplicate key')) {
      return {
        ok: false,
        error: 'با این شماره قبلا حساب ساخته شده. از گزینه «حساب دارم» وارد شوید.',
        status: 409,
      };
    }
    throw e;
  } finally {
    client.release();
  }
}
