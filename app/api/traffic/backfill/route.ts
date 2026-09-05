import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';

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
  /** «days» یعنی روز به روز، «range» یعنی مجموع یک بازه */
  mode?: 'days' | 'range';
  days?: DayInput[];
  /** فقط در حالت بازه */
  from?: string;
  to?: string;
  rx?: number | string;
  tx?: number | string;
  source?: string;
  note?: string;
  overwrite?: boolean;
}

const VALID_SOURCE = ['manual', 'vnstat'];
const RANGE_SOURCE = 'manual_range';
const MAX_DAYS = 400;

const pad = (n: number) => String(n).padStart(2, '0');
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** روزهای یک بازه، شامل هر دو سر */
function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  let guard = 0;
  while (cur <= end && guard++ <= MAX_DAYS) {
    out.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * پخش یک مجموع بین چند روز، بدون گم‌شدن حتی یک بایت.
 *
 * تقسیم صحیح باقیمانده می‌گذارد و اگر نادیده گرفته شود، جمع ردیف‌های
 * نوشته‌شده با عددی که کاربر وارد کرده فرق می‌کند — یعنی حسابداری با
 * فاکتور دیتاسنتر نمی‌خواند، آن هم به‌خاطر چند بایت گردکردن. باقیمانده
 * روی روز آخر می‌نشیند.
 */
function split(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const out = new Array(parts).fill(base);
  out[parts - 1] += total - base * parts;
  return out;
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const b = await readJson<Body>(req);

    const serverId = Number(b.server_id);
    if (serverId === null) return fail('سرور را انتخاب کنید', 400);

    if (b.mode === 'range') return handleRange(serverId, b);

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

/**
 * مجموع یک بازه، پخش‌شده بین روزهایش.
 *
 * روزهایی که داده ایجنت دارند پیش‌فرض دست‌نخورده می‌مانند و مجموع فقط روی
 * روزهای خالی پخش می‌شود. اگر آن‌ها را هم می‌خواهید، گزینه بازنویسی.
 */
async function handleRange(serverId: number, b: Body) {
  const from = String(b.from ?? '').trim();
  const to = String(b.to ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return fail('بازه تاریخ نامعتبر است', 400);
  }
  if (from > to) return fail('تاریخ شروع بعد از تاریخ پایان است', 400);

  const rx = Math.max(0, Math.round(Number(b.rx) || 0));
  const tx = Math.max(0, Math.round(Number(b.tx) || 0));
  if (rx === 0 && tx === 0) return fail('حداقل یکی از دانلود یا آپلود باید بیشتر از صفر باشد', 400);

  const limit = todayIso();
  const all = enumerateDays(from, to).filter((d) => d <= limit);
  if (!all.length) return fail('بازه انتخابی روز گذشته‌ای ندارد', 400);
  if (all.length > MAX_DAYS) return fail(`بازه بیشتر از ${MAX_DAYS} روز پذیرفته نمی‌شود`, 400);

  const server = await queryOne<{ id: number; name: string }>(
    'SELECT id, name FROM servers WHERE id = $1',
    [serverId],
  );
  if (!server) return fail('سرور پیدا نشد', 404);

  const existing = await query<{ day: string; source: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, source
       FROM server_metrics_daily
      WHERE server_id = $1 AND day BETWEEN $2::date AND $3::date`,
    [serverId, from, to],
  );
  const agentDays = new Set(existing.filter((r) => r.source === 'agent').map((r) => r.day));

  const overwrite = b.overwrite === true;
  const targets = overwrite ? all : all.filter((d) => !agentDays.has(d));

  if (!targets.length) {
    return fail('همه روزهای این بازه داده ایجنت دارند. برای جایگزینی، گزینه بازنویسی را بزنید.', 409);
  }

  const rxParts = split(rx, targets.length);
  const txParts = split(tx, targets.length);
  const note =
    String(b.note ?? '').trim() ||
    `پخش‌شده از مجموع بازه ${from} تا ${to}`;

  for (let i = 0; i < targets.length; i++) {
    await query(
      `INSERT INTO server_metrics_daily (server_id, day, rx_bytes, tx_bytes, source, note, samples)
       VALUES ($1, $2::date, $3, $4, $5, $6, 0)
       ON CONFLICT (server_id, day) DO UPDATE
         SET rx_bytes = EXCLUDED.rx_bytes,
             tx_bytes = EXCLUDED.tx_bytes,
             source   = EXCLUDED.source,
             note     = EXCLUDED.note`,
      [serverId, targets[i], rxParts[i], txParts[i], RANGE_SOURCE, note],
    );
  }

  return ok({
    server: server.name,
    mode: 'range',
    days: targets.length,
    skippedAgentDays: all.length - targets.length,
    perDay: { rx: rxParts[0], tx: txParts[0] },
    total: { rx, tx },
    from: targets[0],
    to: targets[targets.length - 1],
  });
}

/** روزهایی که در یک بازه داده ندارند — تا معلوم شود چه چیزی باید وارد شود */
export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);

    const serverId = idParam(url, 'server_id');
    const from = String(url.searchParams.get('from') || '');
    const to = String(url.searchParams.get('to') || '');

    if (serverId === null) return fail('سرور را انتخاب کنید', 400);
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
