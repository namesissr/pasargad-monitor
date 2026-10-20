import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/http';
import { maskConfig, maskLine } from '@/lib/config-mask';
import { diffHunks, diffLines, diffStats } from '@/lib/diff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * یک نسخه پیکربندی، و تفاوتش با نسخه دیگر.
 *
 *   ?reveal=1       رازها پوشیده نشوند
 *   ?compare=<id>   تفاوت با آن نسخه (پیش‌فرض: نسخه درست قبل از این)
 *   ?compare=none   بدون تفاوت
 *   ?download=1     فایل متنی برای دانلود
 *
 * تفاوت روی متن کامل حساب می‌شود و بعد هر خط پوشانده می‌شود؛ پس تغییر یک
 * گذرواژه به‌صورت خط حذف/اضافه دیده می‌شود بی‌آنکه خودش دیده شود.
 */
type ConfigRow = {
  id: number;
  switch_id: number;
  switch_name: string;
  taken_at: string;
  config: string;
  size_bytes: number;
  trigger: string;
  taken_by: string | null;
};

export async function GET(req: Request, { params }: { params: { id: string; cid: string } }) {
  return handle(async () => {
    await requireAdmin();
    const id = Number(params.id);
    const cid = Number(params.cid);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(cid) || cid <= 0) {
      return fail('شناسه نامعتبر است', 400);
    }
    const url = new URL(req.url);
    const reveal = url.searchParams.get('reveal') === '1';

    const row = await queryOne<ConfigRow>(
      `SELECT c.id, c.switch_id, w.name AS switch_name, c.taken_at, c.config, c.size_bytes, c.trigger, c.taken_by
         FROM switch_configs c JOIN switches w ON w.id = c.switch_id
        WHERE c.id = $1 AND c.switch_id = $2`,
      [cid, id],
    );
    if (!row) return fail('نسخه پیدا نشد', 404);

    const shown = reveal ? { text: row.config, masked: 0 } : maskConfig(row.config);

    if (url.searchParams.get('download') === '1') {
      const stamp = new Date(row.taken_at).toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const name = `${row.switch_name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'switch'}-${stamp}${reveal ? '' : '-masked'}.txt`;
      return new NextResponse(shown.text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${name}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const cmp = url.searchParams.get('compare');
    let other: Pick<ConfigRow, 'id' | 'taken_at' | 'config'> | null = null;
    if (cmp !== 'none') {
      const otherId = cmp ? Number(cmp) : null;
      if (otherId !== null && (!Number.isInteger(otherId) || otherId <= 0)) return fail('نسخه مقایسه نامعتبر است', 400);
      other = otherId
        ? await queryOne(`SELECT id, taken_at, config FROM switch_configs WHERE id = $1 AND switch_id = $2`, [otherId, id])
        : await queryOne(
            `SELECT id, taken_at, config FROM switch_configs
              WHERE switch_id = $1
                -- مقایسه در خود SQL: Date جاوااسکریپت میکروثانیه را می‌اندازد
                AND (taken_at, id) < (SELECT taken_at, id FROM switch_configs WHERE id = $2)
              ORDER BY taken_at DESC, id DESC LIMIT 1`,
            [id, row.id],
          );
      if (otherId && !other) return fail('نسخه مقایسه پیدا نشد', 404);
    }

    let diff = null;
    if (other) {
      // نسخه قدیم‌تر سمت چپ، هر کدام که انتخاب شده باشد
      const older = new Date(other.taken_at) <= new Date(row.taken_at);
      const lines = older ? diffLines(other.config, row.config) : diffLines(row.config, other.config);
      const visible = reveal ? lines : lines.map((l) => ({ ...l, text: maskLine(l.text).text }));
      diff = {
        against: { id: other.id, taken_at: other.taken_at, older },
        ...diffStats(lines),
        ...diffHunks(visible),
      };
    }

    return ok({
      version: {
        id: row.id,
        taken_at: row.taken_at,
        size_bytes: row.size_bytes,
        trigger: row.trigger,
        taken_by: row.taken_by,
      },
      config: shown.text,
      masked: shown.masked,
      revealed: reveal,
      diff,
    });
  });
}
