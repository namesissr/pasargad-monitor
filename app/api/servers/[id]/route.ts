import { query, queryOne } from '@/lib/db';
import { generateAgentToken, requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { currentMonth, lastYears, rangeOfLastDays, type Calendar } from '@/lib/period';
import { fetchBillingRows } from '@/lib/billing-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** فیلدهایی که با PATCH قابل تغییرند — کلید ستون، مقدار نوع تبدیل */
// «num» و «ref» نال را می‌پذیرند، چون خالی‌بودنشان معنا دارد:
// یعنی «از دیتاسنتر ارث ببر»، نه «صفر».
const EDITABLE: Record<string, 'text' | 'int' | 'bigint' | 'inet' | 'bool' | 'num' | 'ref'> = {
  name: 'text',
  hostname: 'text',
  main_ip: 'inet',
  ssh_port: 'int',
  provider: 'text',
  location: 'text',
  customer: 'text',
  port_mbps: 'int',
  traffic_quota_gb: 'bigint',
  monthly_cost: 'num',
  // قیمت فروش مشتری، جدا از monthly_cost که هزینه ماست
  renewal_price_toman: 'bigint',
  renewal_months: 'int',
  datacenter_id: 'ref',
  price_per_tb: 'num',
  price_per_ip: 'num',
  included_tb: 'num',
  included_ips: 'ref',
  notes: 'text',
  status: 'text',
  is_active: 'bool',
  is_monitor: 'bool',
  customer_id: 'int',
  renews_at: 'text',
  renew_notice_days: 'int',
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await requireUser();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return fail('شناسه سرور نامعتبر است', 400);

    const calendar = ((await getSetting('traffic_calendar', 'jalali')) as Calendar) || 'jalali';
    const month = currentMonth(calendar);
    const year = lastYears(1, calendar)[0];
    const last30 = rangeOfLastDays(30);
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const server = await queryOne(
      `SELECT s.id, s.name, s.hostname, host(s.main_ip) AS main_ip, s.ssh_port,
              s.provider, s.location, s.os, s.cpu_model, s.cpu_cores,
              s.ram_total_bytes::float8 AS ram_total_bytes,
              s.disk_total_bytes::float8 AS disk_total_bytes,
              s.port_mbps, s.traffic_quota_gb::float8 AS traffic_quota_gb,
              s.renewal_price_toman::float8 AS renewal_price_toman,
              s.renewal_months,
              to_char(s.traffic_counted_from, 'YYYY-MM-DD') AS traffic_counted_from,
              s.traffic_used_before_gb::float8     AS traffic_used_before_gb,
              tp.purchased::float8                 AS traffic_purchased_gb,
              (tp.used_bytes / 1073741824 + s.traffic_used_before_gb)::float8
                AS traffic_used_gb,
              (tp.purchased - tp.used_bytes / 1073741824 - s.traffic_used_before_gb)::float8
                AS traffic_balance_gb,
              s.monthly_cost::float8 AS monthly_cost, s.customer,
              s.datacenter_id, dc.name AS datacenter_name,
              s.price_per_tb::float8 AS price_per_tb,
              s.price_per_ip::float8 AS price_per_ip,
              s.included_tb::float8  AS included_tb,
              s.included_ips,
              s.agent_token, s.agent_version, s.net_iface, s.status, s.last_seen_at, s.boot_time,
              s.is_active, s.is_monitor, s.notes, s.created_at,
              s.customer_id, cu.name AS customer_name,
              s.renews_at, s.renew_notice_days,
              m.ts AS metric_ts, m.cpu_percent,
              m.ram_used_bytes::float8 AS ram_used_bytes,
              m.disk_used_bytes::float8 AS disk_used_bytes,
              m.swap_used_bytes::float8 AS swap_used_bytes,
              m.swap_total_bytes::float8 AS swap_total_bytes,
              m.load1, m.load5, m.load15,
              m.rx_bps::float8 AS rx_bps, m.tx_bps::float8 AS tx_bps,
              m.uptime_sec::float8 AS uptime_sec, m.process_count, m.tcp_conn_count
         FROM servers s
         LEFT JOIN datacenters dc ON dc.id = s.datacenter_id
         LEFT JOIN customers cu ON cu.id = s.customer_id
         LEFT JOIN LATERAL (
           SELECT * FROM server_metrics sm WHERE sm.server_id = s.id ORDER BY sm.ts DESC LIMIT 1
         ) m ON TRUE
         LEFT JOIN LATERAL (
           -- ترافیک پیش‌خرید: مجموع خریدها، و مصرف از تاریخ شروع شمارش.
           -- تاریخ تهی یعنی هنوز خریدی نبوده، پس مصرفی هم شمرده نمی‌شود.
           SELECT COALESCE((SELECT SUM(gb) FROM traffic_topups tt WHERE tt.server_id = s.id), 0)::float8
                    AS purchased,
                  COALESCE((SELECT SUM(d.rx_bytes) FROM server_metrics_daily d
                             WHERE d.server_id = s.id
                               AND s.traffic_counted_from IS NOT NULL
                               AND d.day >= s.traffic_counted_from), 0)::float8
                    AS used_bytes
         ) tp ON TRUE
        WHERE s.id = $1`,
      [id],
    );

    if (!server) return fail('سرور پیدا نشد', 404);

    const sum = async (from: string, to: string) =>
      (await queryOne<{ rx: number; tx: number }>(
        `SELECT COALESCE(SUM(rx_bytes),0)::float8 AS rx, COALESCE(SUM(tx_bytes),0)::float8 AS tx
           FROM server_metrics_daily WHERE server_id = $1 AND day BETWEEN $2::date AND $3::date`,
        [id, from, to],
      )) ?? { rx: 0, tx: 0 };

    const [dayT, monthT, yearT] = await Promise.all([
      sum(todayIso, todayIso),
      sum(month.from, month.to),
      sum(year.from, year.to),
    ]);

    const uptime = await queryOne<{ ratio: number | null; days: number }>(
      `SELECT AVG(uptime_ratio)::float8 AS ratio, COUNT(*)::int AS days
         FROM server_metrics_daily WHERE server_id = $1 AND day BETWEEN $2::date AND $3::date`,
      [id, last30.from, last30.to],
    );

    const ips = await query(
      `SELECT id, host(ip) AS ip, version, status, ptr, customer, is_monitored, ping_ok, ping_ms, last_ping_at
         FROM ip_addresses WHERE server_id = $1 ORDER BY ip`,
      [id],
    );

    const incidents = await query(
      `SELECT id, kind, severity, message, value, started_at, resolved_at, notified_at, ack_at
         FROM incidents WHERE server_id = $1 ORDER BY started_at DESC LIMIT 20`,
      [id],
    );

    // هزینه دوره جاری همین سرور، با همان منطقی که صفحه حسابداری دارد
    const billingRows = await fetchBillingRows(month.from, month.to, {
      serverId: id,
      includeInactive: true,
    });
    const billing = billingRows[0] ?? null;

    return ok({
      server,
      billing: billing ? { rates: billing.rates, cost: billing.cost } : null,
      traffic: {
        today: dayT,
        month: { ...monthT, label: month.label, from: month.from, to: month.to },
        year: { ...yearT, label: year.label },
      },
      uptime30: uptime?.ratio ?? null,
      uptimeDays: uptime?.days ?? 0,
      ips,
      incidents,
    });
  });
}

/** ویرایش سرور — فقط فیلدهای فرستاده‌شده تغییر می‌کنند */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await requireUser();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return fail('شناسه سرور نامعتبر است', 400);

    const body = await readJson<Record<string, unknown>>(req);
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, kind] of Object.entries(EDITABLE)) {
      if (!(key in body)) continue;
      const raw = body[key];
      let value: unknown;

      if (kind === 'int' || kind === 'bigint') {
        const n = Number(raw);
        if (!Number.isFinite(n)) return fail(`مقدار «${key}» باید عدد باشد`, 400);
        value = Math.round(n);
      } else if (kind === 'num' || kind === 'ref') {
        // خالی یعنی «تعیین‌نشده»، که با صفر فرق دارد
        if (raw === null || raw === undefined || raw === '') {
          value = null;
        } else {
          const n = Number(raw);
          if (!Number.isFinite(n) || n < 0) return fail(`مقدار «${key}» باید عدد مثبت باشد`, 400);
          value = kind === 'ref' ? Math.round(n) : n;
        }
      } else if (kind === 'bool') {
        value = Boolean(raw);
      } else {
        const s = String(raw ?? '').trim();
        value = s === '' ? null : s;
      }

      values.push(value);
      sets.push(kind === 'inet' ? `${key} = $${values.length}::inet` : `${key} = $${values.length}`);
    }

    if (!sets.length) return fail('هیچ فیلدی برای تغییر فرستاده نشده است', 400);

    values.push(id);
    const row = await queryOne<{ id: number }>(
      `UPDATE servers SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING id`,
      values,
    );

    if (!row) return fail('سرور پیدا نشد', 404);
    return ok({ ok: true });
  });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await requireUser();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return fail('شناسه سرور نامعتبر است', 400);

    const url = new URL(req.url);

    // پیش‌فرض: بایگانی. حذف کامل داده تاریخی را هم می‌برد، پس صریح خواسته شود.
    if (url.searchParams.get('hard') === '1') {
      await query('DELETE FROM servers WHERE id = $1', [id]);
      return ok({ ok: true, deleted: true });
    }

    await query(`UPDATE servers SET is_active = FALSE, status = 'unknown', updated_at = now() WHERE id = $1`, [id]);
    return ok({ ok: true, archived: true });
  });
}

/** ساخت توکن تازه برای ایجنت */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await requireUser();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return fail('شناسه سرور نامعتبر است', 400);

    const url = new URL(req.url);
    if (url.searchParams.get('action') !== 'rotate-token') {
      return fail('عملیات نامشخص است', 400);
    }

    const token = generateAgentToken();
    const row = await queryOne<{ agent_token: string }>(
      `UPDATE servers SET agent_token = $1, updated_at = now() WHERE id = $2 RETURNING agent_token`,
      [token, id],
    );
    if (!row) return fail('سرور پیدا نشد', 404);

    return ok({ agent_token: row.agent_token });
  });
}
