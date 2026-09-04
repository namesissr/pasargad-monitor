import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** فهرست بلوک‌های آی‌پی با شمارش وضعیت آدرس‌های داخلشان */
export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();

    // همان تفکیک فهرست آی‌پی‌ها. یک سی‌آی‌دی‌آر می‌تواند در دو هایپروایزر
    // باشد و هرکدام ردیف خودش را دارد؛ بدون این فیلتر، هر دو در فهرست
    // می‌آیند و تشخیصشان سخت است.
    const hv = new URL(req.url).searchParams.get('hv') || 'all';
    const params: unknown[] = [];
    let hvClause = '';
    if (hv === 'none') {
      hvClause = 'WHERE n.vz_node_id IS NULL';
    } else if (hv === 'virtualizor' || hv === 'solusvm2') {
      params.push(hv);
      hvClause = `WHERE vn.kind = $${params.length}`;
    } else if (/^\d+$/.test(hv)) {
      params.push(Number(hv));
      hvClause = `WHERE n.vz_node_id = $${params.length}`;
    }

    const rows = await query(
      `SELECT n.id, n.cidr::text AS cidr, n.version, host(n.gateway) AS gateway,
              n.provider, n.location, n.label, n.notes, n.created_at,
              n.anchor_id, a.name AS anchor_name, a.node_id AS anchor_node_id,
              n.vz_total_ips, n.vz_poolid, vn.name AS node_name, vn.kind AS node_kind,
              -- ظرفیت واقعی بلوک، از روی خود سی‌آی‌دی‌آر. به هیچ فیلدی از
              -- هایپروایزر وابسته نیست، پس همیشه عددی برای مقایسه هست —
              -- حتی وقتی آن فیلد نیامده یا شکلش عوض شده.
              CASE
                WHEN family(n.cidr) <> 4 THEN NULL
                WHEN masklen(n.cidr) >= 31 THEN (2 ^ (32 - masklen(n.cidr)))::int
                ELSE (2 ^ (32 - masklen(n.cidr)))::int - 2
              END AS capacity,
              COALESCE(c.total, 0)::int    AS total,
              COALESCE(c.assigned, 0)::int AS assigned,
              COALESCE(c.free, 0)::int     AS free,
              COALESCE(c.blocked, 0)::int  AS blocked,
              COALESCE(f.cnt, 0)::int      AS foreign_count
         FROM ip_subnets n
         LEFT JOIN vz_anchors a ON a.id = n.anchor_id
         LEFT JOIN vz_nodes vn ON vn.id = n.vz_node_id
         LEFT JOIN LATERAL (
           -- شمارش فقط آدرس‌های همان هایپروایزری که بلوک به آن تعلق دارد.
           --
           -- یک سی‌آی‌دی‌آر می‌تواند در دو هایپروایزر تعریف شده باشد، و چون
           -- ستون cidr یکتاست هر دو در یک ردیف می‌نشینند. بدون این شرط،
           -- شمارش هر دو را جمع می‌کرد و با هیچ‌کدام نمی‌خواند.
           SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE status = 'assigned') AS assigned,
                  COUNT(*) FILTER (WHERE status = 'free')     AS free,
                  COUNT(*) FILTER (WHERE status IN ('blocked','abuse')) AS blocked
             FROM ip_addresses i
            WHERE i.subnet_id = n.id
              AND (n.vz_node_id IS NULL OR i.vz_node_id IS NOT DISTINCT FROM n.vz_node_id)
         ) c ON TRUE
         LEFT JOIN LATERAL (
           -- آدرس‌هایی که در همین بلوک‌اند ولی از هایپروایزر دیگری آمده‌اند
           -- یا پیوندشان پاک شده. اختلاف شمارش از همین‌جاست و باید دیده
           -- شود، نه اینکه در جمع کل گم شود.
           SELECT COUNT(*) AS cnt FROM ip_addresses i
            WHERE i.subnet_id = n.id
              AND n.vz_node_id IS NOT NULL
              AND i.vz_node_id IS DISTINCT FROM n.vz_node_id
         ) f ON TRUE
        ${hvClause}
        ORDER BY n.cidr, vn.name NULLS FIRST`,
      params,
    );
    return ok({ subnets: rows });
  });
}

/** ثبت بلوک بدون باز کردن آدرس‌ها — مناسب نسخه ۶ */
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const b = await readJson<Record<string, unknown>>(req);
    const cidr = String(b.cidr ?? '').trim();
    if (!cidr) return fail('بلوک آی‌پی را وارد کنید', 400);

    const row = await queryOne<{ id: number }>(
      `INSERT INTO ip_subnets (cidr, version, gateway, provider, location, label, notes)
       VALUES ($1::cidr, CASE WHEN $1::text LIKE '%:%' THEN 6 ELSE 4 END,
               NULLIF($2, '')::inet, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''))
       ON CONFLICT (cidr) WHERE vz_node_id IS NULL DO UPDATE SET
         gateway  = COALESCE(EXCLUDED.gateway, ip_subnets.gateway),
         provider = COALESCE(EXCLUDED.provider, ip_subnets.provider),
         location = COALESCE(EXCLUDED.location, ip_subnets.location),
         label    = COALESCE(EXCLUDED.label, ip_subnets.label),
         notes    = COALESCE(EXCLUDED.notes, ip_subnets.notes)
       RETURNING id`,
      [
        cidr,
        String(b.gateway ?? '').trim(),
        String(b.provider ?? '').trim(),
        String(b.location ?? '').trim(),
        String(b.label ?? '').trim(),
        String(b.notes ?? '').trim(),
      ],
    ).catch(() => {
      throw new Error('قالب بلوک درست نیست. نمونه درست: 185.1.2.0/24');
    });

    return ok({ id: row?.id }, { status: 201 });
  });
}

/** تعیین لنگر یک بلوک — آدرس‌هایش لنگرشان را از همین می‌گیرند */
export async function PATCH(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<{ id?: number; anchor_id?: number | null }>(req);
    const id = Number(body.id);
    if (!Number.isInteger(id)) return fail('شناسه بلوک نامعتبر است', 400);

    const anchorId = body.anchor_id ? Number(body.anchor_id) : null;
    if (anchorId !== null && !Number.isInteger(anchorId)) {
      return fail('لنگر نامعتبر است', 400);
    }

    await query('UPDATE ip_subnets SET anchor_id = $2 WHERE id = $1', [id, anchorId]);

    // آدرس‌هایی که لنگر دستی ندارند، لنگر بلوکشان را می‌گیرند. بدون این،
    // تغییر لنگر بلوک تا کشف بعدی روی آدرس‌ها اثر نمی‌کرد.
    await query(
      `UPDATE ip_addresses SET anchor_id = $2, updated_at = now()
        WHERE subnet_id = $1 AND anchor_id IS DISTINCT FROM $2`,
      [id, anchorId],
    );

    return ok({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id)) return fail('شناسه بلوک نامعتبر است', 400);

    // آدرس‌ها می‌مانند و فقط ارجاعشان به بلوک خالی می‌شود
    await query('DELETE FROM ip_subnets WHERE id = $1', [id]);
    return ok({ ok: true });
  });
}
