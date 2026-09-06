/**
 * کلاینت درخواست به ای‌پی‌آی پنل.
 *
 * درس گرفته‌شده: پیام خطای سرور باید استخراج شود. اگر فقط res.ok را نگاه
 * کنیم، کاربر «خطا در ارتباط با سرور» بی‌جزئیات می‌بیند و هیچ سرنخی ندارد.
 * این تابع رشته، آرایه و نبودِ پیام را جدا مدیریت می‌کند.
 */

export class ApiError extends Error {
  status: number;
  /**
   * بدنه جیسون پاسخ خطا، اگر جیسون بود.
   *
   * بعضی خطاها جزئیاتی دارند که پیام متنی جایشان نیست — مثل ثانیه
   * مانده تا ارسال دوباره کد. بدون این، رابط باید همان عدد را از متن
   * فارسی بیرون بکشد.
   */
  data: Record<string, unknown> | null;

  constructor(message: string, status: number, data: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function extractError(
  res: Response,
): Promise<{ message: string; data: Record<string, unknown> | null }> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return { message: `پاسخی از سرور نیامد (کد ${res.status})`, data: null };
  }

  if (!text) return { message: `سرور پاسخ خالی داد (کد ${res.status})`, data: null };

  let data: Record<string, unknown> | null = null;
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    data = body as Record<string, unknown>;
    const raw = body.message ?? body.error;
    if (Array.isArray(raw)) return { message: raw.map(String).join('؛ '), data };
    if (typeof raw === 'string' && raw.trim()) return { message: raw, data };
  } catch {
    // پاسخ جیسون نبود — احتمالاً صفحه خطای انجین‌ایکس
  }

  const fallback =
    res.status === 401
      ? 'نشست شما منقضی شده است. دوباره وارد شوید.'
      : res.status === 403
        ? 'اجازه این کار را ندارید.'
        : res.status === 404
          ? 'مسیر مورد نظر پیدا نشد.'
          : res.status >= 500
            ? `خطای داخلی سرور (کد ${res.status})`
            : `درخواست ناموفق بود (کد ${res.status})`;

  return { message: fallback, data };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new ApiError('ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی کنید.', 0);
  }

  if (!res.ok) {
    const { message, data } = await extractError(res);

    // ۴۰۱ روی مسیرهای ورود یعنی «گذرواژه یا کد غلط بود»، نه «نشست
    // منقضی شده». فرستادن کاربر به صفحه ورود در آن حالت، او را وسط
    // ثبت سفارش از فرمش بیرون می‌اندازد و سفارش از دست می‌رود.
    //
    // خودِ صفحه ورود هم مستثناست، وگرنه هر گذرواژه غلط صفحه را
    // بارگذاری دوباره می‌کند و پیام خطا پیش از خوانده‌شدن می‌پرد.
    const isAuthRoute = url.startsWith('/api/auth/');

    if (
      res.status === 401 &&
      !isAuthRoute &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/login')
    ) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(message, res.status, data);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
};
