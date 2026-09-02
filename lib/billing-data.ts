import { query } from './db';
import { computeMonthCost, effectiveRates, type MonthCost, type Rates } from './billing';

/**
 * خواندن ورودی‌های محاسبه هزینه از دیتابیس.
 *
 * از lib/billing.ts جداست چون آن فایل محاسبه خالص است و کامپوننت‌های
 * کلاینت هم برچسب‌هایش را ایمپورت می‌کنند؛ نباید به دیتابیس گره بخورد.
 *
 * ترافیک از جدول تجمیع روزانه می‌آید. حسابداری هرگز نباید از نمونه خام
 * بخواند: نمونه‌های خام بعد از هفت روز پاک می‌شوند و صورتحساب ماه قبل
 * ناگهان صفر می‌شد.
 */

export interface BillingRow {
  id: number;
  name: string;
  main_ip: string;
  status: string;
  datacenter_id: number | null;
  datacenter_name: string | null;
  rx: number;
  tx: number;
  ip_count: number;
  rent: number;
  rates: Rates;
  cost: MonthCost;
}

interface RawRow {
  id: number;
  name: string;
  main_ip: string;
  status: string;
  rent: number | null;
  datacenter_id: number | null;
  datacenter_name: string | null;
  dc_price_per_tb: number | null;
  dc_price_per_ip: number | null;
  dc_included_tb: number | null;
  dc_included_ips: number | null;
  billing_direction: string | null;
  tb_base: number | null;
  s_price_per_tb: number | null;
  s_price_per_ip: number | null;
  s_included_tb: number | null;
  s_included_ips: number | null;
  rx: number;
  tx: number;
  ip_count: number;
}

const SQL = `
SELECT
  s.id, s.name, host(s.main_ip) AS main_ip, s.status,
  s.monthly_cost::float8       AS rent,
  s.datacenter_id,
  d.name                       AS datacenter_name,
  d.price_per_tb::float8       AS dc_price_per_tb,
  d.price_per_ip::float8       AS dc_price_per_ip,
  d.included_tb::float8        AS dc_included_tb,
  d.included_ips               AS dc_included_ips,
  d.billing_direction,
  d.tb_base,
  s.price_per_tb::float8       AS s_price_per_tb,
  s.price_per_ip::float8       AS s_price_per_ip,
  s.included_tb::float8        AS s_included_tb,
  s.included_ips               AS s_included_ips,
  COALESCE(t.rx, 0)::float8    AS rx,
  COALESCE(t.tx, 0)::float8    AS tx,
  COALESCE(ipc.cnt, 0)::int    AS ip_count
FROM servers s
LEFT JOIN datacenters d ON d.id = s.datacenter_id
LEFT JOIN LATERAL (
  SELECT SUM(rx_bytes) AS rx, SUM(tx_bytes) AS tx
    FROM server_metrics_daily md
   WHERE md.server_id = s.id AND md.day BETWEEN $1::date AND $2::date
) t ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt FROM ip_addresses i WHERE i.server_id = s.id
) ipc ON TRUE
`;

/** ردیف‌های هزینه یک دوره، با نرخ مؤثر و مبلغ محاسبه‌شده */
export async function fetchBillingRows(
  from: string,
  to: string,
  opts: { datacenterId?: number | null; serverId?: number | null; includeInactive?: boolean } = {},
): Promise<BillingRow[]> {
  const where: string[] = [];
  const params: unknown[] = [from, to];

  if (!opts.includeInactive) where.push('s.is_active');
  if (opts.datacenterId) {
    params.push(opts.datacenterId);
    where.push(`s.datacenter_id = $${params.length}`);
  }
  if (opts.serverId) {
    params.push(opts.serverId);
    where.push(`s.id = $${params.length}`);
  }

  const rows = await query<RawRow>(
    SQL + (where.length ? ` WHERE ${where.join(' AND ')}` : '') + ' ORDER BY d.name NULLS LAST, s.name',
    params,
  );

  return rows.map((r) => {
    const rates = effectiveRates(
      {
        price_per_tb: r.s_price_per_tb,
        price_per_ip: r.s_price_per_ip,
        included_tb: r.s_included_tb,
        included_ips: r.s_included_ips,
      },
      {
        price_per_tb: r.dc_price_per_tb ?? 0,
        price_per_ip: r.dc_price_per_ip ?? 0,
        included_tb: r.dc_included_tb ?? 0,
        included_ips: r.dc_included_ips ?? 1,
        billing_direction: (r.billing_direction as Rates['billing_direction']) ?? 'total',
        tb_base: r.tb_base ?? 1000,
      },
    );

    const cost = computeMonthCost({
      rx: r.rx,
      tx: r.tx,
      ipCount: r.ip_count,
      rent: r.rent ?? 0,
      rates,
    });

    return {
      id: r.id,
      name: r.name,
      main_ip: r.main_ip,
      status: r.status,
      datacenter_id: r.datacenter_id,
      datacenter_name: r.datacenter_name,
      rx: r.rx,
      tx: r.tx,
      ip_count: r.ip_count,
      rent: r.rent ?? 0,
      rates,
      cost,
    };
  });
}

/** مصرف روزانه یک سرور در بازه — برای شکست روزانه هزینه */
export async function fetchDailyUsage(
  serverId: number,
  from: string,
  to: string,
): Promise<{ day: string; rx: number; tx: number }[]> {
  return query<{ day: string; rx: number; tx: number }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day,
            rx_bytes::float8 AS rx,
            tx_bytes::float8 AS tx
       FROM server_metrics_daily
      WHERE server_id = $1 AND day BETWEEN $2::date AND $3::date
      ORDER BY day`,
    [serverId, from, to],
  );
}

/** مصرف روزانه مجموع چند سرور — برای نمای «همه سرورها» */
export async function fetchDailyUsageGrouped(
  from: string,
  to: string,
  opts: { datacenterId?: number | null } = {},
): Promise<{ server_id: number; day: string; rx: number; tx: number }[]> {
  const params: unknown[] = [from, to];
  let clause = '';
  if (opts.datacenterId) {
    params.push(opts.datacenterId);
    clause = ` AND s.datacenter_id = $${params.length}`;
  }
  return query<{ server_id: number; day: string; rx: number; tx: number }>(
    `SELECT md.server_id,
            to_char(md.day, 'YYYY-MM-DD') AS day,
            md.rx_bytes::float8 AS rx,
            md.tx_bytes::float8 AS tx
       FROM server_metrics_daily md
       JOIN servers s ON s.id = md.server_id
      WHERE md.day BETWEEN $1::date AND $2::date AND s.is_active${clause}
      ORDER BY md.day`,
    params,
  );
}
