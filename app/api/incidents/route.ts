import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { handle, num, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** تاریخچه قطعی‌ها و هشدارها */
export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);

    const openOnly = url.searchParams.get('open') === '1';
    const serverId = url.searchParams.get('server_id');
    const kind = url.searchParams.get('kind');
    const limit = Math.min(500, Math.max(10, num(url.searchParams.get('limit'), 100)));
    const page = Math.max(1, num(url.searchParams.get('page'), 1));

    const where: string[] = [];
    const p: unknown[] = [];

    if (openOnly) where.push('i.resolved_at IS NULL');
    if (serverId && serverId !== 'all') {
      p.push(Number(serverId));
      where.push(`i.server_id = $${p.length}`);
    }
    if (kind && kind !== 'all') {
      p.push(kind);
      where.push(`i.kind = $${p.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM incidents i ${clause}`,
      p,
    );

    p.push(limit, (page - 1) * limit);
    const rows = await query(
      `SELECT i.id, i.server_id, s.name AS server_name, host(s.main_ip) AS server_ip,
              i.ip_id, host(a.ip) AS ip,
              i.kind, i.severity, i.message, i.value,
              i.started_at, i.resolved_at, i.notified_at, i.ack_at,
              EXTRACT(EPOCH FROM (COALESCE(i.resolved_at, now()) - i.started_at))::int AS duration_sec
         FROM incidents i
         LEFT JOIN servers s      ON s.id = i.server_id
         LEFT JOIN ip_addresses a ON a.id = i.ip_id
         ${clause}
        ORDER BY i.started_at DESC
        LIMIT $${p.length - 1} OFFSET $${p.length}`,
      p,
    );

    const summary = await queryOne<{ open: number; today: number; week: number }>(
      `SELECT COUNT(*) FILTER (WHERE resolved_at IS NULL)::int AS open,
              COUNT(*) FILTER (WHERE started_at >= date_trunc('day', now()))::int AS today,
              COUNT(*) FILTER (WHERE started_at >= now() - interval '7 days')::int AS week
         FROM incidents`,
    );

    return ok({ incidents: rows, total: total?.cnt ?? 0, page, limit, summary });
  });
}
