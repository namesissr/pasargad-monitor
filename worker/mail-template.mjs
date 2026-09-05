/**
 * قالب ایمیل پاسارگاد میزبان.
 *
 * ایمیل با اچ‌تی‌ام‌ال وب فرق دارد و این قالب عمداً «قدیمی» نوشته شده:
 *
 *  • چیدمان با جدول است نه flex و grid. اوت‌لوک دسکتاپ موتور رندر ورد
 *    دارد و هیچ‌کدام را نمی‌شناسد.
 *  • استایل درون‌خطی است. جی‌میل بخش زیادی از <style> را حذف می‌کند.
 *  • عرض ثابت ۶۰۰ پیکسل، همان چیزی که همه کلاینت‌ها بی‌دردسر نشان می‌دهند.
 *
 * **درباره قلم:** یکان‌بخ اعلام می‌شود ولی جی‌میل و اوت‌لوک @font-face را
 * حذف می‌کنند. پس قلم جایگزین تزئینی نیست — برای بیشتر گیرنده‌ها همان
 * چیزی است که می‌بینند. Tahoma اول آمده چون روی ویندوز و اوت‌لوک
 * قابل‌اعتمادترین قلم فارسی است.
 *
 * پس‌زمینه روشن است، برخلاف خود پنل. ایمیل تیره در صندوق ورودی روشن
 * مثل یک جعبه خراب دیده می‌شود، و خیلی کلاینت‌ها هم به‌زور روشنش
 * می‌کنند. تیرگی فقط در نوار بالایی می‌ماند — آنجا عمدی به‌نظر می‌رسد.
 */

const FONT_STACK = "'YekanBakh', Tahoma, 'Segoe UI', Arial, sans-serif";

/** رنگ نوار وضعیت، از روی نوع پیام */
const KIND_COLOR = {
  info: '#3ed6c5',
  ok: '#4ade80',
  warn: '#f2b44c',
  danger: '#f2555a',
};

const KIND_LABEL = {
  info: 'اطلاع',
  ok: 'برطرف شد',
  warn: 'هشدار',
  danger: 'بحرانی',
};

/**
 * خنثی‌کردن اچ‌تی‌ام‌ال.
 *
 * نام سرور و مشتری از دیتابیس می‌آید و ادمین آن را تایپ کرده. یک علامت
 * کوچک‌تر در نام، بدون این، کل قالب را از هم می‌پاشد.
 */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** متن ساده به پاراگراف؛ خط خالی یعنی پاراگراف تازه */
function paragraphs(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.9;color:#1a2130;">` +
        esc(block).replace(/\n/g, '<br />') +
        `</p>`,
    )
    .join('\n          ');
}

/**
 * قالب کامل.
 *
 * panelUrl برای دو چیز لازم است: آدرس فایل قلم، و دکمه «باز کردن پنل».
 * اگر تنظیم نشده باشد هر دو حذف می‌شوند و ایمیل باز هم درست است — فقط
 * ساده‌تر.
 */
export function renderEmail({ subject, text, kind = 'info', panelUrl = '', brand = 'پاسارگاد میزبان' }) {
  const color = KIND_COLOR[kind] || KIND_COLOR.info;
  const label = KIND_LABEL[kind] || KIND_LABEL.info;
  const base = String(panelUrl || '').replace(/\/+$/, '');

  // پیش‌نمایش صندوق ورودی: خط اولِ متن، پنهان در خود ایمیل. بدون آن،
  // کلاینت اولین چیزی که پیدا کند را نشان می‌دهد — معمولاً متن پاورقی.
  const preheader = esc(String(text || '').split('\n')[0].slice(0, 120));

  const fontFace = base
    ? `
    @font-face {
      font-family: 'YekanBakh';
      src: url('${base}/fonts/YekanBakh-Regular.ttf') format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'YekanBakh';
      src: url('${base}/fonts/YekanBakh-Bold.ttf') format('truetype');
      font-weight: 700;
      font-style: normal;
    }`
    : '';

  const cta = base
    ? `
              <tr>
                <td style="padding:6px 0 4px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:#0a0d12;border-radius:8px;">
                        <a href="${esc(base)}" style="display:inline-block;padding:11px 26px;font-family:${FONT_STACK};font-size:14px;font-weight:700;color:#3ed6c5;text-decoration:none;">
                          باز کردن پنل
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${esc(subject)}</title>
  <style type="text/css">${fontFace}
    body { margin:0; padding:0; width:100% !important; }
    table { border-collapse:collapse; }
    img { border:0; outline:none; text-decoration:none; }
    a { color:#127f74; }
    /* روی صفحه باریک، حاشیه‌ها جمع می‌شوند تا متن جا بگیرد */
    @media only screen and (max-width:620px) {
      .wrap { width:100% !important; }
      .pad { padding-left:20px !important; padding-right:20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f9;">
    <tr>
      <td align="center" style="padding:28px 12px;">

        <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,0.08);">

          <!-- نوار بالایی: تنها جای تیره، همان پالت پنل -->
          <tr>
            <td class="pad" style="background:#0a0d12;padding:18px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${FONT_STACK};font-size:16px;font-weight:700;color:#e6edf5;">
                    <span style="color:${color};">⬢</span>&nbsp; ${esc(brand)}
                  </td>
                  <td align="left" style="font-family:${FONT_STACK};font-size:11px;color:#7c8aa0;">
                    پنل مانیتورینگ
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- نوار وضعیت: رنگش تنها چیزی است که پیش از خواندن متن، شدت را می‌گوید -->
          <tr><td style="height:4px;background:${color};font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td class="pad" style="padding:28px 32px 24px;font-family:${FONT_STACK};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-bottom:14px;">
                    <span style="display:inline-block;padding:3px 10px;border-radius:20px;background:${color}22;color:#1a2130;font-size:11px;font-weight:700;">
                      ${esc(label)}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:12px;font-size:19px;font-weight:700;line-height:1.6;color:#0a0d12;">
                    ${esc(subject)}
                  </td>
                </tr>
                <tr>
                  <td>
                    ${paragraphs(text)}
                  </td>
                </tr>${cta}
              </table>
            </td>
          </tr>

          <tr>
            <td class="pad" style="padding:16px 32px 24px;border-top:1px solid #e7ebf1;font-family:${FONT_STACK};font-size:11px;line-height:1.9;color:#6b7a90;">
              این پیام به‌صورت خودکار از پنل مانیتورینگ ${esc(brand)} فرستاده شده است.
              <br />
              اگر گمان می‌کنید اشتباهی رخ داده، با پشتیبانی تماس بگیرید.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
