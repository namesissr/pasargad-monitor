import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * وارد کردن دستی مصرف روزهای گذشته.
 *
 * چرا لازم است: ایجنت گذشته را نمی‌سازد. شمارنده‌های /proc/net/dev تجمعی از
 * زمان بوت‌اند و تفکیک روزانه‌شان هیچ‌جا ذخیره نشده. اگر ایجنت وسط دوره
 * صورتحساب نصب شود، روزهای قبلش فقط از پنل دیتاسنتر یا vnstat خود نود
 * قابل بازیابی‌اند.
 *
 * سه محافظ:
 *  ۱. ردیف‌های وارد شده با ستون source علامت می‌خورند، تا بعداً معلوم باشد
 *     کدام عدد اندازه‌گیری شده و کدام دستی آمده.
 *  ۲. روزی که از قبل داده ایجنت دارد بازنویسی نمی‌شود مگر صریح خواسته شود.
 *  ۳. روز آینده پذیرفته نمی‌شود.
 */

interface DayInput {
  day?: string;
  rx?: number | string;
  tx?: number | string;
}

interface Body {
  server_id?: number | string;
  days?: DayInput[];
  source?: string;
  note?: string;
  overwrite?: boolean;
}

const VALID_SOURCE = ['manual', 'vnstat'];
const MAX_DAYS = 400;

const pad = (n: number) => String(n).padStart(2, '0');
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const b = await readJson<Body>(req);

    const serverId = Number(b.server_id);
    if (!Number.isInteger(serverId)) return fail('سرور را انتخاب کنید', 400);

    const source = VALID_SOURCE.includes(String(b.source)) ? String(b.source) : 'manual';
    const note = String(b.note ?? '').trim() || null;
    const overwrite = b.overwrite === true;

    const rows = Array.isArray(b.days) ? b.days : [];
    if (!rows.length) return fail('هیچ ردیفی برای وارد کردن فرستاده نشده است', 400);
    if (rows.length > MAX_DAYS) return fail(`حداکثر ${MAX_DAYS} روز در هر بار`, 400);

    const server = await queryOne<{ id: number; name: string }>(
      'SELECT id, name FROM servers WHERE id = $1',
      [serverId],
    );
    if (!server) return fail('سرور پیدا نشد', 404);

    const limit = todayIso();
    const added: string[] = [];
    const updated: string[] = [];
    const skipped: { day: string; reason: string }[] = [];

    for (const row of rows) {
      const day = String(row.day ?? '').trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        skipped.push({ day: day || '(خالی)', reason: 'قالب تاریخ درست نیست' });
        continue;
      }
      if (day > limit) {
        skipped.push({ day, reason: 'تاریخ آینده است' });
        continue;
      }

      const rx = Math.max(0, Math.round(Number(row.rx) || 0));
      const tx = Math.max(0, Math.round(Number(row.tx) || 0));
      if (!Number.isFinite(rx) || !Number.isFinite(tx)) {
        skipped.push({ day, reason: 'مقدار عددی نیست' });
        continue;
      }

      const existing = await queryOne<{ source: string }>(
        'SELECT source FROM server_metrics_daily WHERE server_id = $1 AND day = $2::date',
        [serverId, day],
      );

      // داده ایجنت اندازه‌گیری واقعی است و بر ورودی دستی ارجحیت دارد
      if (existing && existing.source === 'agent' && !overwrite) {
        skipped.push({ day, reason: 'داده ایجنت دارد؛ برای جایگزینی گزینه بازنویسی را بزنید' });
        continue;
      }

      await query(
        `INSERT INTO server_metrics_daily (server_id, day, rx_bytes, tx_bytes, source, note, samples)
         VALUES ($1, $2::date, $3, $4, $5, $6, 0)
         ON CONFLICT (server_id, day) DO UPDATE
           SET rx_bytes = EXCLUDED.rx_bytes,
               tx_bytes = EXCLUDED.tx_bytes,
               source   = EXCLUDED.source,
               note     = EXCLUDED.note`,
        [serverId, day, rx, tx, source, note],
      );

      if (existing) updated.push(day);
      else added.push(day);
    }

    return ok({
      server: server.name,
      added: added.length,
      updated: updated.length,
      skipped,
      range: added.concat(updated).sort(),
    });
  });
}

/** روزهایی که در یک بازه داده ندارند — تا معلوم شود چه چیزی باید وارد شود */
export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);

    const serverId = Number(url.searchParams.get('server_id'));
    const from = String(url.searchParams.get('from') || '');
    const to = String(url.searchParams.get('to') || '');

    if (!Number.isInteger(serverId)) return fail('سرور را انتخاب کنید', 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return fail('بازه تاریخ نامعتبر است', 400);
    }

    const rows = await query<{ day: string; has_data: boolean; source: string | null }>(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              (m.server_id IS NOT NULL) AS has_data,
              m.source
         FROM generate_series($2::date, $3::date, interval '1 day') AS d(day)
         LEFT JOIN server_metrics_daily m
                ON m.server_id = $1 AND m.day = d.day::date
        ORDER BY d.day`,
      [serverId, from, to],
    );

    return ok({
      days: rows,
      missing: rows.filter((r) => !r.has_data).map((r) => r.day),
    });
  });
}
