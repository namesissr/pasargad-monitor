'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatFromGb, formatToman } from '@/lib/format';

interface Package {
  id: number;
  name: string;
  gb: number;
  price_toman: number;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  sold_count: number;
}

interface Product {
  id: number;
  name: string;
  kind: string;
  summary: string | null;
  spec_cpu: string | null;
  spec_ram: string | null;
  spec_disk: string | null;
  spec_bandwidth: string | null;
  spec_location: string | null;
  price_toman: number;
  setup_toman: number;
  billing_months: number;
  stock: number | null;
  is_active: boolean;
  sort_order: number;
  order_count: number;
}

export default function ShopPage() {
  const [tab, setTab] = useState<'packages' | 'products'>('packages');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">فروشگاه</h1>
        <p className="text-xs text-muted mt-0.5">
          آنچه اینجا فعال باشد، در پرتال مشتری دیده و آنلاین خریده می‌شود.
        </p>
      </div>

      <div className="flex gap-1 border-b border-line">
        {([
          ['packages', 'بسته‌های ترافیک'],
          ['products', 'محصولات'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-xs border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-cyan text-cyan'
                : 'border-transparent text-muted hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'packages' ? <Packages /> : <Products />}
    </div>
  );
}

/* ═══════════════════ بسته‌های ترافیک ═══════════════════ */

function Packages() {
  const { data, loading, error, reload } = useLoad<{ packages: Package[] }>('/api/packages');
  const [editing, setEditing] = useState<Package | 'new' | null>(null);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function remove(p: Package) {
    if (!confirm(`بسته «${p.name}» حذف شود؟`)) return;
    setMsg(null);
    try {
      const res = await api.del<{ deactivated: boolean }>(`/api/packages?id=${p.id}`);
      setMsg({
        type: 'success',
        text: res.deactivated
          ? 'این بسته فاکتور دارد، پس حذف نشد و فقط غیرفعال شد تا سابقه سالم بماند.'
          : 'بسته حذف شد.',
      });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'حذف ناموفق بود' });
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          + بسته تازه
        </button>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      {!data.packages.length ? (
        <Notice type="warn">هنوز بسته‌ای تعریف نشده. تا وقتی بسته‌ای نباشد، مشتری چیزی برای خرید نمی‌بیند.</Notice>
      ) : (
        <div className="card table-wrap">
          <table className="tbl sm:min-w-[720px]">
            <thead>
              <tr>
                <th>نام</th>
                <th>ترافیک</th>
                <th>قیمت</th>
                <th>وضعیت</th>
                <th className="col-sm">فروش</th>
                <th className="col-md">ترتیب</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.packages.map((p) => (
                <tr key={p.id} className={p.is_active ? '' : 'opacity-60'}>
                  <td className="text-xs font-medium">
                    {p.name}
                    {p.description && (
                      <span className="text-muted block text-[11px] truncate max-w-[220px]">
                        {p.description}
                      </span>
                    )}
                  </td>
                  <td className="text-xs text-cyan sm:whitespace-nowrap">{formatFromGb(p.gb)}</td>
                  <td className="text-xs sm:whitespace-nowrap">{formatToman(p.price_toman)}</td>
                  <td className="text-xs">
                    {p.is_active ? (
                      <span className="badge bg-ok/15 text-ok">فعال</span>
                    ) : (
                      <span className="badge bg-line text-muted">غیرفعال</span>
                    )}
                  </td>
                  <td className="text-xs text-muted col-sm">{faNum(p.sold_count)}</td>
                  <td className="text-xs text-muted col-md">{faNum(p.sort_order)}</td>
                  <td className="text-end whitespace-nowrap">
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-cyan"
                      onClick={() => setEditing(p)}
                    >
                      ویرایش
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-danger ms-3"
                      onClick={() => remove(p)}
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
        <PackageForm
          pack={editing === 'new' ? null : editing}
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

function PackageForm({
  pack,
  onClose,
  onDone,
}: {
  pack: Package | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: pack?.name ?? '',
    // ترابایت پیش‌فرض است چون میزبان به ترابایت می‌فروشد
    amount: pack ? String(Number((pack.gb / 1024).toFixed(2))) : '',
    unit: 'TB',
    price_toman: pack ? String(pack.price_toman) : '',
    description: pack?.description ?? '',
    is_active: pack?.is_active ?? true,
    sort_order: String(pack?.sort_order ?? 0),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const gb = Number(form.amount) * (form.unit === 'TB' ? 1024 : 1);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        gb,
        price_toman: Number(form.price_toman),
        description: form.description,
        is_active: form.is_active,
        sort_order: Number(form.sort_order) || 0,
      };
      if (pack) await api.patch('/api/packages', { id: pack.id, ...payload });
      else await api.post('/api/packages', payload);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ذخیره ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={pack ? `ویرایش ${pack.name}` : 'بسته تازه'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="نام بسته" hint="مشتری همین را می‌بیند">
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="بسته یک ترابایتی"
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="مقدار" hint={form.amount ? `${gb.toLocaleString('fa-IR')} گیگابایت` : undefined}>
            <div className="flex gap-2">
              <input
                className="input ltr flex-1"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="1"
              />
              <select
                className="input w-24"
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              >
                <option value="TB">ترابایت</option>
                <option value="GB">گیگابایت</option>
              </select>
            </div>
          </Field>
          <Field label="قیمت (تومان)">
            <input
              className="input ltr"
              value={form.price_toman}
              onChange={(e) => setForm((f) => ({ ...f, price_toman: e.target.value }))}
            />
          </Field>
        </div>

        <Field label="توضیح" hint="اختیاری؛ زیر نام بسته دیده می‌شود">
          <input
            className="input"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="وضعیت" hint="غیرفعال از فروشگاه مشتری ناپدید می‌شود">
            <select
              className="input"
              value={form.is_active ? 'true' : 'false'}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === 'true' }))}
            >
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </Field>
          <Field label="ترتیب نمایش" hint="عدد کوچک‌تر بالاتر">
            <input
              className="input ltr"
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
            />
          </Field>
        </div>

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
          <button
            type="button"
            className="btn"
            onClick={save}
            disabled={busy || !form.name || !gb || !Number(form.price_toman)}
          >
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ═══════════════════════ محصولات ═══════════════════════ */

function Products() {
  const { data, loading, error, reload } = useLoad<{ products: Product[] }>('/api/products');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function remove(p: Product) {
    if (!confirm(`محصول «${p.name}» حذف شود؟`)) return;
    setMsg(null);
    try {
      const res = await api.del<{ deactivated: boolean }>(`/api/products?id=${p.id}`);
      setMsg({
        type: 'success',
        text: res.deactivated
          ? 'این محصول سفارش دارد، پس حذف نشد و فقط غیرفعال شد تا سابقه سالم بماند.'
          : 'محصول حذف شد.',
      });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'حذف ناموفق بود' });
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          + محصول تازه
        </button>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      {!data.products.length ? (
        <Notice type="warn">هنوز محصولی تعریف نشده.</Notice>
      ) : (
        <div className="card table-wrap">
          <table className="tbl sm:min-w-[760px]">
            <thead>
              <tr>
                <th>نام</th>
                <th>قیمت</th>
                <th className="col-sm">راه‌اندازی</th>
                <th>موجودی</th>
                <th>وضعیت</th>
                <th className="col-md">سفارش</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p) => (
                <tr key={p.id} className={p.is_active ? '' : 'opacity-60'}>
                  <td className="text-xs font-medium">
                    {p.name}
                    {p.spec_cpu && (
                      <span className="text-muted block text-[11px] truncate max-w-[240px]">
                        {[p.spec_cpu, p.spec_ram, p.spec_disk].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="text-xs sm:whitespace-nowrap">
                    {formatToman(p.price_toman)}
                    <span className="text-muted block text-[11px]">
                      {p.billing_months === 1 ? 'ماهانه' : `هر ${faNum(p.billing_months)} ماه`}
                    </span>
                  </td>
                  <td className="text-xs col-sm sm:whitespace-nowrap">
                    {p.setup_toman > 0 ? formatToman(p.setup_toman) : '—'}
                  </td>
                  <td className="text-xs">
                    {p.stock === null ? (
                      <span className="text-muted">نامحدود</span>
                    ) : p.stock > 0 ? (
                      faNum(p.stock)
                    ) : (
                      <span className="text-danger">تمام شد</span>
                    )}
                  </td>
                  <td className="text-xs">
                    {p.is_active ? (
                      <span className="badge bg-ok/15 text-ok">فعال</span>
                    ) : (
                      <span className="badge bg-line text-muted">غیرفعال</span>
                    )}
                  </td>
                  <td className="text-xs text-muted col-md">{faNum(p.order_count)}</td>
                  <td className="text-end whitespace-nowrap">
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-cyan"
                      onClick={() => setEditing(p)}
                    >
                      ویرایش
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-danger ms-3"
                      onClick={() => remove(p)}
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
        <ProductForm
          product={editing === 'new' ? null : editing}
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

function ProductForm({
  product,
  onClose,
  onDone,
}: {
  product: Product | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: product?.name ?? '',
    kind: product?.kind ?? 'dedicated',
    summary: product?.summary ?? '',
    spec_cpu: product?.spec_cpu ?? '',
    spec_ram: product?.spec_ram ?? '',
    spec_disk: product?.spec_disk ?? '',
    spec_bandwidth: product?.spec_bandwidth ?? '',
    spec_location: product?.spec_location ?? '',
    price_toman: product ? String(product.price_toman) : '',
    setup_toman: product ? String(product.setup_toman) : '0',
    billing_months: String(product?.billing_months ?? 1),
    // رشته خالی یعنی نامحدود
    stock: product?.stock === null || product === null ? '' : String(product.stock),
    is_active: product?.is_active ?? true,
    sort_order: String(product?.sort_order ?? 0),
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
        price_toman: Number(form.price_toman),
        setup_toman: Number(form.setup_toman) || 0,
        billing_months: Number(form.billing_months) || 1,
        sort_order: Number(form.sort_order) || 0,
      };
      if (product) await api.patch('/api/products', { id: product.id, ...payload });
      else await api.post('/api/products', payload);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ذخیره ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open wide title={product ? `ویرایش ${product.name}` : 'محصول تازه'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="نام محصول">
            <input className="input" value={form.name} onChange={set('name')} placeholder="سرور اختصاصی E3" />
          </Field>
          <Field label="نوع">
            <select className="input" value={form.kind} onChange={set('kind')}>
              <option value="dedicated">سرور اختصاصی</option>
              <option value="other">سایر</option>
            </select>
          </Field>
        </div>

        <Field label="توضیح کوتاه" hint="زیر نام محصول دیده می‌شود">
          <textarea className="input" rows={2} value={form.summary} onChange={set('summary')} />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="پردازنده"><input className="input" value={form.spec_cpu} onChange={set('spec_cpu')} placeholder="Xeon E3-1270 v6" /></Field>
          <Field label="حافظه"><input className="input" value={form.spec_ram} onChange={set('spec_ram')} placeholder="۳۲ گیگابایت DDR4" /></Field>
          <Field label="دیسک"><input className="input" value={form.spec_disk} onChange={set('spec_disk')} placeholder="۲×۵۱۲ گیگ NVMe" /></Field>
          <Field label="ترافیک"><input className="input" value={form.spec_bandwidth} onChange={set('spec_bandwidth')} placeholder="۱۰ ترابایت ماهانه" /></Field>
          <Field label="موقعیت"><input className="input" value={form.spec_location} onChange={set('spec_location')} placeholder="تهران" /></Field>
          <Field label="دوره صورتحساب (ماه)"><input className="input ltr" value={form.billing_months} onChange={set('billing_months')} /></Field>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="قیمت دوره (تومان)">
            <input className="input ltr" value={form.price_toman} onChange={set('price_toman')} />
          </Field>
          <Field label="هزینه راه‌اندازی" hint="یک بار؛ صفر یعنی ندارد">
            <input className="input ltr" value={form.setup_toman} onChange={set('setup_toman')} />
          </Field>
          <Field label="موجودی" hint="خالی یعنی نامحدود">
            <input className="input ltr" value={form.stock} onChange={set('stock')} />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="وضعیت" hint="غیرفعال از فروشگاه مشتری ناپدید می‌شود">
            <select
              className="input"
              value={form.is_active ? 'true' : 'false'}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === 'true' }))}
            >
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </Field>
          <Field label="ترتیب نمایش" hint="عدد کوچک‌تر بالاتر">
            <input className="input ltr" value={form.sort_order} onChange={set('sort_order')} />
          </Field>
        </div>

        <Notice type="warn">
          سرور اختصاصی خودکار ساخته نمی‌شود. پس از پرداخت، سفارش در بخش «سفارش‌ها» منتظر تحویل
          دستی شما می‌ماند.
        </Notice>

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
          <button
            type="button"
            className="btn"
            onClick={save}
            disabled={busy || !form.name || !Number(form.price_toman)}
          >
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
