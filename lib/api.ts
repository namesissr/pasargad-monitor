/**
 * کلاینت درخواست به ای‌پی‌آی پنل.
 *
 * درس گرفته‌شده: پیام خطای سرور باید استخراج شود. اگر فقط res.ok را نگاه
 * کنیم، کاربر «خطا در ارتباط با سرور» بی‌جزئیات می‌بیند و هیچ سرنخی ندارد.
 * این تابع رشته، آرایه و نبودِ پیام را جدا مدیریت می‌کند.
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function extractMessage(res: Response): Promise<string> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return `پاسخی از سرور نیامد (کد ${res.status})`;
  }

  if (!text) return `سرور پاسخ خالی داد (کد ${res.status})`;

  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    const raw = body.message ?? body.error;
    if (Array.isArray(raw)) return raw.map(String).join('؛ ');
    if (typeof raw === 'string' && raw.trim()) return raw;
  } catch {
    // پاسخ جیسون نبود — احتمالاً صفحه خطای انجین‌ایکس
  }

  if (res.status === 401) return 'نشست شما منقضی شده است. دوباره وارد شوید.';
  if (res.status === 403) return 'اجازه این کار را ندارید.';
  if (res.status === 404) return 'مسیر مورد نظر پیدا نشد.';
  if (res.status >= 500) return `خطای داخلی سرور (کد ${res.status})`;
  return `درخواست ناموفق بود (کد ${res.status})`;
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
    const message = await extractMessage(res);
    if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(message, res.status);
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
