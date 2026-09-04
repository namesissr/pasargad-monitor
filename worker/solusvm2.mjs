import { logErr } from './db.mjs';

/**
 * کلاینت ای‌پی‌آی سولوس‌وی‌ام ۲.
 *
 * همان قرارداد کلاینت ویژالیزور را برمی‌گرداند تا موتور کشف مشترک بماند.
 *
 * قرارداد از مشخصات رسمی خود نصب گرفته شده
 * (storage/api-docs/api-docs.json)، نه حدس:
 *
 *   GET    /api/v1/ip_blocks                 فهرست بلوک‌ها
 *   GET    /api/v1/ip_blocks/{id}/ips        آدرس‌های ثبت‌شده هر بلوک
 *   POST   /api/v1/servers/{id}/ips          { ip, type, delayed }
 *   DELETE /api/v1/servers/{id}/ips          { ids: [...], delayed }
 *
 * احراز هویت: هدر «Authorization: Bearer <token>».
 */

const PER_PAGE = 100;

/** یک فراخوانی خواندنی */
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
 * «is_reserved» به‌تنهایی معادل «locked» نیست — این را اول اشتباه ترجمه
 * کردم. عنوان رسمی این اندپوینت «List All Reserved IP Addresses» است:
 * در سولوس هر آدرس ثبت‌شده در بلوک «reserved» است، از جمله آدرسی که همین
 * حالا روی یک سرور نشسته. با ترجمه غلط، تقریبا همه آدرس‌ها «قفل» حساب
 * می‌شدند و هیچ‌کدام وارد چرخه نمی‌شدند.
 *
 * معادل درست «قفل»: آدرسی که رزرو شده ولی به هیچ سروری تخصیص نیافته —
 * یعنی ادمین عمدا کنارش گذاشته.
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
        locked: r.is_reserved === true && !server,
        // آی‌پی اصلی سرور؛ برداشتنش شبکه لنگر را قطع می‌کند
        isPrimary: r.is_primary === true,
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

/** یک درخواست تغییردهنده — جدا از get تا هر فراخوانی نوشتن آشکار باشد */
async function send(node, method, path, body) {
  const base = String(node.url || '').replace(/\/+$/, '');
  const token = String(node.api_key || '').trim();
  if (!base || !token) return { ok: false, error: 'آدرس یا توکن نود سولوس تنظیم نشده است' };

  try {
    const res = await fetch(`${base}/api/v1/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* بدنه خالی برای ۲۰۴ طبیعی است */
    }

    if (!res.ok) {
      const msg = parsed?.message || parsed?.error || `کد ${res.status}`;
      return { ok: false, error: `سولوس: ${msg}`, status: res.status };
    }
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: `ارتباط با مستر سولوس برقرار نشد: ${err.message}` };
  }
}

/**
 * چسباندن و برداشتن آی‌پی روی وی‌پی‌اس لنگر.
 *
 * برخلاف ویژالیزور که کل پیکربندی را یکجا پس می‌فرستد، سولوس دو عملیات
 * جدا دارد و این امن‌تر است — هیچ فیلد دیگری از وی‌پی‌اس لمس نمی‌شود:
 *
 *   POST   /servers/{id}/ips    { ip, type: 'IPv4', delayed: false }
 *   DELETE /servers/{id}/ips    { ids: [...], delayed: false }
 *
 * موتور مشترک فهرست نهایی را می‌دهد؛ تفاوتش با وضعیت فعلی همین‌جا حساب
 * می‌شود.
 *
 * سه محافظ:
 *
 *   • آی‌پی اصلی سرور هرگز برداشته نمی‌شود. برداشتنش شبکه خود لنگر را
 *     قطع می‌کند و کل چرخه را می‌خواباند.
 *   • چسباندن یکی‌یکی است (قرارداد سولوس: «ip» با «count > 1» جمع
 *     نمی‌شود)، پس سقف هر اجرا رعایت می‌شود تا صف مستر پر نشود.
 *   • شکست یک آدرس بقیه را متوقف نمی‌کند ولی شمرده و گزارش می‌شود.
 */
export async function writeVpsIps(node, vpsid, ips, { dryRun = true } = {}) {
  const serverId = String(vpsid || '').trim();
  if (!/^\d+$/.test(serverId)) return { ok: false, error: 'شناسه سرور لنگر نامعتبر است' };

  const all = await listIps(node);
  if (!all.ok) return { ok: false, error: all.error };

  const onAnchor = all.items.filter((r) => r.vpsid === serverId);
  const want = new Set(ips);

  const toAttach = ips.filter((ip) => !onAnchor.some((r) => r.ip === ip));
  const toDetach = onAnchor.filter((r) => !want.has(r.ip));

  // آی‌پی اصلی لنگر هرگز برداشته نمی‌شود
  const primaries = toDetach.filter((r) => r.isPrimary).map((r) => r.ip);
  const detachable = toDetach.filter((r) => !r.isPrimary && r.ipid);

  const cap = Math.min(Math.max(Number(node.max_per_run) || 200, 1), 1000);
  const attachSlice = toAttach.slice(0, cap);

  const sent = {
    attach: attachSlice,
    detach: detachable.map((r) => r.ip),
    skippedPrimary: primaries,
    over_cap: Math.max(0, toAttach.length - attachSlice.length),
  };

  if (dryRun) {
    return { ok: true, dryRun: true, sent, before: onAnchor.map((r) => r.ip), after: ips };
  }

  const failed = [];

  if (detachable.length) {
    const res = await send(node, 'DELETE', `servers/${serverId}/ips`, {
      ids: detachable.map((r) => Number(r.ipid)),
      delayed: false,
    });
    if (!res.ok) failed.push(`برداشتن ${detachable.length} آدرس: ${res.error}`);
  }

  for (const ip of attachSlice) {
    const res = await send(node, 'POST', `servers/${serverId}/ips`, {
      ip,
      type: 'IPv4',
      delayed: false,
    });
    if (!res.ok) failed.push(`${ip}: ${res.error}`);
  }

  if (failed.length) {
    logErr(`نود ${node.name}: ${failed.length} عملیات ناموفق —`, failed.slice(0, 5).join(' | '));
    // شکست جزئی باید دیده شود، نه اینکه موفقیت گزارش شود
    return {
      ok: false,
      error: `${failed.length} از ${attachSlice.length + (detachable.length ? 1 : 0)} عملیات ناموفق: ${failed[0]}`,
      sent,
    };
  }

  return { ok: true, dryRun: false, sent, before: onAnchor.map((r) => r.ip), after: ips };
}
