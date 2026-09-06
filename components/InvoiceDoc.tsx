'use client';

import { faInt, faNum, formatJalali, formatJalaliDay, formatToman } from '@/lib/format';

/**
 * سند فاکتور.
 *
 * همان چیزی که مشتری می‌بیند و همان چیزی که ادمین می‌بیند — عمداً یکی
 * است. اگر دو نسخه باشد، تفاوتشان همان جایی است که سر آن بحث می‌شود.
 *
 * ادمین ابزارها و ردپای پرداخت را **بیرون** از این سند می‌گیرد، نه
 * داخلش. سند چیزی است که چاپ می‌شود.
 */

export interface InvoiceRow {
  id: number;
  number: string;
  kind: string;
  title: string;
  status: 'unpaid' | 'paid' | 'canceled';
  amount_toman: number;
  subtotal_toman: number | null;
  discount_toman: number;
  traffic_gb: number | null;
  period_from: string | null;
  period_to: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
  gateway: string | null;
  payment_ref: string | null;
  payment_code: string | null;
  card_number: string | null;
  server_id: number | null;
  order_id: number | null;
  /* فقط در پنل */
  note?: string | null;
  payment_error?: string | null;
  last_attempt_at?: string | null;
  callback_raw?: string | null;
  created_by_name?: string | null;
}

export interface InvoiceParty {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  national_id: string | null;
  address: string | null;
}

export interface InvoiceServer {
  id: number;
  name: string;
  hostname: string | null;
  renews_at: string | null;
  renewal_months: number | null;
  datacenter_name: string | null;
}

export interface InvoiceOrder {
  id: number;
  number: string;
  product_name: string;
  status: string;
  price_toman: number;
  paid_at: string | null;
  server_id: number | null;
  server_name: string | null;
  note: string | null;
  admin_note?: string | null;
}

export interface InvoiceTopup {
  id: number;
  gb: number;
  created_at: string;
  note: string | null;
}

export interface InvoiceAddon {
  id: number;
  kind: 'traffic' | 'ip';
  label: string;
  qty: number;
  unit_toman: number;
  total_toman: number;
  gb: number | null;
  applied_at: string | null;
}

export interface InvoiceDetailData {
  invoice: InvoiceRow;
  customer: InvoiceParty | null;
  server: InvoiceServer | null;
  order: InvoiceOrder | null;
  discount: { id: number; code: string; title: string | null } | null;
  topups: InvoiceTopup[];
  addons: InvoiceAddon[];
  seller: { name: string; id: string; phone: string; address: string; footer: string };
}

export const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  unpaid: { label: 'در انتظار پرداخت', cls: 'bg-amber/15 text-amber' },
  paid: { label: 'پرداخت‌شده', cls: 'bg-ok/15 text-ok' },
  canceled: { label: 'لغو شده', cls: 'bg-line text-muted' },
};

export const INVOICE_KIND: Record<string, string> = {
  renewal: 'تمدید سرویس',
  traffic: 'خرید ترافیک',
  order: 'خرید محصول',
  manual: 'فاکتور دستی',
};

/** یک ردیف «برچسب: مقدار» که اگر مقدار نداشته باشد اصلاً چاپ نمی‌شود */
function Row({ label, value, ltr }: { label: string; value?: string | null; ltr?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-[11px] leading-relaxed">
      <span className="text-muted shrink-0">{label}:</span>
      <span className={ltr ? 'ltr break-anywhere' : 'break-anywhere'}>{value}</span>
    </div>
  );
}

export function InvoiceDoc({ data }: { data: InvoiceDetailData }) {
  const inv = data.invoice;
  const st = INVOICE_STATUS[inv.status] || INVOICE_STATUS.canceled;

  // برای فاکتورهای پیش از افزوده‌شدن ستون تخفیف، مبلغ پیش از تخفیف
  // همان مبلغ نهایی است
  const discount = Number(inv.discount_toman) || 0;
  const subtotal =
    inv.subtotal_toman === null || inv.subtotal_toman === undefined
      ? Number(inv.amount_toman) + discount
      : Number(inv.subtotal_toman);

  // افزودنی‌ها ردیف جدا می‌گیرند، پس قلم اصلی باید بدون آن‌ها نشان داده
  // شود — وگرنه جمع ستون با مبلغ نهایی نمی‌خواند و فاکتور بی‌اعتبار
  // به‌نظر می‌رسد.
  const addons = data.addons ?? [];
  const addonsTotal = addons.reduce((a, x) => a + Number(x.total_toman), 0);
  const baseTotal = subtotal - addonsTotal;

  return (
    <div className="print-doc card p-5 sm:p-7 space-y-6">
      {/* ── سربرگ ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap border-b border-line pb-5">
        <div>
          <h2 className="text-base font-bold">{data.seller.name}</h2>
          <div className="mt-1.5 space-y-0.5">
            <Row label="شناسه" value={data.seller.id} ltr />
            <Row label="تلفن" value={data.seller.phone} ltr />
            <Row label="نشانی" value={data.seller.address} />
          </div>
        </div>

        <div className="text-end">
          <div className="text-xs text-muted">فاکتور</div>
          <div className="text-lg font-bold ltr">{inv.number}</div>
          <span className={`badge mt-1.5 ${st.cls}`}>{st.label}</span>
        </div>
      </div>

      {/* ── طرفین و تاریخ‌ها ──────────────────────────────── */}
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <h3 className="text-xs font-bold mb-2">خریدار</h3>
          {data.customer ? (
            <div className="space-y-0.5">
              <Row label="نام" value={data.customer.name} />
              <Row label="شرکت" value={data.customer.company} />
              <Row label="شناسه ملی" value={data.customer.national_id} ltr />
              <Row label="تلفن" value={data.customer.phone} ltr />
              <Row label="ایمیل" value={data.customer.email} ltr />
              <Row label="نشانی" value={data.customer.address} />
            </div>
          ) : (
            <p className="text-[11px] text-muted">—</p>
          )}
        </div>

        <div>
          <h3 className="text-xs font-bold mb-2">تاریخ‌ها</h3>
          <div className="space-y-0.5">
            <Row label="تاریخ صدور" value={formatJalali(inv.created_at)} />
            <Row label="مهلت پرداخت" value={inv.due_at ? formatJalaliDay(inv.due_at) : null} />
            <Row label="تاریخ پرداخت" value={inv.paid_at ? formatJalali(inv.paid_at) : null} />
            <Row
              label="دوره سرویس"
              value={
                inv.period_from && inv.period_to
                  ? `${formatJalaliDay(inv.period_from)} تا ${formatJalaliDay(inv.period_to)}`
                  : null
              }
            />
            <Row label="نوع" value={INVOICE_KIND[inv.kind] ?? inv.kind} />
          </div>
        </div>
      </div>

      {/* ── اقلام ─────────────────────────────────────────── */}
      <div className="table-wrap">
        <table className="tbl sm:min-w-0">
          <thead>
            <tr>
              <th>شرح</th>
              <th className="text-end">مبلغ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-xs">
                <div className="font-medium">{inv.title}</div>

                {/* زیرِ عنوان، همان چیزی که واقعا تحویل داده می‌شود */}
                {data.server && (
                  <div className="text-[11px] text-muted mt-1">
                    سرور {data.server.name}
                    {data.server.datacenter_name && ` · ${data.server.datacenter_name}`}
                    {inv.kind === 'renewal' &&
                      data.server.renewal_months &&
                      ` · ${faNum(data.server.renewal_months)} ماه`}
                  </div>
                )}
                {inv.traffic_gb ? (
                  <div className="text-[11px] text-muted mt-1">
                    {faInt(Number(inv.traffic_gb))} گیگابایت ترافیک
                  </div>
                ) : null}
                {data.order && (
                  <div className="text-[11px] text-muted mt-1">
                    سفارش <span className="ltr">{data.order.number}</span> · {data.order.product_name}
                  </div>
                )}
              </td>
              <td className="text-xs text-end sm:whitespace-nowrap">{formatToman(baseTotal)}</td>
            </tr>

            {addons.map((x) => (
              <tr key={x.id}>
                <td className="text-xs">
                  {x.label}
                  <span className="block text-[11px] text-muted mt-0.5">
                    {x.kind === 'traffic'
                      ? `${faInt(Number(x.gb))} گیگابایت ترافیک`
                      : `${faNum(x.qty)} عدد × ${formatToman(x.unit_toman)}`}
                  </span>
                </td>
                <td className="text-xs text-end sm:whitespace-nowrap">
                  {formatToman(x.total_toman)}
                </td>
              </tr>
            ))}

            {discount > 0 && (
              <tr>
                <td className="text-xs text-ok">
                  تخفیف
                  {data.discount && (
                    <span className="text-[11px] text-muted ms-1 ltr">({data.discount.code})</span>
                  )}
                </td>
                <td className="text-xs text-end text-ok sm:whitespace-nowrap">
                  −{formatToman(discount)}
                </td>
              </tr>
            )}

            <tr>
              <td className="text-sm font-bold">مبلغ قابل پرداخت</td>
              <td className="text-sm font-bold text-end sm:whitespace-nowrap">
                {formatToman(inv.amount_toman)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── پرداخت ────────────────────────────────────────── */}
      {inv.status === 'paid' && (
        <div className="border border-ok/25 bg-ok/5 rounded-lg p-4 space-y-0.5">
          <h3 className="text-xs font-bold text-ok mb-1.5">اطلاعات پرداخت</h3>
          <Row label="درگاه" value={inv.gateway || 'ثبت دستی'} />
          <Row label="شناسه پیگیری" value={inv.payment_ref} ltr />
          <Row label="کد پرداخت" value={inv.payment_code} ltr />
          <Row label="کارت" value={inv.card_number} ltr />
          <Row label="زمان" value={inv.paid_at ? formatJalali(inv.paid_at) : null} />
        </div>
      )}

      {/* ── چیزی که تحویل داده شد ─────────────────────────── */}
      {data.topups.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-bold">تحویل‌شده</h3>
          {data.topups.map((t) => (
            <div key={t.id} className="text-[11px] text-muted">
              {faInt(Number(t.gb))} گیگابایت ترافیک — {formatJalali(t.created_at)}
            </div>
          ))}
        </div>
      )}

      {data.seller.footer && (
        <p className="text-[11px] text-muted/70 leading-relaxed border-t border-line pt-4">
          {data.seller.footer}
        </p>
      )}
    </div>
  );
}
