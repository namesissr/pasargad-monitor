'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatFromGb, formatPercent, formatToman } from '@/lib/format';

interface Package {
  id: number;
  name: string;
  gb: number;
  price_toman: number;
  description: string | null;
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
  in_stock: boolean;
}

interface ShopServer {
  id: number;
  name: string;
  main_ip: string | null;
  purchased_gb: number;
  used_gb: number;
  balance_gb: number;
}

interface ShopData {
  enabled: boolean;
  gatewayReady: boolean;
  packages: Package[];
  products: Product[];
  servers: ShopServer[];
}

export default function PortalShopPage() {
  const { data, loading, error, reload } = useLoad<ShopData>('/api/portal/shop');
  const [tab, setTab] = useState<'traffic' | 'products'>('traffic');
  const [buying, setBuying] = useState<Package | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  if (!data.enabled) {
    return <Notice type="warn">فروشگاه در حال حاضر در دسترس نیست.</Notice>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">فروشگاه</h1>
        <p className="text-xs text-muted mt-0.5">
          پس از پرداخت، بسته ترافیک بلافاصله روی سرور اعمال می‌شود.
        </p>
      </div>

      {msg && <Notice type="error">{msg}</Notice>}

      {!data.gatewayReady && (
        <Notice type="warn">
          درگاه پرداخت آنلاین در دسترس نیست. برای خرید با پشتیبانی تماس بگیرید.
        </Notice>
      )}

      <div className="flex gap-1 border-b border-line">
        {([
          ['traffic', `بسته ترافیک (${faNum(data.packages.length)})`],
          ['products', `محصولات (${faNum(data.products.length)})`],
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

      {/* ── بسته‌های ترافیک ────────────────────────────────── */}
      {tab === 'traffic' && (
        <>
          {!data.servers.length ? (
            <Notice type="warn">
              برای خرید بسته ترافیک باید دست‌کم یک سرور داشته باشید.
            </Notice>
          ) : (
            <section className="card p-4 sm:p-5">
              <h2 className="text-sm font-bold mb-3">وضعیت ترافیک سرورهای شما</h2>
              <ul className="space-y-2.5">
                {data.servers.map((s) => {
                  const purchased = Number(s.purchased_gb) || 0;
                  const pct =
                    purchased > 0 ? Math.min(100, (Number(s.used_gb) / purchased) * 100) : null;
                  const balance = Number(s.balance_gb) || 0;

                  return (
                    <li key={s.id}>
                      <div className="flex items-baseline justify-between gap-3 text-xs mb-1 flex-wrap">
                        <span className="font-medium">{s.name}</span>
                        <span className={balance <= 0 ? 'text-danger' : 'text-muted'}>
                          {purchased > 0
                            ? `${formatFromGb(Math.max(0, balance))} باقی‌مانده`
                            : 'ترافیکی ثبت نشده'}
                          {pct !== null && ` · ${formatPercent(pct)} مصرف`}
                        </span>
                      </div>
                      {pct !== null && (
                        <div className="h-1.5 rounded-full bg-line overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-amber' : 'bg-cyan'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {!data.packages.length ? (
            <Notice type="warn">فعلا بسته‌ای برای فروش تعریف نشده.</Notice>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.packages.map((p) => (
                <div key={p.id} className="card p-5 flex flex-col">
                  <h3 className="text-sm font-bold">{p.name}</h3>
                  <div className="text-2xl font-bold text-cyan mt-2">{formatFromGb(p.gb)}</div>
                  {p.description && (
                    <p className="text-[11px] text-muted mt-2 leading-relaxed flex-1">
                      {p.description}
                    </p>
                  )}
                  <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{formatToman(p.price_toman)}</span>
                    <button
                      type="button"
                      className="btn-primary text-xs px-4 py-1.5"
                      onClick={() => setBuying(p)}
                      disabled={!data.gatewayReady || !data.servers.length}
                    >
                      خرید
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── محصولات ────────────────────────────────────────── */}
      {tab === 'products' && (
        <>
          {!data.products.length ? (
            <Notice type="warn">فعلا محصولی برای فروش تعریف نشده.</Notice>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.products.map((p) => (
                <div key={p.id} className="card p-5 flex flex-col">
                  <h3 className="text-sm font-bold">{p.name}</h3>
                  {p.summary && (
                    <p className="text-[11px] text-muted mt-1.5 leading-relaxed">{p.summary}</p>
                  )}

                  <dl className="mt-3 space-y-1.5 text-[11px] flex-1">
                    {[
                      ['پردازنده', p.spec_cpu],
                      ['حافظه', p.spec_ram],
                      ['دیسک', p.spec_disk],
                      ['ترافیک', p.spec_bandwidth],
                      ['موقعیت', p.spec_location],
                    ]
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2 border-b border-line/40 pb-1">
                          <dt className="text-muted shrink-0">{k}</dt>
                          <dd className="text-end">{v}</dd>
                        </div>
                      ))}
                  </dl>

                  <div className="mt-4 pt-3 border-t border-line/60">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold">{formatToman(p.price_toman)}</span>
                      <span className="text-[11px] text-muted">
                        {p.billing_months === 1 ? 'ماهانه' : `هر ${faNum(p.billing_months)} ماه`}
                      </span>
                    </div>
                    {p.setup_toman > 0 && (
                      <p className="text-[11px] text-amber mt-1">
                        به‌علاوه {formatToman(p.setup_toman)} هزینه راه‌اندازی
                      </p>
                    )}
                    <button
                      type="button"
                      className="btn-primary w-full mt-3 text-xs py-2"
                      onClick={() => setProduct(p)}
                      disabled={!data.gatewayReady || !p.in_stock}
                    >
                      {p.in_stock ? 'سفارش و پرداخت' : 'موجود نیست'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Notice type="info">
            سرور اختصاصی پس از پرداخت به‌صورت دستی آماده و تحویل می‌شود. زمان تحویل معمولا چند
            ساعت است و با پیامک و ایمیل خبر می‌دهیم.
          </Notice>
        </>
      )}

      {buying && (
        <BuyPackage
          pack={buying}
          servers={data.servers}
          onClose={() => setBuying(null)}
          onError={(m) => {
            setBuying(null);
            setMsg(m);
          }}
        />
      )}

      {product && (
        <BuyProduct
          product={product}
          onClose={() => setProduct(null)}
          onError={(m) => {
            setProduct(null);
            setMsg(m);
          }}
        />
      )}
    </div>
  );
}

/**
 * خرید در دو گام انجام می‌شود: اول فاکتور ساخته می‌شود، بعد همان مسیر
 * پرداختی که برای تمدید هم استفاده می‌شود صدا زده می‌شود.
 *
 * تکرارنکردن منطق درگاه عمدی است. اگر اینجا هم پرداخت شروع می‌شد، دو
 * پیاده‌سازی داشتیم که دیر یا زود از هم دور می‌افتند.
 */
async function startPayment(payload: Record<string, unknown>): Promise<string> {
  const created = await api.post<{ invoiceId: number }>('/api/portal/shop/buy', payload);
  const pay = await api.post<{ url: string }>(`/api/portal/invoices/${created.invoiceId}/pay`);
  return pay.url;
}

function BuyPackage({
  pack,
  servers,
  onClose,
  onError,
}: {
  pack: Package;
  servers: ShopServer[];
  onClose: () => void;
  onError: (message: string) => void;
}) {
  // اگر فقط یک سرور دارد، همان از قبل انتخاب می‌شود
  const [serverId, setServerId] = useState(servers.length === 1 ? String(servers[0].id) : '');
  const [busy, setBusy] = useState(false);

  async function buy() {
    setBusy(true);
    try {
      const url = await startPayment({
        type: 'traffic',
        package_id: pack.id,
        server_id: Number(serverId),
      });
      window.location.href = url;
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'شروع خرید ناموفق بود');
    }
  }

  const chosen = servers.find((s) => String(s.id) === serverId);

  return (
    <Modal open title={`خرید ${pack.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="card p-4 bg-panel2/40">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm">{pack.name}</span>
            <span className="text-sm font-bold">{formatToman(pack.price_toman)}</span>
          </div>
          <p className="text-[11px] text-muted mt-1">
            {formatFromGb(pack.gb)} ترافیک، بدون انقضا
          </p>
        </div>

        <Field label="روی کدام سرور اعمال شود؟">
          <select className="input" value={serverId} onChange={(e) => setServerId(e.target.value)}>
            <option value="">— انتخاب کنید —</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.main_ip ? ` — ${s.main_ip}` : ''}
              </option>
            ))}
          </select>
        </Field>

        {chosen && (
          <p className="text-[11px] text-muted leading-relaxed">
            موجودی فعلی «{chosen.name}»: {formatFromGb(Math.max(0, Number(chosen.balance_gb)))}
            {' → '}
            پس از خرید:{' '}
            <span className="text-ok">
              {formatFromGb(Math.max(0, Number(chosen.balance_gb)) + Number(pack.gb))}
            </span>
          </p>
        )}

        <Notice type="info">
          پس از پرداخت موفق، ترافیک بلافاصله روی همین سرور اعمال می‌شود.
        </Notice>

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <button type="button" className="btn" onClick={buy} disabled={busy || !serverId}>
            {busy ? 'در حال انتقال…' : 'پرداخت'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BuyProduct({
  product,
  onClose,
  onError,
}: {
  product: Product;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const total = Number(product.price_toman) + Number(product.setup_toman);

  async function buy() {
    setBusy(true);
    try {
      const url = await startPayment({ type: 'product', product_id: product.id, note });
      window.location.href = url;
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'ثبت سفارش ناموفق بود');
    }
  }

  return (
    <Modal open title={`سفارش ${product.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="card p-4 bg-panel2/40 space-y-1.5 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-muted">
              اجاره {product.billing_months === 1 ? 'ماهانه' : `${faNum(product.billing_months)} ماهه`}
            </span>
            <span>{formatToman(product.price_toman)}</span>
          </div>
          {product.setup_toman > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-muted">هزینه راه‌اندازی</span>
              <span>{formatToman(product.setup_toman)}</span>
            </div>
          )}
          <div className="flex justify-between gap-3 pt-2 border-t border-line/60 font-bold">
            <span>مبلغ قابل پرداخت</span>
            <span>{formatToman(total)}</span>
          </div>
        </div>

        <Field label="توضیح" hint="اختیاری — مثلا سیستم‌عامل یا تنظیمات دلخواه">
          <textarea
            className="input"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <Notice type="warn">
          این سرور پس از پرداخت به‌صورت دستی آماده و تحویل می‌شود. با پیامک و ایمیل خبر
          می‌دهیم.
        </Notice>

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <button type="button" className="btn" onClick={buy} disabled={busy}>
            {busy ? 'در حال انتقال…' : 'پرداخت'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
