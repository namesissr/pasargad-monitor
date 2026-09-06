'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalaliDay, formatToman } from '@/lib/format';

/**
 * کدهای تخفیف.
 *
 * تخفیف **مبلغی** است نه درصدی. کد یا برای همه مشتریان است یا فقط
 * برای یکی.
 *
 * عمداً در فایل جدا از صفحه فروشگاه است: آن فایل با دو تب دیگر از قبل
 * بلند بود و بلندتر شدنش خواندنش را سخت می‌کرد.
 */

export interface Discount {
  id: number;
  code: string;
  title: string | null;
  amount_toman: number;
  customer_id: number | null;
  customer_name: string | null;
  scope: 'all' | 'traffic' | 'product';
  product_id: number | null;
  package_id: number | null;
  product_name: string | null;
  package_name: string | null;
  min_amount_toman: number;
  max_uses: number | null;
  used_count: number;
  once_per_customer: boolean;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  note: string | null;
  discounted_total: number;
}

const SCOPE: Record<string, string> = {
  all: 'همه',
  traffic: 'بسته ترافیک',
  product: 'محصول',
};

export function Discounts() {
  const { data, loading, error, reload } = useLoad<{ discounts: Discount[] }>('/api/discounts');
  const [editing, setEditing] = useState<Discount | 'new' | null>(null);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function remove(d: Discount) {
    if (!confirm(`کد «${d.code}» حذف شود؟`)) return;
    setMsg(null);
    try {
      const res = await api.del<{ deactivated: boolean }>(`/api/discounts?id=${d.id}`);
      setMsg({
        type: 'success',
        text: res.deactivated
          ? 'این کد استفاده شده، پس حذف نشد و فقط غیرفعال شد تا سابقه سالم بماند.'
          : 'کد حذف شد.',
      });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'حذف ناموفق بود' });
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  const totalGiven = data.discounts.reduce((a, d) => a + Number(d.discounted_total || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted">
          تخفیف مبلغی است، نه درصدی. کد فقط پس از <b>پرداخت موفق</b> مصرف می‌شود — پس شروع و
          لغو خرید، ظرفیتش را نمی‌سوزاند.
        </p>
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          + کد تازه
        </button>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      {totalGiven > 0 && (
        <div className="card p-4">
          <div className="text-xs text-muted">مجموع تخفیف داده‌شده</div>
          <div className="text-2xl font-bold mt-1 text-amber">{formatToman(totalGiven)}</div>
        </div>
      )}

      {!data.discounts.length ? (
        <Notice type="warn">هنوز کد تخفیفی تعریف نشده.</Notice>
      ) : (
        <div className="card table-wrap">
          <table className="tbl sm:min-w-[860px]">
            <thead>
              <tr>
                <th>کد</th>
                <th>مبلغ</th>
                <th>برای</th>
                <th className="col-sm">دامنه</th>
                <th>استفاده</th>
                <th className="col-md">اعتبار</th>
                <th>وضعیت</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.discounts.map((d) => (
                <tr key={d.id} className={d.is_active ? '' : 'opacity-60'}>
                  <td className="text-xs">
                    <span className="ltr font-bold">{d.code}</span>
                    {d.title && <span className="text-muted block text-[11px]">{d.title}</span>}
                  </td>
                  <td className="text-xs font-medium sm:whitespace-nowrap">
                    {formatToman(d.amount_toman)}
                    {d.min_amount_toman > 0 && (
                      <span className="text-muted block text-[11px]">
                        از {formatToman(d.min_amount_toman)}
                      </span>
                    )}
                  </td>
                  <td className="text-xs">
                    {d.customer_name ? (
                      d.customer_name
                    ) : (
                      <span className="text-muted">همه مشتریان</span>
                    )}
                  </td>
                  <td className="text-xs text-muted col-sm">
                    {/* هدف مشخص از دامنه کلی مهم‌تر است، پس اول می‌آید */}
                    {d.product_name ? (
                      <span className="text-cyan">{d.product_name}</span>
                    ) : d.package_name ? (
                      <span className="text-cyan">{d.package_name}</span>
                    ) : (
                      SCOPE[d.scope] ?? d.scope
                    )}
                  </td>
                  <td className="text-xs">
                    {faNum(d.used_count)}
                    {d.max_uses !== null ? ` از ${faNum(d.max_uses)}` : ''}
                    {d.once_per_customer && (
                      <span className="text-muted block text-[11px]">هر مشتری یک بار</span>
                    )}
                  </td>
                  <td className="text-xs text-muted col-md sm:whitespace-nowrap">
                    {d.starts_at || d.expires_at ? (
                      <>
                        {d.starts_at ? formatJalaliDay(d.starts_at) : '…'}
                        {' تا '}
                        {d.expires_at ? formatJalaliDay(d.expires_at) : '…'}
                      </>
                    ) : (
                      'بدون محدودیت'
                    )}
                  </td>
                  <td className="text-xs">
                    {d.is_active ? (
                      <span className="badge bg-ok/15 text-ok">فعال</span>
                    ) : (
                      <span className="badge bg-line text-muted">غیرفعال</span>
                    )}
                  </td>
                  <td className="text-end whitespace-nowrap">
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-cyan"
                      onClick={() => setEditing(d)}
                    >
                      ویرایش
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-danger ms-3"
                      onClick={() => remove(d)}
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DiscountForm
          discount={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function DiscountForm({
  discount,
  onClose,
  onDone,
}: {
  discount: Discount | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const customers = useLoad<{ customers: { id: number; name: string }[] }>('/api/customers');
  const products = useLoad<{ products: { id: number; name: string }[] }>('/api/products');
  const packages = useLoad<{ packages: { id: number; name: string }[] }>('/api/packages');

  const [form, setForm] = useState({
    code: discount?.code ?? '',
    title: discount?.title ?? '',
    amount_toman: discount ? String(discount.amount_toman) : '',
    // رشته خالی یعنی همه مشتریان
    customer_id: discount?.customer_id ? String(discount.customer_id) : '',
    scope: discount?.scope ?? 'all',
    // خالی یعنی «همه»؛ مقدار یعنی فقط همان یکی
    product_id: discount?.product_id ? String(discount.product_id) : '',
    package_id: discount?.package_id ? String(discount.package_id) : '',
    min_amount_toman: String(discount?.min_amount_toman ?? 0),
    // رشته خالی یعنی نامحدود
    max_uses: discount?.max_uses === null || !discount ? '' : String(discount.max_uses),
    once_per_customer: discount?.once_per_customer ?? true,
    starts_at: discount?.starts_at ?? '',
    expires_at: discount?.expires_at ?? '',
    is_active: discount?.is_active ?? true,
    note: discount?.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const payload = {
        ...form,
        amount_toman: Number(form.amount_toman),
        min_amount_toman: Number(form.min_amount_toman) || 0,
      };
      if (discount) await api.patch('/api/discounts', { id: discount.id, ...payload });
      else await api.post('/api/discounts', payload);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ذخیره ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open wide title={discount ? `ویرایش ${discount.code}` : 'کد تخفیف تازه'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="کد" hint="حرف انگلیسی، عدد، خط تیره. حروف کوچک هم قبول است.">
            <input
              className="input ltr"
              value={form.code}
              onChange={set('code')}
              placeholder="NOWRUZ1405"
              autoComplete="off"
            />
          </Field>
          <Field label="مبلغ تخفیف (تومان)" hint="مبلغ ثابت، نه درصد">
            <input className="input ltr" value={form.amount_toman} onChange={set('amount_toman')} />
          </Field>
        </div>

        <Field label="عنوان" hint="اختیاری؛ فقط برای خودتان">
          <input className="input" value={form.title} onChange={set('title')} placeholder="جشنواره نوروز" />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="برای چه کسی" hint="خالی یعنی همه مشتریان می‌توانند استفاده کنند">
            <select className="input" value={form.customer_id} onChange={set('customer_id')}>
              <option value="">همه مشتریان</option>
              {(customers.data?.customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="دامنه" hint="روی چه چیزی قابل استفاده باشد">
            <select
              className="input"
              value={form.scope}
              onChange={(e) =>
                // عوض‌کردن دامنه، هدف مشخصِ ناسازگار را پاک می‌کند —
                // وگرنه کدی می‌ماند که هیچ خریدی را پوشش نمی‌دهد
                setForm((f) => ({
                  ...f,
                  scope: e.target.value,
                  product_id: e.target.value === 'traffic' ? '' : f.product_id,
                  package_id: e.target.value === 'product' ? '' : f.package_id,
                }))
              }
            >
              <option value="all">همه خریدها</option>
              <option value="traffic">فقط بسته ترافیک</option>
              <option value="product">فقط محصول</option>
            </select>
          </Field>
        </div>

        {/* هدف مشخص. انتخاب یکی، دیگری را غیرفعال می‌کند: هیچ خریدی
            همزمان محصول و بسته نیست. */}
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="فقط این محصول" hint="خالی یعنی همه محصولات">
            <select
              className="input"
              value={form.product_id}
              disabled={Boolean(form.package_id)}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  product_id: e.target.value,
                  scope: e.target.value ? 'product' : f.scope,
                }))
              }
            >
              <option value="">همه محصولات</option>
              {(products.data?.products ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="فقط این بسته ترافیک" hint="خالی یعنی همه بسته‌ها">
            <select
              className="input"
              value={form.package_id}
              disabled={Boolean(form.product_id)}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  package_id: e.target.value,
                  scope: e.target.value ? 'traffic' : f.scope,
                }))
              }
            >
              <option value="">همه بسته‌ها</option>
              {(packages.data?.packages ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="حداقل مبلغ خرید" hint="صفر یعنی بدون شرط">
            <input
              className="input ltr"
              value={form.min_amount_toman}
              onChange={set('min_amount_toman')}
            />
          </Field>
          <Field label="سقف استفاده" hint="خالی یعنی نامحدود">
            <input className="input ltr" value={form.max_uses} onChange={set('max_uses')} />
          </Field>
          <Field label="هر مشتری" hint="برای کد عمومی معمولا یک بار درست است">
            <select
              className="input"
              value={form.once_per_customer ? 'true' : 'false'}
              onChange={(e) =>
                setForm((f) => ({ ...f, once_per_customer: e.target.value === 'true' }))
              }
            >
              <option value="true">فقط یک بار</option>
              <option value="false">بدون محدودیت</option>
            </select>
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="شروع اعتبار" hint="میلادی، مثل ۲۰۲۶-۰۹-۲۰. خالی یعنی از همین حالا.">
            <input className="input ltr" value={form.starts_at} onChange={set('starts_at')} placeholder="2026-09-20" />
          </Field>
          <Field label="پایان اعتبار" hint="خالی یعنی بدون انقضا">
            <input className="input ltr" value={form.expires_at} onChange={set('expires_at')} placeholder="2026-10-20" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="وضعیت" hint="غیرفعال یعنی دیگر پذیرفته نمی‌شود">
            <select
              className="input"
              value={form.is_active ? 'true' : 'false'}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === 'true' }))}
            >
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </Field>
          <Field label="یادداشت" hint="فقط برای خودتان">
            <input className="input" value={form.note} onChange={set('note')} />
          </Field>
        </div>

        <Notice type="info">
          اگر مبلغ تخفیف از مبلغ خرید بیشتر باشد، تا همان مبلغ خرید کم می‌شود — فاکتور هرگز
          منفی نمی‌شود. تخفیفی که کل مبلغ را بپوشاند، فاکتور صفر می‌سازد و سرویس بدون رفتن به
          درگاه تحویل می‌شود.
        </Notice>

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
          <button
            type="button"
            className="btn"
            onClick={save}
            disabled={busy || !form.code.trim() || !Number(form.amount_toman)}
          >
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
