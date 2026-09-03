import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * باز کردن یک بلوک آی‌پی به تک‌تک آدرس‌ها.
 *
 * سقف عمدی /20 یعنی ۴۰۹۶ آدرس. بدون سقف، یک /8 اشتباهی شانزده میلیون ردیف
 * می‌سازد و دیتابیس را از کار می‌اندازد.
 *
 * آی‌پی نسخه ۶ باز نمی‌شود — یک /64 بیش از هجده کوینتیلیون آدرس دارد.
 * برای نسخه ۶ فقط بلوک ثبت می‌شود و آدرس‌های استفاده‌شده دستی اضافه می‌شوند.
 */

const MIN_MASK = 20;
const VALID_STATUS = ['free', 'assigned', 'reserved', 'blocked', 'abuse'];

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const b = await readJson<Record<string, unknown>>(req);

    const cidr = String(b.cidr ?? '').trim();
    if (!cidr) return fail('بلوک آی‌پی را وارد کنید، مثلا 185.1.2.0/24', 400);
    if (cidr.includes(':')) {
      return fail('باز کردن بلوک نسخه ۶ ممکن نیست. بلوک را ثبت کنید و آدرس‌های استفاده‌شده را دستی اضافه کنید.', 400);
    }

    const parsed = await queryOne<{ mask: number; net: string }>(
      `SELECT masklen($1::cidr) AS mask, network($1::cidr)::text AS net`,
      [cidr],
    ).catch(() => {
      throw new Error('قالب بلوک درست نیست. نمونه درست: 185.1.2.0/24');
    });

    if (!parsed) return fail('قالب بلوک درست نیست', 400);
    if (parsed.mask < MIN_MASK) {
      return fail(`بلوک بزرگ‌تر از /${MIN_MASK} پذیرفته نمی‌شود. آن را به بلوک‌های کوچک‌تر بشکنید.`, 400);
    }

    const status = VALID_STATUS.includes(String(b.status)) ? String(b.status) : 'free';
    const skipEdges = b.skip_edges !== false; // پیش‌فرض: آدرس شبکه و برادکست رد شوند
    const monitored = Boolean(b.is_monitored);

    // ثبت یا یافتن خود بلوک
    const subnet = await queryOne<{ id: number }>(
      `INSERT INTO ip_subnets (cidr, version, gateway, provider, location, label, notes)
       VALUES ($1::cidr, 4, NULLIF($2, '')::inet, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''))
       ON CONFLICT (cidr) DO UPDATE SET
         gateway  = COALESCE(EXCLUDED.gateway, ip_subnets.gateway),
         provider = COALESCE(EXCLUDED.provider, ip_subnets.provider),
         location = COALESCE(EXCLUDED.location, ip_subnets.location),
         label    = COALESCE(EXCLUDED.label, ip_subnets.label)
       RETURNING id`,
      [
        cidr,
        String(b.gateway ?? '').trim(),
        String(b.provider ?? '').trim(),
        String(b.location ?? '').trim(),
        String(b.label ?? '').trim(),
        String(b.notes ?? '').trim(),
      ],
    );

    const size = Math.pow(2, 32 - parsed.mask);
    const first = skipEdges && size > 2 ? 1 : 0;
    const last = skipEdges && size > 2 ? size - 2 : size - 1;

    const inserted = await query<{ cnt: number }>(
      `WITH added AS (
         INSERT INTO ip_addresses (ip, version, subnet_id, status, is_monitored)
         -- host() ماسک را جدا می‌کند. بدون آن آدرس به شکل «x.x.x.x/24»
         -- ذخیره می‌شود و «ip = 'x.x.x.x'::inet» هرگز مطابقت نمی‌کند،
         -- چون مقایسه inet ماسک را هم حساب می‌کند.
         SELECT host(network($1::cidr) + i)::inet, 4, $2, $3, $4
           FROM generate_series($5::bigint, $6::bigint) AS i
         ON CONFLICT (ip) DO NOTHING
         RETURNING 1
       )
       SELECT COUNT(*)::int AS cnt FROM added`,
      [cidr, subnet?.id ?? null, status, monitored, first, last],
    );

    return ok({
      subnet_id: subnet?.id ?? null,
      cidr,
      network: parsed.net,
      capacity: last - first + 1,
      added: inserted[0]?.cnt ?? 0,
      skipped_existing: (last - first + 1) - (inserted[0]?.cnt ?? 0),
    });
  });
}
