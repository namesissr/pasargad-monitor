import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { lastMonths, type Calendar, type Period } from '@/lib/period';
import { computeDailyCosts } from '@/lib/billing';
import { fetchBillingRows, fetchDailyUsageGrouped, type BillingRow } from '@/lib/billing-data';
import { formatJalaliDay } from '@/lib/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * حسابداری هزینه دیتاسنتر.
 *
 * دو نما دارد و تفاوتشان عمدی است:
 *
 *  • ماهانه — اجاره سرور و هزینه آی‌پی کامل حساب می‌شوند (چون ماهانه‌اند و
 *    چه اول ماه چه آخرش، همان مبلغ را می‌پردازید) و ترافیک تا همین لحظه.
 *
 *  • روزانه — اجاره و هزینه آی‌پی به‌طور مساوی بین روزهای ماه پخش می‌شوند
 *    تا «هزینه امروز» عدد معناداری باشد. روزهای نیامده نشان داده نمی‌شوند.
 *
 * پس جمع ستون روزانه با عدد ماهانه یکی نیست تا وقتی ماه تمام نشده. این
 * اختلاف در خود صفحه توضیح داده می‌شود.
 */

const MONTH_CHOICES = 24;
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  let guard = 0;
  while (cur <= end && guard++ < 400) {
    out.push(isoOf(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

interface Totals {
  servers: number;
  billable_bytes: number;
  billable_tb: number;
  traffic_cost: number;
  ip_cost: number;
  rent: number;
  total: number;
  ips: number;
}

const emptyTotals = (): Totals => ({
  servers: 0, billable_bytes: 0, billable_tb: 0,
  traffic_cost: 0, ip_cost: 0, rent: 0, total: 0, ips: 0,
});

function addTo(t: Totals, r: BillingRow) {
  t.servers += 1;
  t.billable_bytes += r.cost.billable_bytes;
  t.billable_tb += r.cost.billable_tb;
  t.traffic_cost += r.cost.traffic_cost;
  t.ip_cost += r.cost.ip_cost;
  t.rent += r.cost.rent;
  t.total += r.cost.total;
  t.ips += r.ip_count;
}

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);

    const calendar = ((await getSetting('traffic_calendar', 'jalali')) as Calendar) || 'jalali';
    const months = lastMonths(MONTH_CHOICES, calendar);

    const wanted = url.searchParams.get('month');
    // اگر ماه خواسته‌شده نامعتبر بود، ماه جاری (آخرین عضو فهرست) برمی‌گردد
    const period: Period = months.find((m) => m.key === wanted) ?? months[months.length - 1];

    const dcParam = url.searchParams.get('datacenter_id');
    const datacenterId = dcParam && dcParam !== 'all' ? Number(dcParam) : null;
    const srvParam = url.searchParams.get('server_id');
    const serverId = srvParam && srvParam !== 'all' ? Number(srvParam) : null;

    const rows = await fetchBillingRows(period.from, period.to, { datacenterId, serverId });

    // جمع کل و جمع به تفکیک دیتاسنتر
    const grand = emptyTotals();
    const dcMap = new Map<string, { id: number | null; name: string; totals: Totals }>();

    for (const r of rows) {
      addTo(grand, r);
      const key = String(r.datacenter_id ?? 'none');
      if (!dcMap.has(key)) {
        dcMap.set(key, {
          id: r.datacenter_id,
          name: r.datacenter_name ?? 'بدون دیتاسنتر',
          totals: emptyTotals(),
        });
      }
      addTo(dcMap.get(key)!.totals, r);
    }

    const byDatacenter = Array.from(dcMap.values()).sort((a, b) => b.totals.total - a.totals.total);

    // ── شکست روزانه ─────────────────────────────────────────────────
    const allDays = enumerateDays(period.from, period.to);
    const daysInMonth = allDays.length;
    const todayIso = isoOf(new Date());
    const days = allDays.filter((d) => d <= todayIso);

    const usage = await fetchDailyUsageGrouped(period.from, period.to, { datacenterId });
    const perServer = new Map<number, Map<string, { rx: number; tx: number }>>();
    for (const u of usage) {
      if (!perServer.has(u.server_id)) perServer.set(u.server_id, new Map());
      perServer.get(u.server_id)!.set(u.day, { rx: Number(u.rx), tx: Number(u.tx) });
    }

    const dayTotals = new Map<string, { bytes: number; traffic_cost: number; ip_cost: number; rent: number; total: number }>();
    for (const d of days) dayTotals.set(d, { bytes: 0, traffic_cost: 0, ip_cost: 0, rent: 0, total: 0 });

    for (const r of rows) {
      const own = perServer.get(r.id) ?? new Map<string, { rx: number; tx: number }>();
      // همه روزهای ماه به computeDailyCosts داده می‌شوند تا سهمیه تجمعی
      // درست حساب شود، ولی فقط روزهای گذشته در خروجی جمع می‌شوند.
      const series = allDays.map((day) => ({ day, rx: own.get(day)?.rx ?? 0, tx: own.get(day)?.tx ?? 0 }));
      const costs = computeDailyCosts({
        days: series,
        ipCount: r.ip_count,
        rent: r.rent,
        rates: r.rates,
        daysInMonth,
      });

      for (const c of costs) {
        const bucket = dayTotals.get(c.day);
        if (!bucket) continue; // روز آینده
        bucket.bytes += c.billable_bytes;
        bucket.traffic_cost += c.traffic_cost;
        bucket.ip_cost += c.ip_cost;
        bucket.rent += c.rent;
        bucket.total += c.total;
      }
    }

    const dayRows = days.map((d) => ({
      day: d,
      label: formatJalaliDay(d),
      ...(dayTotals.get(d) ?? { bytes: 0, traffic_cost: 0, ip_cost: 0, rent: 0, total: 0 }),
    }));

    const today = dayRows[dayRows.length - 1] ?? null;
    const elapsedTotal = dayRows.reduce((a, d) => a + d.total, 0);

    if (url.searchParams.get('format') === 'csv') {
      return csvResponse(period, rows, dayRows);
    }

    return ok({
      period: { key: period.key, label: period.label, from: period.from, to: period.to },
      months: months.map((m) => ({ key: m.key, label: m.label })),
      calendar,
      rows,
      byDatacenter,
      grand,
      days: dayRows,
      today,
      elapsedTotal,
      daysInMonth,
      daysElapsed: days.length,
    });
  });
}

function csvResponse(
  period: Period,
  rows: BillingRow[],
  days: { label: string; bytes: number; traffic_cost: number; ip_cost: number; rent: number; total: number }[],
) {
  const lines: string[] = [];
  const n = (v: number) => Math.round(v).toString();

  lines.push(`گزارش هزینه — ${period.label}`);
  lines.push('');
  lines.push('سرور,آی‌پی اصلی,دیتاسنتر,ترافیک محاسبه‌شده (ترابایت),ترافیک رایگان (ترابایت),ترابایت قابل پرداخت,هزینه ترافیک (تومان),تعداد آی‌پی,آی‌پی قابل پرداخت,هزینه آی‌پی (تومان),اجاره (تومان),جمع (تومان)');
  for (const r of rows) {
    lines.push([
      r.name,
      r.main_ip,
      r.datacenter_name ?? '',
      r.cost.used_tb.toFixed(3),
      r.cost.included_tb.toFixed(3),
      r.cost.billable_tb.toFixed(3),
      n(r.cost.traffic_cost),
      r.ip_count,
      r.cost.billable_ips,
      n(r.cost.ip_cost),
      n(r.cost.rent),
      n(r.cost.total),
    ].join(','));
  }

  lines.push('');
  lines.push('روز,ترافیک (بایت),هزینه ترافیک (تومان),سهم آی‌پی (تومان),سهم اجاره (تومان),جمع روز (تومان)');
  for (const d of days) {
    lines.push([d.label, Math.round(d.bytes), n(d.traffic_cost), n(d.ip_cost), n(d.rent), n(d.total)].join(','));
  }

  // BOM لازم است وگرنه اکسل فارسی را خراب نشان می‌دهد
  const body = '﻿' + lines.join('\r\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="billing-${period.key}.csv"`,
    },
  });
}
