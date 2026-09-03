import { query, queryOne } from '@/lib/db';
import { fail, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ارتباط ایجنت لنگر با پنل.
 *
 * آی‌پی بیکار به هیچ ماشینی وصل نیست و از هیچ‌جا به پینگ جواب نمی‌دهد — پس
 * وضعیت اکسسش قابل سنجش نیست. ایجنت لنگر روی سروری که ادمین معرفی کرده
 * اجرا می‌شود، فهرست آی‌پی‌های سپرده به آن سرور را می‌گیرد و رویش بایند
 * می‌کند تا زنده شوند.
 *
 * احراز با همان agent_token سروری است که در پنل ثبت شده — کلید تازه‌ای
 * لازم نیست و ادمین همان توکن صفحه سرور را می‌دهد.
 */

async function authServer(req: Request): Promise<{ id: number } | null> {
  const url = new URL(req.url);
  const token = (req.headers.get('x-agent-token') || url.searchParams.get('token') || '').trim();
  if (!token) return null;
  return queryOne<{ id: number }>(
    `SELECT id FROM servers WHERE agent_token = $1 AND is_active`,
    [token],
  );
}

/** فهرست آی‌پی‌هایی که باید روی این سرور بایند باشند */
export async function GET(req: Request) {
  const server = await authServer(req);
  if (!server) return fail('توکن نامعتبر است', 403);

  // گیت‌وی هم می‌رود: ایجنت با آن تست می‌کند که آدرس واقعاً روت شده یا نه
  const ips = await query<{ ip: string; prefix: number; gateway: string | null }>(
    `SELECT host(i.ip) AS ip, i.bind_prefix AS prefix,
            host(COALESCE(i.gateway, n.gateway)) AS gateway
       FROM ip_addresses i
       LEFT JOIN ip_subnets n ON n.id = i.subnet_id
      WHERE i.bind_server_id = $1 AND i.access_watch AND i.version = 4
      ORDER BY i.ip`,
    [server.id],
  );

  // «ips» رشته ساده می‌ماند تا ایجنت‌های قدیمی‌تر هم کار کنند؛ پرفیکس در
  // فهرست جدا می‌آید و ایجنت تازه از آن استفاده می‌کند
  return ok({
    ips: ips.map((r) => r.ip),
    addresses: ips.map((r) => ({
      ip: r.ip,
      prefix: Number(r.prefix) || 32,
      gateway: r.gateway || null,
    })),
    interval: 300,
  });
}

interface BindResult {
  ip?: string;
  bound?: boolean;
  /** آیا با آدرس اصلی سرور هم‌ساب‌نت است — برای تشخیص بلوک روت‌نشده */
  same_subnet?: boolean | null;
  /** پینگ به گیت‌وی با مبدأ همین آدرس جواب گرفت؟ اثبات واقعی روت‌بودن */
  routed?: boolean | null;
  error?: string;
}

/** گزارش نتیجه بایند */
export async function POST(req: Request) {
  try {
    const server = await authServer(req);
    if (!server) return fail('توکن نامعتبر است', 403);

    const body = await readJson<{ results?: BindResult[] }>(req);
    const results = Array.isArray(body.results) ? body.results : [];

    for (const r of results) {
      const ipText = String(r.ip ?? '').trim();
      if (!ipText) continue;
      await query(
        `UPDATE ip_addresses
            SET bind_ok = $2, bind_at = now(), bind_error = $3,
                bind_same_subnet = $5, bind_routed = $6
          WHERE ip = $1::inet AND bind_server_id = $4`,
        [
          ipText,
          r.bound === true,
          String(r.error ?? '').trim() || null,
          server.id,
          typeof r.same_subnet === 'boolean' ? r.same_subnet : null,
          typeof r.routed === 'boolean' ? r.routed : null,
        ],
      ).catch((e) => console.error('[bind] به‌روزرسانی آی‌پی ناموفق:', e.message));
    }

    return ok({ ok: true, updated: results.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'خطای ناشناخته';
    console.error('[bind]', message);
    return fail(`ثبت نتیجه بایند انجام نشد: ${message}`, 500);
  }
}
