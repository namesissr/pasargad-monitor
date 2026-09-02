import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, num, ok } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { lastDays, lastMonths, lastYears, type Calendar, type Period } from '@/lib/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * گزارش مصرف روزانه، ماهانه و سالانه.
 *
 * همه چیز از جدول تجمیع روزانه خوانده می‌شود. دوره‌ها در جاوااسکریپت ساخته
 * می‌شوند (چون گروه‌بندی ماه شمسی در SQL خالص دردسر است) و بعد به شکل یک
 * VALUES به کوئری داده می‌شوند تا فقط یک رفت‌وبرگشت به دیتابیس بخورد.
 */

type ReportType = 'daily' | 'monthly' | 'yearly';

// type است نه interface — به دلیل محدودیت T extends QueryResultRow در pg
type AggRow = {
  key: string;
  server_id: number;
  rx: number;
  tx: number;
  cpu_avg: number | null;
  cpu_max: number | null;
  ram_avg: number | null;
  disk_max: number | null;
  uptime: number | null;
  rx_peak: number;
  tx_peak: number;
  days: number;
};

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);

    const type = (url.searchParams.get('type') || 'daily') as ReportType;
    const serverId = url.searchParams.get('server_id');
    const sid = serverId && serverId !== 'all' ? Number(serverId) : null;
    const calendar = ((await getSetting('traffic_calendar', 'jalali')) as Calendar) || 'jalali';

    let periods: Period[];
    if (type === 'daily') periods = lastDays(Math.min(120, num(url.searchParams.get('count'), 30)));
    else if (type === 'monthly') periods = lastMonths(Math.min(36, num(url.searchParams.get('count'), 12)), calendar);
    else if (type === 'yearly') periods = lastYears(Math.min(10, num(url.searchParams.get('count'), 3)), calendar);
    else return fail('نوع گزارش نامعتبر است. یکی از daily، monthly یا yearly', 400);

    // ساخت بند VALUES با پارامترهای امن
    const params: unknown[] = [];
    const values = periods
      .map((p) => {
        params.push(p.key, p.from, p.to);
        return `($${params.length - 2}::text, $${params.length - 1}::date, $${params.length}::date)`;
      })
      .join(', ');

    params.push(sid);
    const sidParam = `$${params.length}`;

    const rows = await query<AggRow>(
      `WITH p(key, from_d, to_d) AS (VALUES ${values})
       SELECT p.key,
              d.server_id,
              COALESCE(SUM(d.rx_bytes), 0)::float8 AS rx,
              COALESCE(SUM(d.tx_bytes), 0)::float8 AS tx,
              AVG(d.cpu_avg)::float8               AS cpu_avg,
              MAX(d.cpu_max)::float8               AS cpu_max,
              AVG(d.ram_pct_avg)::float8           AS ram_avg,
              MAX(d.disk_pct_max)::float8          AS disk_max,
              AVG(d.uptime_ratio)::float8          AS uptime,
              COALESCE(MAX(d.rx_bps_max), 0)::float8 AS rx_peak,
              COALESCE(MAX(d.tx_bps_max), 0)::float8 AS tx_peak,
              COUNT(*)::int                        AS days
         FROM p
         JOIN server_metrics_daily d ON d.day BETWEEN p.from_d AND p.to_d
        WHERE (${sidParam}::int IS NULL OR d.server_id = ${sidParam}::int)
        GROUP BY p.key, d.server_id`,
      params,
    );

    const servers = await query<{ id: number; name: string; main_ip: string; traffic_quota_gb: number }>(
      `SELECT id, name, host(main_ip) AS main_ip, traffic_quota_gb::float8 AS traffic_quota_gb
         FROM servers ${sid ? 'WHERE id = $1' : 'WHERE is_active'} ORDER BY name`,
      sid ? [sid] : [],
    );

    // جمع هر دوره روی همه سرورها
    const byPeriod = periods.map((p) => {
      const rs = rows.filter((r) => r.key === p.key);
      const rx = rs.reduce((a, r) => a + Number(r.rx), 0);
      const tx = rs.reduce((a, r) => a + Number(r.tx), 0);
      const withUptime = rs.filter((r) => r.uptime !== null);
      return {
        key: p.key,
        label: p.label,
        from: p.from,
        to: p.to,
        rx,
        tx,
        total: rx + tx,
        cpu_avg: avg(rs.map((r) => r.cpu_avg)),
        cpu_max: Math.max(0, ...rs.map((r) => Number(r.cpu_max ?? 0))),
        ram_avg: avg(rs.map((r) => r.ram_avg)),
        rx_peak: Math.max(0, ...rs.map((r) => Number(r.rx_peak ?? 0))),
        tx_peak: Math.max(0, ...rs.map((r) => Number(r.tx_peak ?? 0))),
        uptime: withUptime.length ? avg(withUptime.map((r) => r.uptime)) : null,
        servers: rs.length,
      };
    });

    // جمع کل بازه به تفکیک سرور
    const byServer = servers
      .map((s) => {
        const rs = rows.filter((r) => Number(r.server_id) === s.id);
        const rx = rs.reduce((a, r) => a + Number(r.rx), 0);
        const tx = rs.reduce((a, r) => a + Number(r.tx), 0);
        return {
          id: s.id,
          name: s.name,
          main_ip: s.main_ip,
          traffic_quota_gb: s.traffic_quota_gb,
          rx,
          tx,
          total: rx + tx,
          cpu_avg: avg(rs.map((r) => r.cpu_avg)),
          ram_avg: avg(rs.map((r) => r.ram_avg)),
          disk_max: Math.max(0, ...rs.map((r) => Number(r.disk_max ?? 0))),
          rx_peak: Math.max(0, ...rs.map((r) => Number(r.rx_peak ?? 0))),
          tx_peak: Math.max(0, ...rs.map((r) => Number(r.tx_peak ?? 0))),
          uptime: avg(rs.map((r) => r.uptime)),
          days: rs.reduce((a, r) => a + Number(r.days ?? 0), 0),
        };
      })
      .sort((a, b) => b.total - a.total);

    const grand = {
      rx: byServer.reduce((a, s) => a + s.rx, 0),
      tx: byServer.reduce((a, s) => a + s.tx, 0),
      total: byServer.reduce((a, s) => a + s.total, 0),
    };

    if (url.searchParams.get('format') === 'csv') {
      return csvResponse(type, byPeriod, byServer);
    }

    return ok({ type, calendar, periods: byPeriod, byServer, grand });
  });
}

function avg(list: (number | null)[]): number | null {
  const nums = list.map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const GB = Math.pow(1024, 3);

function csvResponse(
  type: string,
  byPeriod: { label: string; rx: number; tx: number; total: number; uptime: number | null }[],
  byServer: { name: string; main_ip: string; rx: number; tx: number; total: number; uptime: number | null }[],
) {
  const lines: string[] = [];
  lines.push('دوره,دریافت (گیگابایت),ارسال (گیگابایت),مجموع (گیگابایت),در دسترس بودن (درصد)');
  for (const p of byPeriod) {
    lines.push(
      [p.label, (p.rx / GB).toFixed(2), (p.tx / GB).toFixed(2), (p.total / GB).toFixed(2), p.uptime?.toFixed(2) ?? ''].join(','),
    );
  }
  lines.push('');
  lines.push('سرور,آی‌پی,دریافت (گیگابایت),ارسال (گیگابایت),مجموع (گیگابایت),در دسترس بودن (درصد)');
  for (const s of byServer) {
    lines.push(
      [s.name, s.main_ip, (s.rx / GB).toFixed(2), (s.tx / GB).toFixed(2), (s.total / GB).toFixed(2), s.uptime?.toFixed(2) ?? ''].join(','),
    );
  }

  // BOM لازم است وگرنه اکسل فارسی را خراب نشان می‌دهد
  const body = '﻿' + lines.join('\r\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="report-${type}-${Date.now()}.csv"`,
    },
  });
}
