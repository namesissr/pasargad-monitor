import { logErr } from './db.mjs';

/**
 * کلاینت ای‌پی‌آی سولوس‌وی‌ام ۲.
 *
 * همان قرارداد کلاینت ویژالیزور را برمی‌گرداند تا موتور کشف مشترک بماند.
 *
 * وضعیت فعلی: **فقط خواندن**. تخصیص و برداشتن آی‌پی هنوز فعال نیست، چون
 * شکل بدنه «POST /servers/{id}/ips» قطعی نشده و آزمودنش روی مستر واقعی
 * که سرور مشتری دارد پذیرفتنی نیست. writeVpsIps صریح خطا برمی‌گرداند تا
 * هیچ نوشتنی نصفه‌کاره انجام نشود.
 *
 * مسیرهای تأییدشده روی نصب واقعی:
 *   GET /api/v1/ip_blocks                 فهرست بلوک‌ها
 *   GET /api/v1/ip_blocks/{id}/ips        آدرس‌های هر بلوک
 *   GET /api/v1/compute_resources         نودها
 *   GET /api/v1/servers                   سرورها
 *
 * احراز هویت: هدر «Authorization: Bearer <token>».
 */

const PER_PAGE = 100;

/** یک فراخوانی — فقط متد GET؛ نوشتن عمداً پیاده نشده */
async function get(node, path, params = {}) {
  const base = String(node.url || '').replace(/\/+$/, '');
  const token = String(node.api_key || '').trim();
  if (!base || !token) return { ok: false, error: 'آدرس یا توکن نود سولوس تنظیم نشده است' };

  const qs = new URLSearchParams(params);
  const url = `${base}/api/v1/${path}${qs.toString() ? `?${qs}` : ''}`;

  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(45_000),
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // سولوس برای مسیر ناشناخته صفحه اپ را برمی‌گرداند، نه جیسون. بدون
      // این تفکیک، «آدرس اشتباه» و «توکن اشتباه» یک شکل دیده می‌شدند.
      const hint = text.includes('<!doctype') || text.includes('<html')
        ? 'پاسخ صفحه وب بود نه جیسون — آدرس مستر یا مسیر درست نیست'
        : `پاسخ جیسون نبود (کد ${res.status})`;
      return { ok: false, error: hint, raw: text.slice(0, 200) };
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `توکن پذیرفته نشد (کد ${res.status})`, raw: text.slice(0, 200) };
    }
    if (!res.ok) {
      const msg = parsed?.message || `کد ${res.status}`;
      return { ok: false, error: `سولوس: ${msg}`, raw: text.slice(0, 200) };
    }

    return { ok: true, data: parsed, raw: text.slice(0, 300) };
  } catch (err) {
    return { ok: false, error: `ارتباط با مستر سولوس برقرار نشد: ${err.message}` };
  }
}

/**
 * صفحه‌بندی.
 *
 * شرط توقف روی تعداد رکورد است نه فقط meta: اگر روزی شکل meta عوض شود،
 * حلقه باید همچنان تمام شود، نه اینکه تا سقف صفحه بچرخد.
 */
async function paged(node, path, params = {}, maxPages = 200) {
  const out = [];
  let raw = null;
  let topKeys = null;

  for (let page = 1; page <= maxPages; page++) {
    const res = await get(node, path, { ...params, page: String(page), per_page: String(PER_PAGE) });
    if (!res.ok) return { ok: false, error: res.error, items: out, raw: res.raw };

    if (page === 1) {
      raw = res.raw;
      topKeys = res.data && typeof res.data === 'object' ? Object.keys(res.data) : [];
    }

    const batch = Array.isArray(res.data?.data) ? res.data.data : [];
    out.push(...batch);
    if (batch.length < PER_PAGE) break;

    const last = Number(res.data?.meta?.last_page);
    if (Number.isFinite(last) && page >= last) break;
  }

  return { ok: true, items: out, raw, topKeys };
}

const str = (v, fallback = '') => (v === null || v === undefined ? fallback : String(v));

function isIpv4(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** بلوک‌های آی‌پی؛ همان قرارداد listPools ویژالیزور */
export async function listPools(node) {
  const res = await paged(node, 'ip_blocks');
  if (!res.ok) return res;

  const items = res.items
    .map((b) => ({
      poolid: str(b.id),
      name: str(b.name),
      gateway: str(b.gateway).trim(),
      netmask: str(b.netmask).trim(),
      isV6: str(b.type).toLowerCase() === 'ipv6',
    }))
    .filter((b) => b.poolid && !b.isV6 && isIpv4(b.gateway));

  return { ok: true, items, rawCount: res.items.length, raw: res.raw, topKeys: res.topKeys };
}

/**
 * آدرس‌های همه بلوک‌ها.
 *
 * برخلاف ویژالیزور، فهرست یکجای آی‌پی وجود ندارد؛ هر بلوک جدا خوانده
 * می‌شود. هر ردیف خودش سرور، مالک و بلوکش را دارد، پس نام مشتری بدون
 * فراخوانی جداگانه ساخته می‌شود.
 *
 * «is_reserved» معادل «locked» ویژالیزور است: آدرسی که ادمین عمدا کنار
 * گذاشته و نباید وارد چرخه شود.
 */
export async function listIps(node) {
  const blocks = await listPools(node);
  if (!blocks.ok) return { ok: false, error: blocks.error, items: [], raw: blocks.raw };

  const items = [];
  let rawCount = 0;
  let firstRaw = null;
  const failed = [];

  for (const block of blocks.items) {
    const res = await paged(node, `ip_blocks/${block.poolid}/ips`);
    if (!res.ok) {
      // یک بلوک خراب نباید کل کشف را متوقف کند، ولی باید دیده شود
      failed.push(`${block.name || block.poolid}: ${res.error}`);
      continue;
    }
    if (firstRaw === null) firstRaw = res.raw;
    rawCount += res.items.length;

    for (const r of res.items) {
      const ip = str(r.ip).trim();
      if (!isIpv4(ip)) continue;
      const server = r.server || null;
      const user = r.user || null;
      items.push({
        ipid: str(r.id),
        ip,
        vpsid: server ? str(server.id) : '0',
        ippoolid: block.poolid,
        poolName: block.name,
        gateway: block.gateway,
        netmask: block.netmask,
        poolServerId: '',
        isV6: false,
        locked: r.is_reserved === true,
        // مالک و نام سرور مستقیم از همین ردیف می‌آید
        hostname: server ? str(server.name) : '',
        customer: user ? str(user.email) : '',
      });
    }
  }

  if (failed.length) {
    logErr(`نود ${node.name}: خواندن آی‌پی این بلوک‌ها ناموفق بود —`, failed.slice(0, 5).join(' | '));
  }

  return { ok: true, items, rawCount, raw: firstRaw, topKeys: blocks.topKeys };
}

/**
 * سرورها و کاربران لازم نیستند: ردیف آی‌پی خودش هر دو را دارد.
 * فهرست خالی برمی‌گردانند تا موتور مشترک بدون تغییر کار کند.
 */
export async function listVpses() {
  return { ok: true, items: [], rawCount: 0 };
}

export async function listUsers() {
  return { ok: true, items: [], rawCount: 0 };
}

/**
 * تخصیص آی‌پی به سرور — هنوز فعال نیست.
 *
 * مسیرها معلوم‌اند (POST و DELETE روی servers/{id}/ips) ولی شکل بدنه
 * قطعی نشده. یک بار با بدنه خالی امتحان شد و به‌جای خطای اعتبارسنجی، یک
 * کار واقعی روی سرور صف کرد. روی مستری که سرور مشتری دارد، آزمون‌وخطا
 * پذیرفتنی نیست.
 *
 * تا وقتی قرارداد از روی کد خود سولوس تأیید نشده، اینجا صریح خطا
 * برمی‌گرداند — نه اینکه چیزی نصفه بفرستد.
 */
export async function writeVpsIps() {
  return {
    ok: false,
    error:
      'تخصیص خودکار آی‌پی برای سولوس‌وی‌ام ۲ هنوز فعال نیست. کشف و پایش کار می‌کنند؛ ' +
      'چسباندن و برداشتن آی‌پی فعلا باید دستی در سولوس انجام شود.',
  };
}
