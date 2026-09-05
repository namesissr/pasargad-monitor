import { Pool, type QueryResultRow } from 'pg';

/**
 * استخر اتصال پستگرس.
 *
 * مثل قاعده «سرویس‌های بیرونی تنبل وصل می‌شوند»: استخر در اولین کوئری ساخته
 * می‌شود نه هنگام لود ماژول. اگر دیتابیس بالا نباشد، پروسه نکست ری‌استارت
 * نمی‌شود و فقط همان درخواست خطا می‌دهد.
 */
let pool: Pool | null = null;

/**
 * استخر، برای کارهایی که یک کوئری تنها کافی نیست.
 *
 * تنها کاربردش گرفتن کلاینت اختصاصی برای تراکنش است — مثل تأیید پرداخت
 * که باید ردیف فاکتور را با FOR UPDATE قفل کند. برای کوئری معمولی از
 * query و queryOne استفاده کنید؛ آن‌ها کلاینت را خودشان برمی‌گردانند و
 * نشت اتصال ندارند.
 */
export function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('متغیر DATABASE_URL تنظیم نشده است');
    pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // منطقه زمانی نشست صریح تنظیم می‌شود. بدون این، date_trunc('day', ts)
      // روی UTC کار می‌کند و «مصرف امروز» سه‌ونیم ساعت جابه‌جا می‌شود.
      options: `-c timezone=${process.env.REPORT_TZ || 'Asia/Tehran'}`,
    });
    pool.on('error', (err) => {
      console.error('[db] خطای استخر اتصال:', err.message);
    });
  }
  return pool;
}

/** اجرای کوئری و بازگرداندن ردیف‌ها */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params as never[]);
  return res.rows;
}

/** اجرای کوئری و بازگرداندن اولین ردیف یا null */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** یک کوئری محدود به کلاینت تراکنش */
type ScopedQuery = <R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<R[]>;

/** اجرای چند دستور داخل یک تراکنش */
export async function transaction<T>(fn: (q: ScopedQuery) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const scoped: ScopedQuery = async <R extends QueryResultRow = QueryResultRow>(
      text: string,
      params: unknown[] = [],
    ): Promise<R[]> => {
      const res = await client.query<R>(text, params as never[]);
      return res.rows;
    };
    const out = await fn(scoped);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * سرور پایش: لنگر یا دیدبان — وی‌پی‌اسی که برای خود سیستم پایش است، نه
 * موجودی فروش. مشتری ندارد و ترافیکش ناچیز است، پس در گزارش مصرف و نمای
 * زنده فقط نویز می‌سازد.
 *
 * تشخیص دو راه دارد و هر دو لازم است:
 *   • خودکار از vz_anchors، تا وی‌پی‌اسی که دیگر لنگر نیست خودش برگردد
 *   • ستون is_monitor، برای دیدبان‌ها که در هیچ جدولی به‌عنوان لنگر ثبت
 *     نمی‌شوند
 *
 * هرجا استفاده می‌شود، جدول servers باید با نام «s» صدا زده شده باشد.
 */
export const IS_MONITOR_SERVER =
  '(s.is_monitor OR EXISTS (SELECT 1 FROM vz_anchors va WHERE va.bind_server_id = s.id))';

export const NOT_ANCHOR_SERVER = `NOT ${IS_MONITOR_SERVER}`;
