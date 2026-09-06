'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Notice } from '@/components/ui';
import {
  billingLabel,
  Spec,
  type StoreProduct,
  type TrafficPackage,
} from '@/components/StoreBits';
import { OtpForm } from '@/components/OtpForm';
import { api, ApiError } from '@/lib/api';
import { faInt, faNum, formatToman } from '@/lib/format';

interface ProductData {
  enabled: boolean;
  products: StoreProduct[];
  packages: TrafficPackage[];
}

interface SessionData {
  signedIn: boolean;
  username?: string;
}

type Mode = 'register' | 'login' | 'otp';

/**
 * صفحه محصول و سفارش.
 *
 * ── چرا همه‌چیز در یک صفحه ─────────────────────────────────
 *
 * مشخصات، قیمت و فرم سفارش کنار هم‌اند. هر مرحله‌ای که به صفحه بعد
 * منتقل شود، جایی است که مشتری تازه از آن برنمی‌گردد.
 *
 * ── حالت حساب ──────────────────────────────────────────────
 *
 * اگر وارد شده باشد، بخش حساب اصلا نشان داده نمی‌شود. اگر نه، دو گزینه
 * دارد: «حساب دارم» و «حساب ندارم». پیش‌فرض روی ثبت‌نام است، چون کسی که
 * از فروشگاه عمومی می‌آید اغلب مشتری تازه است.
 *
 * ── ورود با کد پیامکی ──────────────────────────────────────
 *
 * حالت سوم است ولی به مسیر سفارش دست نمی‌زند: فرم کد، خودش نشست را باز
 * می‌کند و بعد سفارش با mode=session ثبت می‌شود. یعنی مسیر
 * /api/store/checkout هیچ حالت تازه‌ای لازم ندارد.
 */
export default function StoreProductPage({ params }: { params: { id: string } }) {
  const { data, loading, error, reload } = useLoad<ProductData>(
    `/api/store/products?id=${params.id}`,
  );
  const session = useLoad<SessionData>('/api/store/session');

  const [mode, setMode] = useState<Mode>('register');
  const [form, setForm] = useState({
    name: '',
    phone: '',
    password: '',
    email: '',
    company: '',
    national_id: '',
    address: '',
    username: '',
    login_password: '',
    note: '',
    discount_code: '',
  });
  // افزودنی‌ها. خالی و صفر یعنی انتخاب نشده.
  const [addonPackageId, setAddonPackageId] = useState('');
  const [addonIps, setAddonIps] = useState(0);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);

    // حالت درخواست از وضعیت واقعی نشست می‌آید، نه از انتخاب کاربر:
    // کسی که وارد شده نباید دوباره ثبت‌نام کند.
    const signedIn = Boolean(session.data?.signedIn);

    // مرحله حساب بیرون از این فرم است (فرم تودرتو HTML نامعتبر است)،
    // پس اعتبارسنجی خودکار مرورگر شاملش نمی‌شود و باید صریح باشد.
    // سرور هم همه اینها را دوباره بررسی می‌کند؛ این فقط برای این است
    // که کاربر پیش از رفت‌وبرگشت، خطا را ببیند.
    if (!signedIn && mode === 'otp') {
      setMsg('اول با کد پیامکی وارد شوید.');
      setBusy(false);
      return;
    }
    if (!signedIn && mode === 'login' && (!form.username || !form.login_password)) {
      setMsg('شماره موبایل و گذرواژه را وارد کنید.');
      setBusy(false);
      return;
    }
    if (!signedIn && mode === 'register' && (!form.name || !form.phone || !form.password)) {
      setMsg('نام، شماره موبایل و گذرواژه لازم است.');
      setBusy(false);
      return;
    }
    const payload: Record<string, unknown> = {
      mode: signedIn ? 'session' : mode,
      product_id: Number(params.id),
      note: form.note,
      discount_code: form.discount_code,
      // فقط شناسه و تعداد می‌رود؛ قیمت را سرور از دیتابیس می‌خواند
      addon_package_id: addonPackageId ? Number(addonPackageId) : null,
      addon_ips: addonIps || null,
    };

    if (!signedIn && mode === 'login') {
      payload.username = form.username;
      payload.password = form.login_password;
    }
    // حالت otp اینجا چیزی اضافه نمی‌کند: نشست پیش از این مرحله با فرم
    // کد باز شده و mode بالا خودش session شده است.
    if (!signedIn && mode === 'register') {
      payload.name = form.name;
      payload.phone = form.phone;
      payload.password = form.password;
      payload.email = form.email;
      payload.company = form.company;
      payload.national_id = form.national_id;
      payload.address = form.address;
    }

    try {
      const res = await api.post<{ invoiceId: number; paid: boolean }>(
        '/api/store/checkout',
        payload,
      );

      // سفارش ثبت شد و نشست هم باز است. مستقیم به فاکتور می‌رود تا
      // پرداخت یک کلیک باشد، نه یک جستجو در پرتال.
      window.location.href = res.paid
        ? `/portal/invoices/${res.invoiceId}`
        : `/portal/invoices/${res.invoiceId}?pay=1`;
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'ثبت سفارش ناموفق بود');
      setBusy(false);
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  const product = data.products[0];

  if (!data.enabled || !product) {
    return (
      <div className="space-y-4">
        <Link href="/store" className="text-xs text-muted hover:text-cyan">
          ← بازگشت به فروشگاه
        </Link>
        <Notice type="warn">این محصول پیدا نشد یا دیگر در دسترس نیست.</Notice>
      </div>
    );
  }

  const signedIn = Boolean(session.data?.signedIn);

  // جمع نمایشی. مبلغ واقعی فاکتور را سرور از دیتابیس حساب می‌کند؛ این
  // فقط برای اینکه مشتری پیش از زدن دکمه بداند چقدر می‌شود.
  const pack = data.packages?.find((x) => String(x.id) === addonPackageId) ?? null;
  const packTotal = pack ? Number(pack.price_toman) : 0;
  const ipUnit = Number(product.extra_ip_price_toman) || 0;
  const ipTotal = ipUnit * addonIps;
  const base = Number(product.price_toman) + Number(product.setup_toman);
  const total = base + packTotal + ipTotal;

  const maxIps = Number(product.max_extra_ips) || 0;
  const offersIps = maxIps > 0 && ipUnit > 0;

  return (
    <div className="space-y-5">
      <Link href="/store" className="text-xs text-muted hover:text-cyan">
        ← بازگشت به فروشگاه
      </Link>

      <div className="grid lg:grid-cols-5 gap-5 items-start">
        {/* ── مشخصات ─────────────────────────────────────── */}
        <div className="lg:col-span-2 card p-5 space-y-4 lg:sticky lg:top-20">
          <div>
            <h1 className="text-lg font-bold">{product.name}</h1>
            {product.summary && (
              <p className="text-xs text-muted mt-1 leading-relaxed">{product.summary}</p>
            )}
          </div>

          <div className="space-y-1.5 pt-3 border-t border-line">
            <Spec label="پردازنده" value={product.spec_cpu} />
            <Spec label="حافظه" value={product.spec_ram} />
            <Spec label="دیسک" value={product.spec_disk} />
            <Spec label="پهنای باند" value={product.spec_bandwidth} />
            <Spec label="موقعیت" value={product.spec_location} />
          </div>

          <div className="pt-3 border-t border-line space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted">اجاره {billingLabel(product.billing_months)}</span>
              <span>{formatToman(product.price_toman)}</span>
            </div>
            {product.setup_toman > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted">راه‌اندازی (یک‌بار)</span>
                <span>{formatToman(product.setup_toman)}</span>
              </div>
            )}

            {/* افزودنی‌ها همان‌جا در خلاصه دیده می‌شوند، وگرنه مشتری
                عدد نهایی را می‌بیند و نمی‌داند از کجا آمده */}
            {pack && (
              <div className="flex justify-between text-xs">
                <span className="text-muted">{pack.name}</span>
                <span>{formatToman(packTotal)}</span>
              </div>
            )}
            {ipTotal > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted">
                  {faNum(addonIps)} آی‌پی اضافه
                </span>
                <span>{formatToman(ipTotal)}</span>
              </div>
            )}

            <div className="flex justify-between text-sm font-bold pt-2 border-t border-line mt-2">
              <span>پرداخت اول</span>
              <span>{formatToman(total)}</span>
            </div>
          </div>

          {!product.in_stock && <Notice type="warn">موجودی این محصول تمام شده است.</Notice>}
        </div>

        {/* ── سفارش ────────────────────────────────────────
            مرحله حساب **بیرون** از فرم سفارش است: فرم کد پیامکی خودش
            یک <form> است و فرم تودرتو HTML نامعتبر است — مرورگر
            داخلی را دور می‌اندازد و دکمه «ارسال کد» سفارش را ثبت
            می‌کند. */}
        <div className="lg:col-span-3 space-y-4">
          {msg && <Notice type="error">{msg}</Notice>}

          {/* بخش حساب فقط وقتی نشان داده می‌شود که کاربر وارد نشده */}
          {!signedIn && (
            <div className="card p-5 space-y-4">
              <div>
                <h2 className="text-sm font-bold">حساب کاربری</h2>
                <p className="text-[11px] text-muted mt-0.5">
                  برای پیگیری سفارش و تحویل سرور، یک حساب لازم است.
                </p>
              </div>

              <div className="flex gap-1">
                {(
                  [
                    ['register', 'حساب ندارم'],
                    ['login', 'حساب دارم'],
                    ['otp', 'ورود با کد پیامکی'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMode(key)}
                    className={`px-4 py-2 rounded-lg text-xs border transition-colors ${
                      mode === key
                        ? 'bg-cyan/10 text-cyan border-cyan/30'
                        : 'border-line text-muted hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {mode === 'otp' ? (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted leading-relaxed">
                    شماره موبایلتان را بزنید تا کد ورود برایتان پیامک شود. پس از تأیید، سفارش به
                    همین حساب ثبت می‌شود.
                  </p>
                  {/* پس از تأیید، کوکی نشست گذاشته شده. فقط وضعیت نشست
                      را تازه می‌کنیم تا فرم بداند دیگر مرحله حساب لازم
                      نیست. صفحه بارگذاری دوباره نمی‌شود، وگرنه چیزی که
                      در فرم سفارش نوشته شده از دست می‌رود. */}
                  <OtpForm initialPhone={form.username} onDone={() => session.reload()} />
                </div>
              ) : mode === 'login' ? (
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="شماره موبایل">
                    <input
                      className="input ltr"
                      value={form.username}
                      onChange={set('username')}
                      placeholder="09121234567"
                      autoComplete="username"
                    />
                  </Field>
                  <Field label="گذرواژه">
                    <input
                      className="input ltr"
                      type="password"
                      value={form.login_password}
                      onChange={set('login_password')}
                      autoComplete="current-password"
                    />
                  </Field>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="نام و نام خانوادگی">
                      <input
                        className="input"
                        value={form.name}
                        onChange={set('name')}
                        autoComplete="name"
                      />
                    </Field>
                    <Field label="شماره موبایل" hint="نام کاربری شما همین شماره خواهد بود">
                      <input
                        className="input ltr"
                        value={form.phone}
                        onChange={set('phone')}
                        placeholder="09121234567"
                        autoComplete="tel"
                      />
                    </Field>
                    <Field label="ایمیل" hint="فاکتور و مشخصات سرور به این نشانی می‌رود">
                      <input
                        className="input ltr"
                        type="email"
                        value={form.email}
                        onChange={set('email')}
                        autoComplete="email"
                      />
                    </Field>
                    <Field label="گذرواژه" hint="دست‌کم ۸ کاراکتر">
                      <input
                        className="input ltr"
                        type="password"
                        value={form.password}
                        onChange={set('password')}
                        autoComplete="new-password"
                        minLength={8}
                      />
                    </Field>
                  </div>

                  {/* مشخصات حقوقی اختیاری‌اند: اجباری‌کردنشان اینجا فقط
                      سفارش را از دست می‌دهد. در پروفایل قابل تکمیل‌اند. */}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted hover:text-white">
                      مشخصات صورتحساب (اختیاری)
                    </summary>
                    <div className="grid sm:grid-cols-2 gap-4 mt-3">
                      <Field label="نام شرکت">
                        <input className="input" value={form.company} onChange={set('company')} />
                      </Field>
                      <Field label="شناسه ملی یا کد ملی">
                        <input
                          className="input ltr"
                          value={form.national_id}
                          onChange={set('national_id')}
                        />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="نشانی">
                          <input className="input" value={form.address} onChange={set('address')} />
                        </Field>
                      </div>
                    </div>
                  </details>
                </div>
              )}
            </div>
          )}

          {signedIn && (
            <Notice type="info">
              با حساب <span className="ltr">{session.data?.username}</span> وارد شده‌اید. سفارش به
              همین حساب ثبت می‌شود.
            </Notice>
          )}

          <form onSubmit={submit} className="space-y-4">
          {/* ── ترافیک اضافه ───────────────────────────── */}
          {data.packages?.length > 0 && (
            <div className="card p-5 space-y-3">
              <div>
                <h2 className="text-sm font-bold">ترافیک اضافه</h2>
                <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
                  اختیاری. ترافیک خریداری‌شده انقضا ندارد و هنگام تحویل روی همین سرور اعمال
                  می‌شود.
                </p>
              </div>

              <div className="space-y-2">
                {/* گزینه «نمی‌خواهم» صریح است، نه غیبتِ انتخاب: بدون آن
                    مشتری‌ای که اشتباهی چیزی زده راهی برای برگشت ندارد */}
                <label className="flex items-center gap-3 p-3 rounded-lg border border-line cursor-pointer hover:border-cyan/40 transition-colors">
                  <input
                    type="radio"
                    name="addon-traffic"
                    className="accent-cyan"
                    checked={addonPackageId === ''}
                    onChange={() => setAddonPackageId('')}
                  />
                  <span className="text-xs">ترافیک اضافه نمی‌خواهم</span>
                </label>

                {data.packages.map((x) => (
                  <label
                    key={x.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      addonPackageId === String(x.id)
                        ? 'border-cyan/40 bg-cyan/5'
                        : 'border-line hover:border-cyan/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="addon-traffic"
                      className="accent-cyan"
                      checked={addonPackageId === String(x.id)}
                      onChange={() => setAddonPackageId(String(x.id))}
                    />
                    <span className="text-xs flex-1 min-w-0">
                      {x.name}
                      <span className="block text-[11px] text-muted">
                        {faInt(Number(x.gb))} گیگابایت
                        {x.description ? ` · ${x.description}` : ''}
                      </span>
                    </span>
                    <span className="text-xs font-medium shrink-0">
                      {formatToman(x.price_toman)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── آی‌پی اضافه ─────────────────────────────── */}
          {offersIps && (
            <div className="card p-5 space-y-3">
              <div>
                <h2 className="text-sm font-bold">آی‌پی اضافه</h2>
                <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
                  اختیاری. هر آی‌پی {formatToman(ipUnit)} در هر دوره. حداکثر {faNum(maxIps)} عدد.
                </p>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="btn-ghost w-9 h-9 p-0 text-base"
                    onClick={() => setAddonIps((n) => Math.max(0, n - 1))}
                    aria-label="کم کردن"
                  >
                    −
                  </button>
                  <span className="w-12 text-center text-sm font-bold tabular-nums">
                    {faNum(addonIps)}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost w-9 h-9 p-0 text-base"
                    onClick={() => setAddonIps((n) => Math.min(maxIps, n + 1))}
                    aria-label="اضافه کردن"
                  >
                    +
                  </button>
                </div>

                {ipTotal > 0 && (
                  <span className="text-xs text-muted">
                    مجموع {formatToman(ipTotal)}
                  </span>
                )}
              </div>

              <p className="text-[11px] text-muted/70 leading-relaxed">
                آی‌پی‌های اضافه همراه سرور تحویل داده می‌شوند.
              </p>
            </div>
          )}

          {/* ── جزئیات سفارش ───────────────────────────── */}
          <div className="card p-5 space-y-4">
            <h2 className="text-sm font-bold">جزئیات سفارش</h2>

            <Field
              label="توضیح برای ما (اختیاری)"
              hint="سیستم عامل مورد نظر، تنظیمات خاص، یا هر چیزی که باید بدانیم"
            >
              <textarea
                className="input min-h-[90px] leading-relaxed"
                value={form.note}
                onChange={set('note')}
                maxLength={500}
              />
            </Field>

            <Field label="کد تخفیف (اختیاری)">
              <input
                className="input ltr"
                value={form.discount_code}
                onChange={set('discount_code')}
              />
            </Field>
          </div>

          <div className="card p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-lg font-bold">{formatToman(total)}</div>
              <p className="text-[11px] text-muted mt-0.5">
                پس از ثبت سفارش، فاکتور صادر و به صفحه پرداخت می‌روید.
              </p>
            </div>

            <button
              type="submit"
              className="btn-primary px-6 py-2.5"
              disabled={busy || !product.in_stock}
            >
              {busy ? 'در حال ثبت…' : 'ثبت سفارش و پرداخت'}
            </button>
          </div>

          <p className="text-[11px] text-muted/70 leading-relaxed">
            سرور اختصاصی خودکار تحویل نمی‌شود. پس از پرداخت، سفارش شما در صف آماده‌سازی قرار
            می‌گیرد و پس از تحویل، مشخصات و رمز ورود سرور برایتان ایمیل می‌شود.
          </p>
          </form>
        </div>
      </div>
    </div>
  );
}
