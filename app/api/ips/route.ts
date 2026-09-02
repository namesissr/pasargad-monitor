import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, num, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUS = ['free', 'assigned', 'reserved', 'blocked', 'abuse'];

/** فهرست آی‌پی‌ها با فیلتر و صفحه‌بندی */
export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);

    const status = url.searchParams.get('status') || '';
    const serverId = url.searchParams.get('server_id') || '';
    const subnetId = url.searchParams.get('subnet_id') || '';
    const version = url.searchParams.get('version') || '';
    const search = (url.searchParams.get('q') || '').trim();
    const limit = Math.min(500, Math.max(10, num(url.searchParams.get('limit'), 100)));
    const page = Math.max(1, num(url.searchParams.get('page'), 1));

    const where: string[] = [];
    const p: unknown[] = [];

    if (status && VALID_STATUS.includes(status)) {
      p.push(status);
      where.push(`i.status = $${p.length}`);
    }
    if (serverId === 'none') {
      where.push('i.server_id IS NULL');
    } else if (serverId) {
      p.push(Number(serverId));
      where.push(`i.server_id = $${p.length}`);
    }
    if (subnetId) {
      p.push(Number(subnetId));
      where.push(`i.subnet_id = $${p.length}`);
    }
    if (version === '4' || version === '6') {
      p.push(Number(version));
      where.push(`i.version = $${p.length}`);
    }
    if (search) {
      p.push(`%${search}%`);
      where.push(
        `(host(i.ip) ILIKE $${p.length} OR i.ptr ILIKE $${p.length}
          OR i.customer ILIKE $${p.length} OR i.notes ILIKE $${p.length} OR s.name ILIKE $${p.length})`,
      );
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM ip_addresses i LEFT JOIN servers s ON s.id = i.server_id ${clause}`,
      p,
    );

    p.push(limit, (page - 1) * limit);
    const rows = await query(
      `SELECT i.id, host(i.ip) AS ip, i.version, i.status, i.customer, i.ptr, i.mac,
              i.is_monitored, i.ping_ok, i.ping_ms, i.last_ping_at, i.notes,
              i.server_id, s.name AS server_name,
              i.subnet_id, n.cidr::text AS subnet
         FROM ip_addresses i
         LEFT JOIN servers s   ON s.id = i.server_id
         LEFT JOIN ip_subnets n ON n.id = i.subnet_id
         ${clause}
        ORDER BY i.ip
        LIMIT $${p.length - 1} OFFSET $${p.length}`,
      p,
    );

    const stats = await query<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*)::int AS cnt FROM ip_addresses GROUP BY status`,
    );

    return ok({ ips: rows, total: total?.cnt ?? 0, page, limit, stats });
  });
}

/** افزودن یک یا چند آی‌پی — هر ردیف مستقل است و شکست یکی بقیه را متوقف نمی‌کند */
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const b = await readJson<Record<string, unknown>>(req);

    const raw = String(b.ips ?? b.ip ?? '').trim();
    if (!raw) return fail('حداقل یک آی‌پی وارد کنید', 400);

    const status = VALID_STATUS.includes(String(b.status)) ? String(b.status) : 'free';
    const serverId = b.server_id ? Number(b.server_id) : null;
    const subnetId = b.subnet_id ? Number(b.subnet_id) : null;
    const customer = String(b.customer ?? '').trim() || null;
    const monitored = Boolean(b.is_monitored);

    const list = raw
      .split(/[\s,،\n]+/)
      .map((x) => x.trim())
      .filter(Boolean);

    if (list.length > 2000) return fail('حداکثر ۲۰۰۰ آی‌پی در هر بار', 400);

    const added: string[] = [];
    const failed: { ip: string; reason: string }[] = [];

    for (const ip of list) {
      try {
        await query(
          `INSERT INTO ip_addresses (ip, version, subnet_id, server_id, status, customer, is_monitored)
           VALUES ($1::inet, CASE WHEN $1::text LIKE '%:%' THEN 6 ELSE 4 END, $2, $3, $4, $5, $6)
           ON CONFLICT (ip) DO UPDATE
             SET subnet_id = COALESCE(EXCLUDED.subnet_id, ip_addresses.subnet_id),
                 server_id = COALESCE(EXCLUDED.server_id, ip_addresses.server_id),
                 status    = EXCLUDED.status,
                 customer  = COALESCE(EXCLUDED.customer, ip_addresses.customer),
                 updated_at = now()`,
          [ip, subnetId, serverId, status, customer, monitored],
        );
        added.push(ip);
      } catch (err) {
        failed.push({ ip, reason: err instanceof Error ? err.message : 'خطای ناشناخته' });
      }
    }

    return ok({ added: added.length, failed }, { status: 201 });
  });
}
