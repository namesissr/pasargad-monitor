import { query, queryOne } from '@/lib/db';
import { requireCustomer } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { getSettings } from '@/lib/settings';
import { currentMonth } from '@/lib/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * داده پرتال مشتری.
 *
 * قاعده‌ای که در تمام این فایل رعایت می‌شود: شناسه مشتری **فقط** از توکن
 * نشست می‌آید و در هر کوئری شرط می‌شود. هیچ پارامتری از درخواست تعیین
 * نمی‌کند داده چه کسی برگردد — وگرنه هر مشتری با عوض‌کردن یک عدد داده
 * بقیه را می‌دید.
 *
 * چیزهایی که عمدا برنمی‌گردند: قیمت تمام‌شده، هزینه ماهانه، نام
 * دیتاسنتر، توکن ایجنت، و یادداشت‌های داخلی. مشتری مصرف و سلامت سرور
 * خودش را می‌بیند، نه اقتصاد ما را.
 */
export async function GET() {
  return handle(async () => {
    const { customerId, session } = await requireCustomer();

    const s = await getSettings();
    const period = currentMonth(s.traffic_calendar === 'gregorian' ? 'gregorian' : 'jalali');

    const customer = await queryOne<{ name: string; company: string | null }>(
      `SELECT name, company FROM customers WHERE id = $1 AND is_active`,
      [customerId],
    );

    const servers = await query(
      `SELECT s.id, s.name, s.hostname, host(s.main_ip) AS main_ip, s.status,
              s.port_mbps,
              -- ترافیک پیش‌خرید: مشتری باید همان عددی را ببیند که مبنای
              -- هشدارها و صورتحساب است، وگرنه فکر می‌کند خریدش ثبت نشده.
              tp.purchased::float8                 AS traffic_purchased_gb,
              (tp.used_bytes / 1073741824 + s.traffic_used_before_gb)::float8
                AS traffic_used_gb,
              (tp.purchased - tp.used_bytes / 1073741824 - s.traffic_used_before_gb)::float8
                AS traffic_balance_gb,
              s.location, s.last_seen_at, s.renews_at,
              m.cpu_percent::float8       AS cpu_percent,
              -- نام ستون در جدول ram_* است نه mem_*. رابط پرتال mem_*
              -- می‌خواند، پس همین‌جا نام‌گردانی می‌شود.
              m.ram_used_bytes::float8    AS mem_used_bytes,
              m.ram_total_bytes::float8   AS mem_total_bytes,
              m.disk_used_bytes::float8   AS disk_used_bytes,
              m.disk_total_bytes::float8  AS disk_total_bytes,
              m.rx_bps::float8            AS rx_bps,
              m.tx_bps::float8            AS tx_bps,
              m.uptime_sec::float8        AS uptime_sec,
              COALESCE(t.rx, 0)::float8   AS period_rx,
              COALESCE(t.tx, 0)::float8   AS period_tx,
              COALESCE(ipc.cnt, 0)::int   AS ip_count
         FROM servers s
         LEFT JOIN LATERAL (
           SELECT * FROM server_metrics sm WHERE sm.server_id = s.id
            ORDER BY sm.ts DESC LIMIT 1
         ) m ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(rx_bytes) AS rx, SUM(tx_bytes) AS tx
             FROM server_metrics_daily d
            WHERE d.server_id = s.id AND d.day BETWEEN $2::date AND $3::date
         ) t ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS cnt FROM ip_addresses i WHERE i.server_id = s.id
         ) ipc ON TRUE
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
        WHERE s.customer_id = $1 AND s.is_active
        ORDER BY s.name`,
      [customerId, period.from, period.to],
    );

    return ok({
      customer: { name: customer?.name ?? session.username, company: customer?.company ?? null },
      period: { label: period.label, from: period.from, to: period.to },
      servers,
    });
  });
}
