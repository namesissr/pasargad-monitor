import { query, queryOne } from '@/lib/db';
import { getSettings } from '@/lib/settings';

/**
 * جزئیات یک فاکتور.
 *
 * ── چرا یک تابع مشترک ──────────────────────────────────────
 *
 * پنل و پرتال هر دو همین فاکتور را نشان می‌دهند. اگر هرکدام کوئری خودش
 * را داشته باشد، دیر یا زود مبلغ یا تخفیف در یکی درست و در دیگری غلط
 * می‌شود — و آن یکی که غلط است همان است که مشتری می‌بیند.
 *
 * ── مرز چیزی که مشتری می‌بیند ──────────────────────────────
 *
 * سه چیز هرگز به مشتری برنمی‌گردد:
 *
 *   callback_raw     پارامترهای خام درگاه؛ ابزار عیب‌یابی ماست
 *   note             یادداشت داخلی روی فاکتور
 *   admin_note       یادداشت داخلی روی سفارش
 *
 * جداکردنشان با «یادم باشد در پرتال حذفشان کنم» کار نمی‌کند. پس
 * customerView آن‌ها را از شیء بیرون می‌کشد و مسیر پرتال فقط از همان
 * رد می‌شود.
 */

export interface InvoiceDetail {
  invoice: Record<string, unknown>;
  customer: Record<string, unknown> | null;
  server: Record<string, unknown> | null;
  order: Record<string, unknown> | null;
  discount: Record<string, unknown> | null;
  topups: Record<string, unknown>[];
  seller: {
    name: string;
    id: string;
    phone: string;
    address: string;
    footer: string;
  };
}

/** فیلدهایی که فقط در پنل دیده می‌شوند */
const ADMIN_ONLY = ['callback_raw', 'note'] as const;

export async function invoiceDetail(invoiceId: number): Promise<InvoiceDetail | null> {
  const invoice = await queryOne(
    `SELECT i.id, i.number, i.kind, i.title, i.status,
            i.amount_toman::float8      AS amount_toman,
            i.subtotal_toman::float8    AS subtotal_toman,
            i.discount_toman::float8    AS discount_toman,
            i.traffic_gb::float8        AS traffic_gb,
            i.period_from, i.period_to, i.due_at, i.paid_at,
            i.created_at, i.updated_at,
            i.gateway, i.payment_ref, i.payment_code, i.card_number,
            i.payment_error, i.last_attempt_at, i.callback_raw, i.note,
            i.customer_id, i.server_id, i.order_id, i.discount_code_id,
            u.username AS created_by_name
       FROM invoices i
       LEFT JOIN users u ON u.id = i.created_by
      WHERE i.id = $1`,
    [invoiceId],
  );

  if (!invoice) return null;

  const customer = await queryOne(
    `SELECT id, name, company, phone, email, national_id, address
       FROM customers WHERE id = $1`,
    [invoice.customer_id],
  );

  const server = invoice.server_id
    ? await queryOne(
        `SELECT s.id, s.name, s.hostname, s.renews_at, s.renewal_months,
                s.renewal_price_toman::float8 AS renewal_price_toman,
                d.name AS datacenter_name
           FROM servers s
           LEFT JOIN datacenters d ON d.id = s.datacenter_id
          WHERE s.id = $1`,
        [invoice.server_id],
      )
    : null;

  const order = invoice.order_id
    ? await queryOne(
        `SELECT o.id, o.number, o.product_name, o.status, o.price_toman::float8 AS price_toman,
                o.paid_at, o.created_at, o.server_id, o.note, o.admin_note,
                s.name AS server_name
           FROM orders o
           LEFT JOIN servers s ON s.id = o.server_id
          WHERE o.id = $1`,
        [invoice.order_id],
      )
    : null;

  const discount = invoice.discount_code_id
    ? await queryOne(
        `SELECT id, code, title FROM discount_codes WHERE id = $1`,
        [invoice.discount_code_id],
      )
    : null;

  // شارژ ترافیکی که همین فاکتور تحویل داده. برای فاکتور تمدید یا محصول
  // خالی است، و همین درست است.
  const topups = await query(
    `SELECT id, gb::float8 AS gb, created_at, note
       FROM traffic_topups
      WHERE invoice_id = $1
      ORDER BY created_at`,
    [invoiceId],
  );

  const s = await getSettings();

  return {
    invoice,
    customer,
    server,
    order,
    discount,
    topups,
    seller: {
      name: s.invoice_seller_name || s.panel_title || 'پاسارگاد میزبان',
      id: s.invoice_seller_id || '',
      phone: s.invoice_seller_phone || '',
      address: s.invoice_seller_address || '',
      footer: s.invoice_footer || '',
    },
  };
}

/**
 * همان جزئیات، بدون هرچه داخلی است.
 *
 * حذف‌کردن، نه انتخاب‌کردن: اگر ستون داخلی تازه‌ای به کوئری اضافه شود و
 * کسی یادش برود اینجا را به‌روز کند، دست‌کم فهرست ADMIN_ONLY یک جای
 * مشخص است که همه‌شان آنجا جمع‌اند.
 */
export function customerView(detail: InvoiceDetail): InvoiceDetail {
  const invoice = { ...detail.invoice };
  for (const key of ADMIN_ONLY) delete invoice[key];

  const order = detail.order ? { ...detail.order } : null;
  if (order) delete order.admin_note;

  return { ...detail, invoice, order };
}
