import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';
import { sendSms } from '@/lib/sms';
import { sendEmailTo } from '@/lib/email';
import { getSettings } from '@/lib/settings';
import { deliveryText, deliveryHtmlBlock } from '@/lib/delivery-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * سفارش‌های محصول.
 *
 * تحویل دستی است: سرور اختصاصی خودکار ساخته نمی‌شود. سفارش پرداخت‌شده
 * در صف می‌ماند تا ادمین سرور را بسازد و اینجا به سفارش وصل کند.
 *
 * وصل‌کردن سرور اجباری نیست ولی توصیه می‌شود: بدون آن، بعدها معلوم
 * نیست کدام سرور بابت کدام سفارش تحویل شده.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const status = new URL(req.url).searchParams.get('status') || '';

    const params: unknown[] = [];
    let where = '';
    if (['pending', 'paid', 'provisioned', 'canceled'].includes(status)) {
      params.push(status);
      where = `WHERE o.status = $${params.length}`;
    }

    const orders = await query(
      `SELECT o.id, o.number, o.status, o.product_name,
              o.price_toman::float8 AS price_toman,
              o.note, o.admin_note, o.paid_at, o.created_at,
              c.id AS customer_id, c.name AS customer_name,
              c.phone AS customer_phone, c.email AS customer_email,
              p.id AS product_id,
              i.id AS invoice_id, i.number AS invoice_number, i.status AS invoice_status,
              s.id AS server_id, s.name AS server_name
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         LEFT JOIN products p ON p.id = o.product_id
         LEFT JOIN invoices i ON i.id = o.invoice_id
         LEFT JOIN servers s ON s.id = o.server_id
         ${where}
        ORDER BY
          -- سفارش پرداخت‌شده و تحویل‌نشده اول می‌آید؛ همان است که کار دارد
          CASE o.status WHEN 'paid' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
          o.created_at DESC
        LIMIT 300`,
      params,
    );

    const totals = await queryOne<{ awaiting: number; pending: number }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'paid')::int AS awaiting,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
         FROM orders`,
    );

    return ok({ orders, totals });
  });
}

/** تحویل سفارش، لغو آن، یا ثبت یادداشت داخلی */
export async function PATCH(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<Record<string, unknown>>(req);

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه سفارش نامعتبر است', 400);

    const action = String(body.action ?? '');

    if (action === 'note') {
      await query(
        `UPDATE orders SET admin_note = NULLIF($2,''), updated_at = now() WHERE id = $1`,
        [id, String(body.admin_note ?? '').trim()],
      );
      return ok({ ok: true });
    }

    if (action === 'cancel') {
      const rows = await query<{ id: number }>(
        `UPDATE orders SET status = 'canceled', updated_at = now()
          WHERE id = $1 AND status IN ('pending', 'paid')
          RETURNING id`,
        [id],
      );
      if (!rows.length) return fail('این سفارش قابل لغو نیست', 400);
      return ok({ ok: true });
    }

    if (action === 'provision') {
      const order = await queryOne<{
        id: number;
        number: string;
        status: string;
        product_name: string;
        customer_id: number;
        customer_name: string;
        customer_phone: string | null;
        customer_email: string | null;
      }>(
        `SELECT o.id, o.number, o.status, o.product_name,
                c.id AS customer_id, c.name AS customer_name,
                c.phone AS customer_phone, c.email AS customer_email
           FROM orders o JOIN customers c ON c.id = o.customer_id
          WHERE o.id = $1`,
        [id],
      );
      if (!order) return fail('سفارش پیدا نشد', 404);
      if (order.status !== 'paid') {
        return fail('فقط سفارش پرداخت‌شده تحویل می‌شود', 400);
      }

      // سرور اختیاری است، ولی اگر داده شد باید مال همان مشتری باشد —
      // وگرنه سفارش به سرور کس دیگری وصل می‌شود
      const serverIdRaw = Number(body.server_id);
      const serverId = Number.isInteger(serverIdRaw) && serverIdRaw > 0 ? serverIdRaw : null;

      let server = null;
      if (serverId !== null) {
        server = await queryOne<{
          id: number;
          name: string;
          main_ip: string | null;
          hostname: string | null;
          os: string | null;
          cpu_model: string | null;
          cpu_cores: number | null;
          ram_total_bytes: number | null;
          disk_total_bytes: number | null;
          location: string | null;
          ssh_port: number | null;
        }>(
          `SELECT id, name, host(main_ip) AS main_ip, hostname, os, cpu_model, cpu_cores,
                  ram_total_bytes::float8 AS ram_total_bytes,
                  disk_total_bytes::float8 AS disk_total_bytes,
                  location, ssh_port
             FROM servers WHERE id = $1 AND customer_id = $2`,
          [serverId, order.customer_id],
        );
        if (!server) return fail('این سرور به آن مشتری تعلق ندارد', 400);
      }

      // اطلاعات ورود از فرم می‌آید و **در دیتابیس ذخیره نمی‌شود**.
      // نگهداری‌اش یعنی یک دامپ دیتابیس، رمز همه سرورهای تحویل‌شده را
      // لو می‌دهد. اگر ایمیل نرسید، رمز باید عوض شود — هزینه‌ای که
      // به‌مراتب کمتر از نگهداری رمز است.
      const username = String(body.username ?? '').trim();
      const password = String(body.password ?? '').trim();
      const extraNote = String(body.delivery_note ?? '').trim();

      if (password && !order.customer_email) {
        return fail(
          'این مشتری ایمیل ندارد و اطلاعات ورود جای دیگری فرستاده نمی‌شود. اول ایمیلش را ثبت کنید.',
          400,
        );
      }

      await query(
        `UPDATE orders SET status = 'provisioned', server_id = $2, updated_at = now()
          WHERE id = $1`,
        [id, serverId],
      );

      // خبر تحویل به مشتری. شکست ارسال نباید جلوی ثبت تحویل را بگیرد؛
      // سفارش تحویل شده و همان واقعیت است.
      const s = await getSettings();
      const link = String(s.panel_url || '').replace(/\/+$/, '');

      const delivery = {
        orderNumber: order.number,
        productName: order.product_name,
        customerName: order.customer_name,
        server,
        username,
        password,
        sshPort: server?.ssh_port ?? null,
        extraNote,
        panelUrl: link,
      };

      // پیامک عمداً اطلاعات ورود ندارد: پیامک رمزنگاری نمی‌شود و روی
      // صفحه قفل گوشی هم پیش‌نمایش می‌شود.
      if (order.customer_phone) {
        const r = await sendSms(
          order.customer_phone,
          `پاسارگاد میزبان: سفارش ${order.number} تحویل شد. مشخصات سرور به ایمیل شما فرستاده شد.`,
        );
        if (!r.ok) console.error('[order] پیامک تحویل ارسال نشد:', r.error);
      }

      let emailOk = true;
      if (order.customer_email) {
        const r = await sendEmailTo(
          order.customer_email,
          `سفارش ${order.number} تحویل شد — ${order.product_name}`,
          deliveryText(delivery),
          'ok',
          null,
          deliveryHtmlBlock(delivery),
        ).catch((e) => {
          console.error('[order] ایمیل تحویل ارسال نشد:', e instanceof Error ? e.message : e);
          return { ok: false, error: e instanceof Error ? e.message : 'خطای ناشناخته' };
        });
        emailOk = r.ok;
      } else {
        emailOk = false;
      }

      // اگر ایمیل نرفت، ادمین باید بداند: رمزی که تایپ کرده جایی ذخیره
      // نشده و مشتری آن را ندارد.
      return ok({
        ok: true,
        emailSent: emailOk,
        warning: emailOk
          ? null
          : password
            ? 'ایمیل تحویل ارسال نشد و اطلاعات ورود جایی ذخیره نشده است. رمز را عوض کنید و دوباره بفرستید.'
            : 'ایمیل تحویل ارسال نشد.',
      });
    }

    return fail('عملیات نامعتبر است', 400);
  });
}
