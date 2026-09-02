import { queryOne } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** بررسی سلامت برای داکر و انجین‌ایکس */
export async function GET() {
  try {
    await queryOne('SELECT 1 AS ok');
    return Response.json({ ok: true, db: true });
  } catch (err) {
    return Response.json(
      { ok: false, db: false, message: err instanceof Error ? err.message : 'خطای ناشناخته' },
      { status: 503 },
    );
  }
}
