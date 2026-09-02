import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { currentMonth, type Calendar } from '@/lib/period';
import { fetchBillingRows } from '@/lib/billing-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DIRECTIONS = ['total', 'out', 'in', 'max'];

/** فهرست دیتاسنترها با شمارش سرور و هزینه دوره جاری */
export async function GET() {
  return handle(async () => {
    await requireUser();

    const calendar = ((await getSetting('traffic_calendar', 'jalali')) as Calendar) || 'jalali';
    const period = currentMonth(calendar);

    const datacenters = await query(
      `SELECT d.id, d.name, d.country, d.city, d.website, d.contact,
              d.price_per_tb::float8 AS price_per_tb,
              d.price_per_ip::float8 AS price_per_ip,
              d.included_tb::float8  AS included_tb,
              d.included_ips, d.billing_direction, d.tb_base,
              d.notes, d.is_active, d.created_at
         FROM datacenters d
        ORDER BY d.is_active DESC, d.name`,
    );

    // هزینه دوره جاری، گروه‌شده بر اساس دیتاسنتر
    const rows = await fetchBillingRows(period.from, period.to);
    const totals = new Map<number | string, {
      servers: number; up: number; down: number; ips: number;
      billable_bytes: number; traffic_cost: number; ip_cost: number; rent: number; total: number;
    }>();

    for (const r of rows) {
      const key = r.datacenter_id ?? 'none';
      const t = totals.get(key) ?? {
        servers: 0, up: 0, down: 0, ips: 0,
        billable_bytes: 0, traffic_cost: 0, ip_cost: 0, rent: 0, total: 0,
      };
      t.servers += 1;
      if (r.status === 'up') t.up += 1;
      if (r.status === 'down') t.down += 1;
      t.ips += r.ip_count;
      t.billable_bytes += r.cost.billable_bytes;
      t.traffic_cost += r.cost.traffic_cost;
      t.ip_cost += r.cost.ip_cost;
      t.rent += r.cost.rent;
      t.total += r.cost.total;
      totals.set(key, t);
    }

    const empty = {
      servers: 0, up: 0, down: 0, ips: 0,
      billable_bytes: 0, traffic_cost: 0, ip_cost: 0, rent: 0, total: 0,
    };

    const withTotals = datacenters.map((d) => ({
      ...d,
      stats: totals.get(Number(d.id)) ?? empty,
    }));

    return ok({
      datacenters: withTotals,
      unassigned: totals.get('none') ?? empty,
      period: { label: period.label, from: period.from, to: period.to },
    });
  });
}

/** افزودن دیتاسنتر */
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const b = await readJson<Record<string, unknown>>(req);

    const name = String(b.name ?? '').trim();
    if (!name) return fail('نام دیتاسنتر را وارد کنید', 400);

    const direction = String(b.billing_direction ?? 'total');
    if (!DIRECTIONS.includes(direction)) return fail('مبنای ترافیک نامعتبر است', 400);

    const tbBase = Number(b.tb_base) === 1024 ? 1024 : 1000;

    const dup = await queryOne('SELECT id FROM datacenters WHERE lower(name) = lower($1)', [name]);
    if (dup) return fail('دیتاسنتری با همین نام از قبل ثبت شده است', 409);

    const row = await queryOne<{ id: number }>(
      `INSERT INTO datacenters
         (name, country, city, website, contact,
          price_per_tb, price_per_ip, included_tb, included_ips,
          billing_direction, tb_base, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        name,
        String(b.country ?? '').trim() || null,
        String(b.city ?? '').trim() || null,
        String(b.website ?? '').trim() || null,
        String(b.contact ?? '').trim() || null,
        Number(b.price_per_tb) || 0,
        Number(b.price_per_ip) || 0,
        Number(b.included_tb) || 0,
        Number.isFinite(Number(b.included_ips)) ? Math.round(Number(b.included_ips)) : 1,
        direction,
        tbBase,
        String(b.notes ?? '').trim() || null,
      ],
    );

    return ok({ id: row?.id }, { status: 201 });
  });
}
