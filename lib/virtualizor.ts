/**
 * آداپتور ای‌پی‌آی ادمین ویژالیزور.
 *
 * چرا همه‌چیز در یک فایل جمع شده: قرارداد ای‌پی‌آی ویژالیزور بین نسخه‌ها
 * فرق می‌کند و اینجا جایی است که اگر چیزی نخواند باید عوض شود. هیچ‌جای
 * دیگری مستقیم با ویژالیزور حرف نمی‌زند.
 *
 * کلید و رمز در .env می‌مانند نه در جدول settings — آن جدول در پنل نمایش
 * داده می‌شود و راز نباید آنجا برود.
 *
 * هشدار عملیاتی: این ای‌پی‌آی روی پنل واقعی می‌نویسد. هر تابعی که تغییر
 * می‌دهد نامش با «write» شروع می‌شود و بدون تأیید صریح صدا زده نمی‌شود.
 */

export interface VzIp {
  /** شناسه داخلی ویژالیزور */
  ipid: string;
  ip: string;
  /** شناسه وی‌پی‌اسی که این آدرس به آن تخصیص یافته؛ «۰» یعنی آزاد */
  vpsid: string;
  ippoolid: string;
  locked: boolean;
}

export interface VzResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** پاسخ خام — برای وقتی که قرارداد نمی‌خواند و باید ببینیم چه آمده */
  raw?: string;
}

function config() {
  const url = (process.env.VIRTUALIZOR_URL || '').replace(/\/+$/, '');
  const key = process.env.VIRTUALIZOR_API_KEY || '';
  const pass = process.env.VIRTUALIZOR_API_PASS || '';
  return { url, key, pass, ready: Boolean(url && key && pass) };
}

export function virtualizorConfigured(): boolean {
  return config().ready;
}

/**
 * یک فراخوانی به ویژالیزور.
 *
 * ویژالیزور گواهی خودامضا دارد و روی پورت ۴۰۸۵ است. اگر گواهی معتبر
 * نباشد fetch رد می‌کند؛ VIRTUALIZOR_INSECURE=true آن را نادیده می‌گیرد.
 * فقط برای شبکه داخلی یا تونل — روی اینترنت باز نگذارید.
 */
async function vzCall<T>(
  act: string,
  params: Record<string, string> = {},
  body?: Record<string, string>,
): Promise<VzResult<T>> {
  const c = config();
  if (!c.ready) {
    return { ok: false, error: 'اتصال ویژالیزور تنظیم نشده است (VIRTUALIZOR_URL و کلید و رمز)' };
  }

  const qs = new URLSearchParams({
    act,
    api: 'json',
    apikey: c.key,
    apipass: c.pass,
    ...params,
  });

  try {
    const res = await fetch(`${c.url}/index.php?${qs.toString()}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
      body: body ? new URLSearchParams(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // ویژالیزور هنگام خطای احراز هویت صفحه ورود اچ‌تی‌ام‌ال برمی‌گرداند،
      // نه جیسون. بدون این پیام، فقط «خطای پارس» می‌دیدید.
      const hint = text.includes('<html')
        ? 'پاسخ اچ‌تی‌ام‌ال آمد نه جیسون — معمولاً یعنی کلید یا رمز ای‌پی‌آی اشتباه است'
        : 'پاسخ جیسون نبود';
      return { ok: false, error: hint, raw: text.slice(0, 400) };
    }

    const obj = parsed as { error?: unknown };
    if (obj && obj.error) {
      const detail =
        typeof obj.error === 'string' ? obj.error : JSON.stringify(obj.error).slice(0, 300);
      return { ok: false, error: `ویژالیزور: ${detail}`, raw: text.slice(0, 400) };
    }

    return { ok: true, data: parsed as T, raw: text.slice(0, 400) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `ارتباط با ویژالیزور برقرار نشد: ${msg}` };
  }
}

/** تبدیل شکل پاسخ ویژالیزور به فهرست ساده */
function normalizeIps(data: unknown): VzIp[] {
  const bag = (data as { ips?: Record<string, Record<string, unknown>> })?.ips;
  if (!bag || typeof bag !== 'object') return [];
  const out: VzIp[] = [];
  for (const [ipid, row] of Object.entries(bag)) {
    const ip = String(row?.ip ?? '').trim();
    if (!ip) continue;
    out.push({
      ipid: String(row?.ipid ?? ipid),
      ip,
      vpsid: String(row?.vpsid ?? '0'),
      ippoolid: String(row?.ippoolid ?? ''),
      locked: String(row?.locked ?? '0') === '1',
    });
  }
  return out;
}

/**
 * فهرست آی‌پی‌ها.
 *
 * صفحه‌بندی اجباری است: با هزاران آدرس، یک درخواست بی‌حد یا تایم‌اوت
 * می‌شود یا پاسخ چند مگابایتی می‌دهد.
 */
export async function listIps(opts: { poolId?: string; page?: number; perPage?: number } = {}) {
  const perPage = Math.min(Math.max(opts.perPage ?? 500, 1), 1000);
  const params: Record<string, string> = {
    page: String(opts.page ?? 1),
    reslen: String(perPage),
  };
  if (opts.poolId) params.ippoolid = opts.poolId;

  const res = await vzCall<unknown>('ips', params);
  if (!res.ok) return { ok: false as const, error: res.error, raw: res.raw };
  return { ok: true as const, ips: normalizeIps(res.data), raw: res.raw };
}

/** همه صفحه‌ها را می‌گیرد تا وقتی صفحه‌ای خالی برگردد */
export async function listAllIps(opts: { poolId?: string; maxPages?: number } = {}) {
  const maxPages = opts.maxPages ?? 40;
  const all: VzIp[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    const res = await listIps({ poolId: opts.poolId, page, perPage: 500 });
    if (!res.ok) return { ok: false as const, error: res.error, ips: all, raw: res.raw };
    if (!res.ips.length) break;

    let fresh = 0;
    for (const row of res.ips) {
      if (seen.has(row.ip)) continue;
      seen.add(row.ip);
      all.push(row);
      fresh++;
    }
    // اگر صفحه چیز تازه‌ای نداشت، صفحه‌بندی کار نمی‌کند و ادامه یعنی حلقه
    // بی‌پایان روی همان داده
    if (fresh === 0) break;
    if (res.ips.length < 500) break;
  }

  return { ok: true as const, ips: all };
}

/** پیکربندی فعلی یک وی‌پی‌اس — پیش از هر تغییری لازم است */
export async function getVps(vpsid: string) {
  const res = await vzCall<unknown>('editvs', { vpsid });
  if (!res.ok) return { ok: false as const, error: res.error, raw: res.raw };
  return { ok: true as const, data: res.data as Record<string, unknown>, raw: res.raw };
}

/**
 * تغییر فهرست آی‌پی‌های یک وی‌پی‌اس.
 *
 * چرا اینقدر محتاط: «editvs» کل پیکربندی وی‌پی‌اس را می‌گیرد، نه فقط
 * آی‌پی‌ها. اگر فیلدی فرستاده نشود ممکن است به پیش‌فرض برگردد — یعنی
 * یک اشتباه اینجا می‌تواند رم، دیسک یا شبکه یک وی‌پی‌اس واقعی را عوض کند.
 *
 * پس: پیکربندی فعلی خوانده می‌شود، فقط «ips» جایگزین می‌شود، و بقیه
 * دست‌نخورده پس فرستاده می‌شود. در حالت آزمایشی چیزی فرستاده نمی‌شود و
 * بدنه دقیق برگردانده می‌شود تا پیش از اجرای واقعی دیده شود.
 */
export async function writeVpsIps(
  vpsid: string,
  ips: string[],
  opts: { dryRun?: boolean } = {},
): Promise<VzResult<{ sent: Record<string, string>; before: string[]; after: string[] }>> {
  if (!/^\d+$/.test(vpsid)) return { ok: false, error: 'شناسه وی‌پی‌اس نامعتبر است' };

  const current = await getVps(vpsid);
  if (!current.ok) return { ok: false, error: current.error, raw: current.raw };

  const vps = (current.data?.vps ?? current.data) as Record<string, unknown> | undefined;
  if (!vps || typeof vps !== 'object') {
    return {
      ok: false,
      error: 'پیکربندی وی‌پی‌اس خوانده نشد — ساختار پاسخ ویژالیزور با انتظار نمی‌خواند',
      raw: current.raw,
    };
  }

  const before = Array.isArray(vps.ips)
    ? (vps.ips as unknown[]).map(String)
    : Object.values((vps.ips as Record<string, unknown>) || {}).map(String);

  // فقط فیلدهای ساده پس فرستاده می‌شوند. آرایه‌ها و اشیای تودرتو کنار
  // گذاشته می‌شوند چون شکل درست ارسالشان مطمئن نیست و فرستادن غلطشان
  // بدتر از نفرستادن است.
  const sent: Record<string, string> = { editvs: '1', vpsid };
  for (const [k, v] of Object.entries(vps)) {
    if (k === 'ips') continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue;
    sent[k] = String(v);
  }

  const body: Record<string, string> = { ...sent };
  ips.forEach((ip, i) => {
    body[`ips[${i}]`] = ip;
  });

  if (opts.dryRun) {
    return { ok: true, data: { sent: body, before, after: ips } };
  }

  const res = await vzCall<unknown>('editvs', { vpsid }, body);
  if (!res.ok) return { ok: false, error: res.error, raw: res.raw };

  return { ok: true, data: { sent: body, before, after: ips }, raw: res.raw };
}
