import { createHash, randomInt } from 'node:crypto';
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

/**
 * ساخت پارامتر apikey، دقیقاً مثل اس‌دی‌کی رسمی ویژالیزور.
 *
 * از /usr/local/virtualizor/sdk/admin.php:
 *   $key    = generateRandStr(8)          رشته تصادفی هشت‌کاراکتری کوچک
 *   $apikey = $key . md5($pass . $key)
 *
 * سه پارامتر با هم فرستاده می‌شوند: adminapikey و adminapipass خام، و این
 * apikey محاسبه‌شده. فرستادن فقط دو تای اول کافی نیست — ویژالیزور با
 * ریدایرکت ۳۰۲ به صفحه ورود جواب می‌دهد، بدون هیچ پیامی که بگوید چرا.
 */
function makeApiKey(pass) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 8; i++) rand += alphabet[randomInt(alphabet.length)];
  return rand + createHash('md5').update(pass + rand).digest('hex');
}

/**
 * خواندن خروجی serialize پی‌اچ‌پی.
 *
 * اس‌دی‌کی «api=serialize» می‌فرستد و همان قالب تأییدشده روی نسخه نصب‌شده
 * است، پس همان را می‌فرستیم. جیسون به‌عنوان جایگزین می‌ماند برای
 * نسخه‌هایی که آن را برمی‌گردانند.
 *
 * روی بایت کار می‌کند نه کاراکتر: طول رشته در این قالب بر حسب بایت است و
 * نام مشتری فارسی یا هاست‌نیم یونیکد، شمارش کاراکتری را از جا درمی‌آورد.
 */
function phpUnserialize(text) {
  const buf = Buffer.from(text, 'utf8');
  let at = 0;

  const fail = (why) => {
    throw new Error(`خروجی serialize خراب است در بایت ${at}: ${why}`);
  };
  const expect = (ch) => {
    if (buf[at] !== ch.charCodeAt(0)) fail(`«${ch}» انتظار می‌رفت`);
    at++;
  };
  const until = (ch) => {
    const idx = buf.indexOf(ch.charCodeAt(0), at);
    if (idx === -1) fail(`«${ch}» پیدا نشد`);
    const out = buf.toString('utf8', at, idx);
    at = idx + 1;
    return out;
  };

  function value() {
    const tag = String.fromCharCode(buf[at]);
    switch (tag) {
      case 'N':
        at += 2; // N;
        return null;
      case 'b': {
        at += 2; // b:
        const v = until(';');
        return v === '1';
      }
      case 'i': {
        at += 2;
        return parseInt(until(';'), 10);
      }
      case 'd': {
        at += 2;
        return parseFloat(until(';'));
      }
      case 's': {
        at += 2;
        const len = parseInt(until(':'), 10);
        if (!Number.isFinite(len) || len < 0) fail('طول رشته نامعتبر');
        expect('"');
        const out = buf.toString('utf8', at, at + len);
        at += len;
        expect('"');
        expect(';');
        return out;
      }
      case 'a': {
        at += 2;
        const count = parseInt(until(':'), 10);
        if (!Number.isFinite(count) || count < 0) fail('تعداد عضو نامعتبر');
        expect('{');
        const out = {};
        for (let i = 0; i < count; i++) {
          const k = value();
          out[String(k)] = value();
        }
        expect('}');
        return out;
      }
      default:
        return fail(`نوع ناشناخته «${tag}»`);
    }
  }

  const result = value();
  return result;
}

/**
 * آیا فیلد «error» پاسخ واقعاً خالی است؟
 *
 * ویژالیزور در پاسخ موفق هم این فیلد را می‌گذارد — به شکل آرایه یا شیء
 * خالی. در جاوااسکریپت هر دو درست‌اند، پس «if (parsed.error)» پاسخ موفق
 * را خطا می‌خواند و هر عملیات موفقی ناموفق گزارش می‌شد.
 */
function isEmptyError(value) {
  if (value === null || value === undefined || value === '' || value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** یک فراخوانی به یک نود */
async function call(node, act, params = {}, body) {
  const base = String(node.url || '').replace(/\/+$/, '');
  if (!base || !node.api_key || !node.api_pass) {
    return { ok: false, error: 'اطلاعات اتصال نود ناقص است' };
  }

  const qs = new URLSearchParams({
    act,
    adminapikey: node.api_key,
    adminapipass: node.api_pass,
    api: 'serialize',
    apikey: makeApiKey(node.api_pass),
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
      parsed = text.trimStart().startsWith('{') || text.trimStart().startsWith('[')
        ? JSON.parse(text)
        : phpUnserialize(text);
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
        hint = 'پاسخ اچ‌تی‌ام‌ال آمد نه داده (کد ' + res.status + ')';
      } else {
        hint = 'پاسخ نه جیسون بود نه serialize (کد ' + res.status + ')';
      }
      // برچسب‌های اچ‌تی‌ام‌ال حذف می‌شوند تا بریده خوانا باشد
      const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return { ok: false, error: hint + ' — پاسخ: ' + plain.slice(0, 160), raw: text.slice(0, 300) };
    }

    // ویژالیزور در پاسخ موفق هم فیلد «error» می‌گذارد، ولی خالی. در
    // جاوااسکریپت آرایه و شیء خالی درست‌اند، پس بررسی ساده درستی، پاسخ
    // موفق را خطا می‌خواند. اس‌دی‌کی رسمی هم همین را با empty() مدیریت
    // می‌کند.
    if (parsed && !isEmptyError(parsed.error)) {
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

/**
 * آیا یک آدرس آی‌پی‌وی۴ معتبر است؟
 *
 * ویژالیزور آدرس‌های نسخه ۶ را در همان فهرست برمی‌گرداند. اگر فیلتر نشوند،
 * چون درج با version=4 ثابت انجام می‌شود، به‌عنوان نسخه ۴ ثبت می‌شوند —
 * یعنی برچسبشان دروغ است، در پایش اکسس می‌آیند (که فقط برای نسخه ۴ معنی
 * دارد)، و در حسابداری آی‌پی شمرده می‌شوند.
 *
 * بررسی سخت‌گیرانه است نه فقط «نقطه دارد»: «::ffff:1.2.3.4» هم نقطه دارد.
 */
function isIpv4(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** صفحه‌بندی عمومی — بدون آن، نود با هزاران آدرس یا تایم‌اوت می‌دهد یا پاسخ چندمگابایتی */
async function paged(node, act, key, extra = {}, maxPages = 60) {
  const out = [];
  const seen = new Set();
  // پاسخ خام صفحه اول و کلیدهای بالای آن نگه داشته می‌شوند: اگر فهرست
  // خالی برگردد، تنها راه فهمیدن اینکه کلید پاسخ عوض شده یا واقعاً چیزی
  // نیست، دیدن همین‌هاست. بدون آن، خالی‌بودن بی‌صدا می‌ماند.
  let raw = null;
  let topKeys = null;

  for (let page = 1; page <= maxPages; page++) {
    const res = await call(node, act, { ...extra, page: String(page), reslen: '500' });
    if (!res.ok) return { ok: false, error: res.error, items: out, raw: res.raw };

    if (page === 1) {
      raw = res.raw;
      topKeys = res.data && typeof res.data === 'object' ? Object.keys(res.data) : [];
    }

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

  return { ok: true, items: out, raw, topKeys };
}

/**
 * فهرست آی‌پی‌ها.
 *
 * هر ردیف خودش گیت‌وی، ماسک و شناسه مخزن را دارد — طبق مستندات رسمی.
 * برای همین بلوک‌ها از همین‌جا ساخته می‌شوند و نه از act=ippool: وقتی
 * فهرست مخزن به هر دلیلی خالی برگردد، بلوک‌ها همچنان درست ساخته می‌شوند.
 * وابسته‌کردن ماسک و گیت‌وی به یک فراخوانی دوم، یک نقطه شکست اضافه بود.
 *
 * https://www.virtualizor.com/docs/admin-api/list-ips/
 */
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
        // نام فیلد «ippid» است؛ «ippoolid» فقط در پاسخ مخزن‌ها هست
        ippoolid: str(r.ippid ?? r.ippoolid),
        poolName: str(r.ippool_name),
        gateway: str(r.gateway).trim(),
        netmask: str(r.netmask).trim(),
        poolServerId: str(r.ipp_serid ?? r.ip_serid),
        isV6: str(r.ipv6) === '1',
        locked: str(r.locked) === '1',
        // ویژالیزور مفهوم «رزرو» جدا از قفل ندارد؛ صریح نادرست می‌ماند تا
        // موتور مشترک همه‌جا مقدار تعریف‌شده ببیند
        isReserved: false,
      }))
      // فقط نسخه ۴. نسخه ۶ نه در پایش اکسس معنی دارد نه در لنگر.
      .filter((r) => !r.isV6 && isIpv4(r.ip)),
    rawCount: res.items.length,
    raw: res.raw,
    topKeys: res.topKeys,
  };
}

/**
 * فهرست مخزن‌های آی‌پی.
 *
 * فیلدها طبق مستندات رسمی: ippid، ippool_name، gateway، netmask، ipv6.
 * یک بار «firstip» فرض شد که اصلاً وجود ندارد — نتیجه‌اش این بود که هیچ
 * بلوکی ساخته نمی‌شد و در نتیجه ماسک و گیت‌وی آی‌پی‌ها خالی می‌ماند و
 * پرفیکس بایند به ۳۲ برمی‌گشت.
 *
 * شبکه از روی گیت‌وی حساب می‌شود، چون گیت‌وی همیشه داخل همان بلوک است.
 *
 * https://www.virtualizor.com/docs/admin-api/list-ip-pool/
 */
export async function listPools(node) {
  const res = await paged(node, 'ippool', 'ippools');
  if (!res.ok) return res;
  return {
    ok: true,
    items: res.items
      .map((r) => ({
        poolid: str(r.ippid),
        name: str(r.ippool_name),
        gateway: str(r.gateway).trim(),
        netmask: str(r.netmask).trim(),
        isV6: str(r.ipv6) === '1',
      }))
      // پرچم ipv6 خود ویژالیزور، به‌علاوه بررسی گیت‌وی برای نسخه‌هایی که
      // آن پرچم را نمی‌فرستند
      .filter((r) => r.poolid && !r.isV6 && isIpv4(r.gateway)),
    rawCount: res.items.length,
    raw: res.raw,
    topKeys: res.topKeys,
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
 * تخت‌کردن یک ساختار تودرتو به قالبی که پی‌اچ‌پی دوباره می‌سازدش.
 *
 * «disks[0][disk_path]=...» همان چیزی است که http_build_query تولید
 * می‌کند و پی‌اچ‌پی از آن آرایه اصلی را بازمی‌سازد.
 *
 * چرا لازم است: مستندات managevps هشدار می‌دهد که دیسک‌های نفرستاده حذف
 * می‌شوند. پس هرچه خواندیم را عیناً پس می‌فرستیم، بدون اینکه لازم باشد
 * شکل دقیق هر فیلد را بدانیم.
 */
function flattenInto(value, prefix, out) {
  if (value === null || value === undefined) return;
  if (typeof value === 'boolean') {
    out[prefix] = value ? '1' : '0';
    return;
  }
  if (typeof value !== 'object') {
    out[prefix] = String(value);
    return;
  }
  for (const [k, v] of Object.entries(value)) flattenInto(v, `${prefix}[${k}]`, out);
}

/** پیکربندی فعلی یک وی‌پی‌اس */
async function readVps(node, vpsid) {
  const res = await call(node, 'managevps', { vpsid: String(vpsid) });
  if (!res.ok) return res;
  // ویژالیزور پیکربندی را زیر کلیدهای مختلفی می‌گذارد؛ هرکدام بود
  const d = res.data || {};
  const vps = d.vps || d.vpsinfo || d.info || null;
  if (!vps || typeof vps !== 'object') {
    return {
      ok: false,
      error: `پیکربندی وی‌پی‌اس ${vpsid} خوانده نشد — کلیدهای پاسخ: ${Object.keys(d).join(', ') || 'ندارد'}`,
      raw: res.raw,
    };
  }
  return { ok: true, vps, raw: res.raw };
}

/**
 * تغییر فهرست آی‌پی‌های یک وی‌پی‌اس.
 *
 * اکشن «managevps» است نه «editvs». یک بار «editvs» فرستاده شد که اکشن
 * ای‌پی‌آی نیست؛ پاسخ موفق برمی‌گشت ولی هیچ تغییری اعمال نمی‌شد.
 *
 * چرا اینقدر محتاط: managevps کل پیکربندی را می‌گیرد، نه فقط آی‌پی‌ها.
 * مستندات صریح می‌گوید دیسکی که در درخواست نباشد حذف می‌شود. پس
 * پیکربندی فعلی خوانده می‌شود، عیناً تخت و پس فرستاده می‌شود، و فقط
 * «ips» جایگزین می‌گردد.
 *
 * https://www.virtualizor.com/docs/admin-api/api-manage-vps/
 */
export async function writeVpsIps(node, vpsid, ips, { dryRun = true } = {}) {
  if (!/^\d+$/.test(String(vpsid))) return { ok: false, error: 'شناسه وی‌پی‌اس نامعتبر است' };

  const current = await readVps(node, vpsid);
  if (!current.ok) return current;

  const vps = current.vps;
  const before = rows(vps.ips).length
    ? rows(vps.ips).map(str)
    : Object.values(vps.ips || {}).map(str);

  const sent = {};
  for (const [k, v] of Object.entries(vps)) {
    if (k === 'ips') continue;
    flattenInto(v, k, sent);
  }
  sent.vpsid = String(vpsid);
  // بدون این دو فلگ، ویژالیزور فقط داده صفحه را برمی‌گرداند و هیچ چیزی
  // ذخیره نمی‌شود — پاسخ هم شبیه موفقیت است. از اس‌دی‌کی رسمی:
  //   $post['theme_edit'] = 1;
  //   $post['editvps']    = 1;
  sent.theme_edit = '1';
  sent.editvps = '1';
  ips.forEach((ip, i) => {
    sent[`ips[${i}]`] = ip;
  });

  if (dryRun) {
    return { ok: true, dryRun: true, sent, before, after: ips, fieldCount: Object.keys(sent).length };
  }

  const res = await call(node, 'managevps', { vpsid: String(vpsid) }, sent);
  if (!res.ok) {
    logErr('نوشتن آی‌پی روی وی‌پی‌اس ناموفق:', vpsid, res.error);
    return res;
  }

  // پاسخ باید «done» داشته باشد. بدون این بررسی، پاسخی که فقط صفحه را
  // برمی‌گرداند موفقیت حساب می‌شد — همان چیزی که با editvs اتفاق افتاد و
  // تشخیصش چند دور طول کشید.
  const done = res.data && (res.data.done ?? res.data.saved);
  if (!done) {
    const keys = res.data && typeof res.data === 'object' ? Object.keys(res.data).join(', ') : '';
    return {
      ok: false,
      error: `ویژالیزور تغییر را تأیید نکرد (بدون «done»). کلیدهای پاسخ: ${keys || 'ندارد'}`,
      raw: res.raw,
    };
  }

  return { ok: true, dryRun: false, sent, before, after: ips };
}
