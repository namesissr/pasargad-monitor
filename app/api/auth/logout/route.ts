import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/session';
import { ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  cookies().set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return ok({ ok: true });
}
