import { query, queryOne } from '@/lib/db';
import { generateAgentToken, requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** مدیریت دیدبان‌ها از پنل */
export async function GET() {
  return handle(async () => {
    await requireUser();
    const probes = await query(
      `SELECT id, name, location, token, last_seen_at, is_active, created_at
         FROM probes ORDER BY location DESC, name`,
    );
    return ok({ probes });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const b = await readJson<{ name?: string; location?: string }>(req);

    const name = String(b.name ?? '').trim();
    if (!name) return fail('نام دیدبان را وارد کنید', 400);

    const location = b.location === 'inside' ? 'inside' : 'outside';

    const row = await queryOne<{ id: number; token: string }>(
      `INSERT INTO probes (name, location, token) VALUES ($1, $2, $3) RETURNING id, token`,
      [name, location, generateAgentToken()],
    );

    return ok({ id: row?.id, token: row?.token }, { status: 201 });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id)) return fail('شناسه دیدبان نامعتبر است', 400);
    await query('DELETE FROM probes WHERE id = $1', [id]);
    return ok({ ok: true });
  });
}
