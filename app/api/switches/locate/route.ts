import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * «این آی‌پی یا MAC روی کدام پورت است؟»
 *
 *   ?q=10.0.0.5            آی‌پی: از جدول ARP همه سوییچ‌ها به MAC، بعد به پورت
 *   ?q=aa:bb:cc / aabb.cc  MAC کامل یا تکه‌ای از آن (حداقل چهار رقم)
 *   ?switch_id=            همه MACهای یک سوییچ با آی‌پی و سرورشان
 *   ?port_id=              همان، فقط برای یک پورت
 *
 * یک MAC روی چند پورت دیده می‌شود: پورت لبه‌ای که دستگاه به آن وصل است و
 * همه آپلینک‌های مسیر. پورت با کمترین تعداد MAC اول می‌آید — همان لبه.
 *
 * MACها از آخرین خواندن جدول سوییچ است (هر پنج دقیقه، حداکثر پنجاه مورد
 * برای هر پورت). آپلینک با هزار MAC برای این جست‌وجو کامل نیست و لازم هم
 * نیست.
 */

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);
    const raw = (url.searchParams.get('q') ?? '').trim();
    const switchId = url.searchParams.has('switch_id') ? idParam(url, 'switch_id') : null;
    if (url.searchParams.has('switch_id') && switchId === null) return fail('سوییچ نامعتبر است', 400);
    const portId = url.searchParams.has('port_id') ? idParam(url, 'port_id') : null;
    if (url.searchParams.has('port_id') && portId === null) return fail('پورت نامعتبر است', 400);

    let ipFilter: string | null = null;
    let macFilter: string | null = null;
    if (raw) {
      if (IPV4.test(raw)) {
        ipFilter = raw;
      } else {
        const hex = raw.toLowerCase().replace(/[^0-9a-f]/g, '');
        if (hex.length < 4 || hex.length > 12 || /[^0-9a-f:.\-\s]/i.test(raw)) {
          return fail('آی‌پی (مثل 10.0.0.5) یا MAC (حداقل چهار رقم هگز) وارد کنید', 400);
        }
        macFilter = hex;
      }
    } else if (switchId === null && portId === null) {
      return fail('عبارت جست‌وجو را وارد کنید', 400);
    }

    const rows = await query(
      `WITH arp AS (
         SELECT DISTINCT ON (mac) mac, ip, seen_at FROM switch_arp ORDER BY mac, seen_at DESC
       )
       SELECT w.id AS switch_id, w.name AS switch_name, p.id AS port_id, p.name AS port,
              p.description, p.mac_count, p.is_protected, p.member_of,
              m.mac, m.vlan, host(a.ip) AS ip, a.seen_at AS ip_seen_at,
              COALESCE(si.id, sm.id)     AS server_id,
              COALESCE(si.name, sm.name) AS server_name,
              p.server_id AS port_server_id
         FROM switch_ports p
         JOIN switches w ON w.id = p.switch_id
        CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(p.macs, '[]'::jsonb)) AS m(mac text, vlan text)
         LEFT JOIN arp a           ON a.mac = m.mac
         LEFT JOIN ip_addresses ia ON ia.ip = a.ip
         LEFT JOIN servers si      ON si.id = ia.server_id
         LEFT JOIN servers sm      ON sm.main_ip = a.ip AND si.id IS NULL
        WHERE w.is_active AND p.is_present
          AND ($1::int IS NULL OR w.id = $1)
          AND ($2::inet IS NULL OR a.ip = $2::inet)
          AND ($3::text IS NULL OR replace(m.mac, ':', '') LIKE '%' || $3 || '%')
          AND ($4::int IS NULL OR p.id = $4)
        ORDER BY ${raw ? 'p.mac_count NULLS LAST, w.name, p.name' : 'p.name, m.mac'}
        LIMIT 1000`,
      [switchId, ipFilter, macFilter, portId],
    );

    // آی‌پی‌ای که در ARP هست ولی MACش روی هیچ پورتی دیده نشده
    let arpOnly = null;
    if (ipFilter && !rows.length) {
      arpOnly = await query(
        `SELECT host(a.ip) AS ip, a.mac, a.interface, a.seen_at, w.name AS switch_name
           FROM switch_arp a JOIN switches w ON w.id = a.switch_id
          WHERE a.ip = $1::inet ORDER BY a.seen_at DESC LIMIT 5`,
        [ipFilter],
      );
    }
    return ok({ rows, arpOnly });
  });
}
