import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * لاگ ترافیک یک سرور در یک بازه دلخواه، به تفکیک دانلود و آپلود.
 *
 * دانه‌بندی با طول بازه عوض می‌شود:
 *  • یک یا دو روز  → ساعتی، از جدول تجمیع ساعتی
 *  • بیشتر         → روزانه، از جدول تجمیع روزانه
 *
 * هیچ‌وقت از نمونه‌های خام خوانده نمی‌شود: آن‌ها بعد از هفت روز پاک می‌شوند و
 * لاگ ماه گذشته ناگهان خالی می‌شد. تجمیع ساعتی ۴۰۰ روز و روزانه برای همیشه
 * می‌ماند.
 */

type Row = {
  t: string;
  rx: number;
  tx: number;
  rx_peak: number;
  tx_peak: number;
};

const DAY_MS = 86_400_000;
const MAX_DAYS = 400;

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);

    const serverId = Number(url.searchParams.get('server_id'));
    if (!Number.isInteger(serverId)) return fail('سرور را انتخاب کنید', 400);

    const from = String(url.searchParams.get('from') || '');
    const to = String(url.searchParams.get('to') || from);

    if (!isValidDate(from) || !isValidDate(to)) {
      return fail('تاریخ نامعتبر است. قالب درست: ۲۰۲۶-۰۹-۰۳', 400);
    }
    if (from > to) return fail('تاریخ شروع بعد از تاریخ پایان است', 400);

    const spanDays =
      Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / DAY_MS) + 1;
    if (spanDays > MAX_DAYS) return fail(`بازه بیشتر از ${MAX_DAYS} روز پذیرفته نمی‌شود`, 400);

    const server = await queryOne<{ id: number; name: string; main_ip: string }>(
      `SELECT id, name, host(main_ip) AS main_ip FROM servers WHERE id = $1`,
      [serverId],
    );
    if (!server) return fail('سرور پیدا نشد', 404);

    // انتخاب دانه‌بندی: پارامتر صریح، وگرنه خودکار از روی طول بازه
    const asked = url.searchParams.get('granularity');
    const granularity =
      asked === 'hour' || asked === 'day' ? asked : spanDays <= 2 ? 'hour' : 'day';

    let rows: Row[];
    if (granularity === 'hour') {
      rows = await query<Row>(
        `SELECT to_char(hour, 'YYYY-MM-DD HH24:MI') AS t,
                rx_bytes::float8   AS rx,
                tx_bytes::float8   AS tx,
                rx_bps_max::float8 AS rx_peak,
                tx_bps_max::float8 AS tx_peak
           FROM server_metrics_hourly
          WHERE server_id = $1
            AND hour >= $2::date
            AND hour <  ($3::date + 1)
          ORDER BY hour`,
        [serverId, from, to],
      );
    } else {
      rows = await query<Row>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS t,
                rx_bytes::float8   AS rx,
                tx_bytes::float8   AS tx,
                rx_bps_max::float8 AS rx_peak,
                tx_bps_max::float8 AS tx_peak
           FROM server_metrics_daily
          WHERE server_id = $1 AND day BETWEEN $2::date AND $3::date
          ORDER BY day`,
        [serverId, from, to],
      );
    }

    const totals = rows.reduce(
      (acc, r) => ({
        rx: acc.rx + Number(r.rx || 0),
        tx: acc.tx + Number(r.tx || 0),
        rx_peak: Math.max(acc.rx_peak, Number(r.rx_peak || 0)),
        tx_peak: Math.max(acc.tx_peak, Number(r.tx_peak || 0)),
      }),
      { rx: 0, tx: 0, rx_peak: 0, tx_peak: 0 },
    );

    // چند بازه انتظار داشتیم و چند تا داده دارد. اختلافشان یعنی ایجنت
    // آن مدت گزارش نداده — گفتنش بهتر از نشان‌دادن صفر است.
    const expected = granularity === 'hour' ? spanDays * 24 : spanDays;

    if (url.searchParams.get('format') === 'csv') {
      return csvResponse(server.name, from, to, granularity, rows, totals);
    }

    return ok({
      server,
      from,
      to,
      granularity,
      spanDays,
      expected,
      points: rows,
      totals,
    });
  });
}

function csvResponse(
  serverName: string,
  from: string,
  to: string,
  granularity: string,
  rows: Row[],
  totals: { rx: number; tx: number; rx_peak: number; tx_peak: number },
) {
  const GB = Math.pow(1024, 3);
  const lines: string[] = [];

  lines.push(`لاگ ترافیک — ${serverName} — از ${from} تا ${to}`);
  lines.push(`دانه‌بندی: ${granularity === 'hour' ? 'ساعتی' : 'روزانه'}`);
  lines.push('');
  lines.push('بازه,دانلود (گیگابایت),آپلود (گیگابایت),مجموع (گیگابایت),اوج دانلود (مگابیت/ث),اوج آپلود (مگابیت/ث)');

  for (const r of rows) {
    lines.push([
      r.t,
      (Number(r.rx) / GB).toFixed(3),
      (Number(r.tx) / GB).toFixed(3),
      ((Number(r.rx) + Number(r.tx)) / GB).toFixed(3),
      (Number(r.rx_peak) / 1e6).toFixed(1),
      (Number(r.tx_peak) / 1e6).toFixed(1),
    ].join(','));
  }

  lines.push('');
  lines.push([
    'جمع',
    (totals.rx / GB).toFixed(3),
    (totals.tx / GB).toFixed(3),
    ((totals.rx + totals.tx) / GB).toFixed(3),
    (totals.rx_peak / 1e6).toFixed(1),
    (totals.tx_peak / 1e6).toFixed(1),
  ].join(','));

  // BOM لازم است وگرنه اکسل فارسی را خراب نشان می‌دهد
  const body = '﻿' + lines.join('\r\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="traffic-${from}_${to}.csv"`,
    },
  });
}
