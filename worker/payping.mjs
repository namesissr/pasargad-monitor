/**
 * کلاینت درگاه پرداخت پی‌پینگ.
 *
 * **این فایل در worker/ است ولی هر دو طرف از آن استفاده می‌کنند** — مثل
 * smtp.mjs. اپ وب با ایمپورت از @/worker/payping.mjs. یک پیاده‌سازی، نه
 * دو نسخه که از هم دور می‌افتند.
 *
 * ── چرا دو نسخه پشتیبانی می‌شود ────────────────────────────
 *
 * پی‌پینگ دو نسل ای‌پی‌آی زنده دارد و نام فیلدهایشان فرق می‌کند:
 *
 *   v2:  POST /v2/pay        → { code }
 *        هدایت به /v2/pay/gotoipg/{code}
 *        POST /v2/pay/verify { refId, amount }
 *
 *   v3:  POST /v3/pay        → { paymentCode }
 *        هدایت به /v3/pay/start/{paymentCode}
 *        POST /v3/pay/verify { paymentCode, paymentRefId, amount }
 *
 * کدام یکی برای یک حساب فعال است از بیرون معلوم نیست، پس نسخه یک تنظیم
 * است نه یک حدس. اگر اشتباه انتخاب شود، اولین پرداخت آزمایشی با پیام
 * روشن شکست می‌خورد — نه اینکه بی‌صدا کار غلط کند.
 *
 * ── واحد مبلغ ──────────────────────────────────────────────
 *
 * همه چیز در این پروژه به تومان است. اگر حساب درگاه ریال بخواهد،
 * تنظیم payping_unit روی rial گذاشته می‌شود و اینجا ضرب در ده انجام
 * می‌گیرد.
 *
 * **این تنها جایی است که تبدیل واحد انجام می‌شود.** اگر جای دیگری هم
 * تبدیل شود، مبلغ ده برابر یا یک‌دهم می‌رود و درگاه هم آن را می‌پذیرد —
 * خرابی‌ای که فقط با نگاه‌کردن به رسید معلوم می‌شود.
 */

const BASE = 'https://api.payping.ir';
const TIMEOUT_MS = 20_000;

export class PayPingError extends Error {}

/** مبلغ تومانی را به واحدی که درگاه می‌خواهد تبدیل می‌کند */
export function toGatewayAmount(toman, unit) {
  const value = Math.round(Number(toman) || 0);
  if (value <= 0) throw new PayPingError('مبلغ فاکتور باید بیشتر از صفر باشد');
  return String(unit).toLowerCase() === 'rial' ? value * 10 : value;
}

/**
 * خواندن پیام خطای درگاه.
 *
 * پی‌پینگ خطا را گاهی رشته می‌دهد، گاهی شیء با کلیدهای فارسی، و گاهی
 * آرایه. هر سه حالت باید به یک جمله قابل خواندن تبدیل شود، وگرنه
 * کاربر «[object Object]» می‌بیند.
 */
export function readError(body, status) {
  if (!body) return `درگاه پاسخ ${status} داد`;

  if (typeof body === 'string') {
    const text = body.trim();
    return text ? text.slice(0, 300) : `درگاه پاسخ ${status} داد`;
  }

  if (Array.isArray(body)) {
    const parts = body.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
    return parts.join(' · ').slice(0, 300) || `درگاه پاسخ ${status} داد`;
  }

  if (typeof body === 'object') {
    const parts = [];
    for (const value of Object.values(body)) {
      if (typeof value === 'string') parts.push(value);
      else if (Array.isArray(value)) parts.push(value.filter((x) => typeof x === 'string').join(' '));
    }
    const text = parts.filter(Boolean).join(' · ').trim();
    if (text) return text.slice(0, 300);
    return JSON.stringify(body).slice(0, 300);
  }

  return `درگاه پاسخ ${status} داد`;
}

async function call(path, token, payload) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new PayPingError(`ارتباط با درگاه برقرار نشد: ${err.message}`);
  }

  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) throw new PayPingError(readError(body, res.status));
  return body;
}

/**
 * شروع پرداخت.
 *
 * برمی‌گرداند { code, url } — کد را باید در فاکتور ذخیره کنید و کاربر
 * را به url فرستاد.
 *
 * clientRefId شماره فاکتور ماست و درگاه آن را در بازگشت پس می‌دهد. با
 * آن می‌شود پرداخت را به فاکتور وصل کرد حتی اگر کاربر آدرس بازگشت را
 * دستکاری کند.
 */
export async function createPayment(config, { amountToman, invoiceNumber, description, returnUrl, payerName, payerIdentity }) {
  const token = String(config.token || '').trim();
  if (!token) throw new PayPingError('توکن درگاه پی‌پینگ تنظیم نشده است');

  const version = String(config.version || 'v2') === 'v3' ? 'v3' : 'v2';
  const amount = toGatewayAmount(amountToman, config.unit);

  const payload = {
    amount,
    returnUrl,
    description: String(description || '').slice(0, 200),
    clientRefId: String(invoiceNumber),
  };
  if (payerName) payload.payerName = String(payerName).slice(0, 100);
  if (payerIdentity) payload.payerIdentity = String(payerIdentity).slice(0, 100);

  const body = await call(`/${version}/pay`, token, payload);

  // v2 کلید code می‌دهد و v3 کلید paymentCode. هر دو خوانده می‌شود تا
  // اگر تنظیم نسخه با واقعیت نخواند، دست‌کم پرداخت شروع شود.
  const code = body?.code || body?.paymentCode;
  if (!code) {
    throw new PayPingError(
      `درگاه کد پرداخت نداد. پاسخ: ${JSON.stringify(body).slice(0, 200)}`,
    );
  }

  const url =
    version === 'v3'
      ? `${BASE}/v3/pay/start/${code}`
      : `${BASE}/v2/pay/gotoipg/${code}`;

  return { code: String(code), url, version, amount };
}

/**
 * تأیید پرداخت.
 *
 * **مبلغ باید از دیتابیس بیاید، نه از آدرس بازگشت.** اگر از پارامتر
 * خوانده شود، کاربر فاکتور گران را با تأیید مبلغ ناچیز پرداخت‌شده
 * می‌کند. رایج‌ترین حفره در پیاده‌سازی درگاه‌های ایرانی همین است.
 *
 * صدا زدنش با مبلغ درست، دو بار، بی‌خطر نیست: درگاه بار دوم خطا
 * می‌دهد. اید‌مپوتنت‌بودن کار لایه بالاتر است که ردیف فاکتور را قفل
 * می‌کند.
 */
export async function verifyPayment(config, { amountToman, refId, paymentCode }) {
  const token = String(config.token || '').trim();
  if (!token) throw new PayPingError('توکن درگاه پی‌پینگ تنظیم نشده است');

  const version = String(config.version || 'v2') === 'v3' ? 'v3' : 'v2';
  const amount = toGatewayAmount(amountToman, config.unit);

  if (!refId) throw new PayPingError('شناسه پرداخت از درگاه نیامد');

  const payload =
    version === 'v3'
      ? { paymentCode: String(paymentCode || ''), paymentRefId: String(refId), amount }
      : { refId: String(refId), amount };

  const body = await call(`/${version}/pay/verify`, token, payload);

  // پاسخ موفق ممکن است بدنه نداشته باشد. نبودِ خطا یعنی تأیید شد.
  return {
    ok: true,
    cardNumber: body?.cardNumber || body?.cardnumber || null,
    raw: body ?? null,
  };
}

/**
 * خواندن پارامترهای بازگشت از درگاه.
 *
 * نام پارامترها بین نسخه‌ها و بین حالت GET و POST فرق می‌کند و
 * حساس به بزرگی و کوچکی حروف نیست. همه حالت‌های شناخته‌شده خوانده
 * می‌شوند تا یک تفاوت نام‌گذاری، پرداخت موفق را به‌شکل ناموفق ثبت
 * نکند — بدترین حالت ممکن، چون پول کم شده و سرویس تمدید نشده.
 */
export function readCallback(params) {
  const get = (...names) => {
    for (const name of names) {
      for (const [key, value] of params) {
        if (key.toLowerCase() === name.toLowerCase() && value) return String(value);
      }
    }
    return null;
  };

  return {
    refId: get('refid', 'refId', 'paymentRefId', 'paymentrefid'),
    paymentCode: get('paymentCode', 'paymentcode', 'code'),
    clientRefId: get('clientrefid', 'clientRefId'),
    cardNumber: get('cardnumber', 'cardNumber'),
  };
}
