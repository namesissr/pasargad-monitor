#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
پیش‌نمایش قالب ایمیل، بدون فرستادن چیزی.

قالب در worker/mail-template.mjs جاوااسکریپت است و برای دیدنش نباید
مجبور باشید ایمیل بفرستید. این اسکریپت همان فایل را می‌خواند، مقدارها
را جای متغیرها می‌گذارد و چهار حالت را در یک فایل اچ‌تی‌ام‌ال کنار هم
می‌گذارد تا در مرورگر باز کنید.

**این جایگزین آزمون نیست.** فقط برای دیدن است — کلاینت‌های ایمیل
اچ‌تی‌ام‌ال را جور دیگری رندر می‌کنند و تأیید نهایی با «ارسال ایمیل
آزمایشی» در صفحه تنظیمات است.

اجرا:  python3 scripts/preview-email.py [مسیر-خروجی]
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PANEL_URL = "https://panel.example.com"
BRAND = "پاسارگاد میزبان"

KIND_COLOR = {"info": "#3ed6c5", "ok": "#4ade80", "warn": "#f2b44c", "danger": "#f2555a"}
KIND_LABEL = {"info": "اطلاع", "ok": "برطرف شد", "warn": "هشدار", "danger": "بحرانی"}

SAMPLES = [
    ("danger", "ترافیک سرور «وب-۱» تمام شد",
     "پاسارگاد میزبان: ترافیک سرور «وب-۱» تمام شد (۱۰۲٫۴ از ۱۰۰ ترابایت).\n"
     "برای خرید ترافیک با پشتیبانی تماس بگیرید."),
    ("warn", "ترافیک سرور «وب-۱» رو به اتمام است",
     "پاسارگاد میزبان: ترافیک سرور «وب-۱» رو به اتمام است "
     "(۹۲ از ۱۰۰ ترابایت مصرف، ۸ ترابایت باقی‌مانده)."),
    ("warn", "موعد تمدید سرور «دیتابیس-۲» امروز است",
     "پاسارگاد میزبان: موعد تمدید سرور «دیتابیس-۲» امروز است.\n"
     "برای تمدید با پشتیبانی تماس بگیرید."),
    ("ok", "آزمایش ارسال ایمیل — پاسارگاد میزبان",
     "این یک ایمیل آزمایشی از پنل مانیتورینگ پاسارگاد میزبان است.\n\n"
     "اگر این پیام را می‌بینید، تنظیمات سرور ایمیل درست است و قالب هم درست ساخته شده."),
]


def esc(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def template_source():
    """بدنه رشته قالبی renderEmail را از فایل جاوااسکریپت بیرون می‌کشد"""
    src = io.open(os.path.join(ROOT, "worker", "mail-template.mjs"), encoding="utf-8").read()
    start = src.index("return `<!DOCTYPE")
    body = src[start + len("return `"):]
    return body[: body.index("`;")]


def paragraphs(text):
    out = []
    for block in re.split(r"\n{2,}", text):
        block = block.strip()
        if not block:
            continue
        out.append(
            '<p style="margin:0 0 14px;font-size:15px;line-height:1.9;color:#1a2130;">'
            + esc(block).replace("\n", "<br />")
            + "</p>"
        )
    return "\n          ".join(out)


def render(subject, text, kind):
    tpl = template_source()
    color = KIND_COLOR[kind]
    label = KIND_LABEL[kind]
    base = PANEL_URL.rstrip("/")
    preheader = esc(text.split("\n")[0][:120])

    font_face = """
    @font-face {
      font-family: 'YekanBakh';
      src: url('%s/fonts/YekanBakh-Regular.ttf') format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'YekanBakh';
      src: url('%s/fonts/YekanBakh-Bold.ttf') format('truetype');
      font-weight: 700;
      font-style: normal;
    }""" % (base, base)

    cta = """
              <tr>
                <td style="padding:6px 0 4px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:#0a0d12;border-radius:8px;">
                        <a href="%s" style="display:inline-block;padding:11px 26px;font-family:${FONT_STACK};font-size:14px;font-weight:700;color:#3ed6c5;text-decoration:none;">
                          باز کردن پنل
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>""" % esc(base)

    out = tpl
    out = out.replace("${fontFace}", font_face)
    out = out.replace("${cta}", cta)
    out = out.replace("${color}", color)
    out = out.replace("${esc(label)}", esc(label))
    out = out.replace("${esc(subject)}", esc(subject))
    out = out.replace("${esc(brand)}", esc(BRAND))
    out = out.replace("${preheader}", preheader)
    out = out.replace("${paragraphs(text)}", paragraphs(text))
    out = out.replace(
        "${FONT_STACK}", "'YekanBakh', Tahoma, 'Segoe UI', Arial, sans-serif"
    )
    return out


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "email-preview.html")

    frames = []
    for kind, subject, text in SAMPLES:
        html = render(subject, text, kind)
        frames.append(
            '<div style="margin:0 0 8px;font:13px Tahoma;color:#444;">%s — %s</div>'
            '<iframe style="width:100%%;max-width:660px;height:520px;border:1px solid #ddd;'
            'border-radius:8px;background:#fff;" srcdoc="%s"></iframe>'
            % (KIND_LABEL[kind], esc(subject), esc(html))
        )

    page = (
        '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8">'
        "<title>پیش‌نمایش قالب ایمیل</title></head>"
        '<body style="background:#eef1f5;padding:24px;font:14px Tahoma;">'
        "<h1 style=\"font-size:17px;\">پیش‌نمایش قالب ایمیل</h1>"
        '<p style="color:#666;max-width:660px;line-height:1.9;">'
        "این فقط برای دیدن است. کلاینت‌های ایمیل اچ‌تی‌ام‌ال را جور دیگری رندر می‌کنند — "
        "جی‌میل و اوت‌لوک قلم سفارشی را حذف می‌کنند و قلم جایگزین را نشان می‌دهند. "
        "تأیید نهایی با «ارسال ایمیل آزمایشی» در صفحه تنظیمات است."
        "</p>" + '<div style="display:grid;gap:26px;">' + "".join(frames) + "</div></body></html>"
    )

    io.open(out_path, "w", encoding="utf-8").write(page)
    print("ساخته شد: %s" % out_path)
    print("در مرورگر بازش کنید.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
