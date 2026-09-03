import { logErr } from './db.mjs';

/**
 * کلاینت ای‌پی‌آی ادمین ویژالیزور.
 *
 * تنها پیاده‌سازی در کل پروژه است — عمداً. این ای‌پی‌آی روی پنل واقعی
 * می‌نویسد و دو نسخه از یک عملیات مخرب دیر یا زود از هم واگرا می‌شوند.
 * اپ وب فقط درخواست در صف می‌گذارد؛ همه کار اینجا انجام می‌شود.
 *
 * قرارداد ویژالیزور بین نسخه‌ها فرق می‌کند. اگر چیزی نخواند، اینجا جایی
 * است که باید عوض شود.
 */

/** یک فراخوانی به یک نود */
async function call(node, act, params = {}, body) {
  const base = String(node.url || '').replace(/\/+$/, '');
  if (!base || !node.api_key || !node.api_pass) {
    return { ok: false, error: 'اطلاعات اتصال نود ناقص است' };
  }

  const qs = new URLSearchParams({
    act,
    api: 'json',
    apikey: node.api_key,
    apipass: node.api_pass,
    ...params,
  });

  try {
    const res = await fetch(`${base}/index.php?${qs.toString()}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
      body: body ? new URLSearchParams(body) : undefined,
      signal: AbortSignal.timeout(45_000),
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // ویژالیزور هنگام خطای احراز هویت صفحه ورود اچ‌تی‌ام‌ال می‌دهد نه
      // جیسون. ولی «کلید اشتباه» تنها علت نیست و حدس‌زدن وقت می‌گیرد،
      // پس نشانه‌های قابل تشخیص جدا می‌شوند و بریده‌ای از پاسخ هم
      // برمی‌گردد تا در پنل دیده شود.
      let hint;
      const lower = text.toLowerCase();
      if (res.status === 404) {
        hint = 'مسیر پیدا نشد (۴۰۴) — آدرس نود درست نیست';
      } else if (lower.includes('login') || lower.includes('username')) {
        hint =
          'صفحه ورود برگشت — یا کلید و رمز ای‌پی‌آی اشتباه است، یا آی‌پی سرور پنل ' +
          'در فهرست مجاز ای‌پی‌آی نیست، یا این آدرس پنل کاربر است نه پنل ادمین (پورت ۴۰۸۵)';
      } else if (lower.includes('<html')) {
        hint = 'پاسخ اچ‌تی‌ام‌ال آمد نه جیسون (کد ' + res.status + ')';
      } else {
        hint = 'پاسخ جیسون نبود (کد ' + res.status + ')';
      }
      // برچسب‌های اچ‌تی‌ام‌ال حذف می‌شوند تا بریده خوانا باشد
      const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return { ok: false, error: hint + ' — پاسخ: ' + plain.slice(0, 160), raw: text.slice(0, 300) };
    }

    if (parsed && parsed.error) {
      const detail =
        typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error).slice(0, 300);
      return { ok: false, error: `ویژالیزور: ${detail}`, raw: text.slice(0, 300) };
    }

    return { ok: true, data: parsed, raw: text.slice(0, 300) };
  } catch (err) {
    return { ok: false, error: `ارتباط با نود برقرار نشد: ${err.message}` };
  }
}

/**
 * ویژالیزور مجموعه‌ها را گاهی آرایه و گاهی شیء کلیددار برمی‌گرداند.
 * این تفاوت بین نسخه‌ها و حتی بین اندپوینت‌ها هست.
 */
function rows(bag) {
  if (!bag) return [];
  if (Array.isArray(bag)) return bag.filter((x) => x && typeof x === 'object');
  if (typeof bag === 'object') return Object.values(bag).filter((x) => x && typeof x === 'object');
  return [];
}

const str = (v, fallback = '') => (v === null || v === undefined ? fallback : String(v));

/** صفحه‌بندی عمومی — بدون آن، نود با هزاران آدرس یا تایم‌اوت می‌دهد یا پاسخ چندمگابایتی */
async function paged(node, act, key, extra = {}, maxPages = 60) {
  const out = [];
  const seen = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const res = await call(node, act, { ...extra, page: String(page), reslen: '500' });
    if (!res.ok) return { ok: false, error: res.error, items: out };

    const batch = rows(res.data?.[key]);
    if (!batch.length) break;

    let fresh = 0;
    for (const row of batch) {
      // شناسه یکتای هر نوع رکورد؛ اگر نبود، کل ردیف
      const id = str(row.ipid ?? row.vpsid ?? row.uid ?? row.ippoolid ?? JSON.stringify(row));
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(row);
      fresh++;
    }

    // اگر صفحه چیز تازه‌ای نداشت، صفحه‌بندی کار نمی‌کند و ادامه یعنی حلقه
    // بی‌پایان روی همان داده
    if (fresh === 0) break;
    if (batch.length < 500) break;
  }

  return { ok: true, items: out };
}

export async function listIps(node) {
  const res = await paged(node, 'ips', 'ips');
  if (!res.ok) return res;
  return {
    ok: true,
    items: res.items
      .map((r) => ({
        ipid: str(r.ipid),
        ip: str(r.ip).trim(),
        vpsid: str(r.vpsid, '0'),
        ippoolid: str(r.ippoolid),
        locked: str(r.locked) === '1',
      }))
      .filter((r) => r.ip),
  };
}

export async function listPools(node) {
  const res = await paged(node, 'ippool', 'ippools');
  if (!res.ok) return res;
  return {
    ok: true,
    items: res.items
      .map((r) => ({
        poolid: str(r.ippid ?? r.ippoolid),
        name: str(r.ippool_name ?? r.name),
        gateway: str(r.gateway).trim(),
        netmask: str(r.netmask).trim(),
        firstip: str(r.firstip).trim(),
      }))
      .filter((r) => r.poolid),
  };
}

export async function listVpses(node) {
  const res = await paged(node, 'vs', 'vs');
  if (!res.ok) return res;
  return {
    ok: true,
    items: res.items
      .map((r) => ({
        vpsid: str(r.vpsid),
        hostname: str(r.hostname).trim(),
        uid: str(r.uid),
      }))
      .filter((r) => r.vpsid),
  };
}

export async function listUsers(node) {
  const res = await paged(node, 'users', 'users');
  if (!res.ok) return res;
  return {
    ok: true,
    items: res.items
      .map((r) => ({
        uid: str(r.uid),
        email: str(r.email).trim(),
        name: str(r.name ?? r.fname).trim(),
      }))
      .filter((r) => r.uid),
  };
}

/**
 * تغییر فهرست آی‌پی‌های یک وی‌پی‌اس.
 *
 * چرا اینقدر محتاط: «editvs» کل پیکربندی را می‌گیرد نه فقط آی‌پی‌ها. اگر
 * فیلدی جا بیفتد ممکن است به پیش‌فرض برگردد — یعنی یک اشتباه اینجا
 * می‌تواند رم یا دیسک یک وی‌پی‌اس واقعی را عوض کند.
 *
 * پس پیکربندی فعلی خوانده می‌شود، فقط «ips» جایگزین می‌شود، و بقیه
 * دست‌نخورده پس فرستاده می‌شود. در حالت آزمایشی چیزی فرستاده نمی‌شود.
 */
export async function writeVpsIps(node, vpsid, ips, { dryRun = true } = {}) {
  if (!/^\d+$/.test(String(vpsid))) return { ok: false, error: 'شناسه وی‌پی‌اس نامعتبر است' };

  const current = await call(node, 'editvs', { vpsid: String(vpsid) });
  if (!current.ok) return current;

  const vps = current.data?.vps ?? current.data;
  if (!vps || typeof vps !== 'object') {
    return {
      ok: false,
      error: 'پیکربندی وی‌پی‌اس خوانده نشد — ساختار پاسخ با انتظار نمی‌خواند',
      raw: current.raw,
    };
  }

  const before = rows(vps.ips).length ? rows(vps.ips).map(str) : Object.values(vps.ips || {}).map(str);

  const sent = { editvs: '1', vpsid: String(vpsid) };
  for (const [k, v] of Object.entries(vps)) {
    if (k === 'ips') continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue;
    sent[k] = String(v);
  }
  ips.forEach((ip, i) => {
    sent[`ips[${i}]`] = ip;
  });

  if (dryRun) return { ok: true, dryRun: true, sent, before, after: ips };

  const res = await call(node, 'editvs', { vpsid: String(vpsid) }, sent);
  if (!res.ok) {
    logErr('نوشتن آی‌پی روی وی‌پی‌اس ناموفق:', vpsid, res.error);
    return res;
  }
  return { ok: true, dryRun: false, sent, before, after: ips };
}
