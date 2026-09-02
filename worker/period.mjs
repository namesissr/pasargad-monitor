/**
 * محاسبه بازه دوره جاری برای هشدار سهمیه ترافیک.
 *
 * برای ماه شمسی از تقویم فارسی خود نود استفاده می‌شود (ICU کامل در نود ۱۸ به
 * بعد هست) نه از الگوریتم دستی. ترفند ساده است: روزِ ماه شمسی امروز را
 * می‌گیریم و همان تعداد منهای یک روز عقب می‌رویم تا به یکم ماه برسیم.
 *
 * سمت پنل همین محاسبه با lib/jalali.ts انجام می‌شود. هر دو باید یک بازه
 * بدهند، وگرنه عددی که هشدار می‌بیند با عددی که ادمین می‌بیند فرق می‌کند.
 */

const jalaliDay = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  day: 'numeric',
  timeZone: process.env.REPORT_TZ || 'Asia/Tehran',
});

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** یکم ماه شمسیِ تاریخ داده‌شده، به میلادی */
function jalaliMonthStart(date) {
  const day = Number(jalaliDay.format(date));
  return addDays(date, -(day - 1));
}

/** بازه دوره جاری به شکل { from, to } با تاریخ میلادی YYYY-MM-DD */
export function currentPeriod(calendar = 'jalali', now = new Date()) {
  if (calendar === 'gregorian') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: iso(from), to: iso(to) };
  }

  const from = jalaliMonthStart(now);
  // ۳۲ روز جلوتر قطعاً در ماه بعد است؛ یکم آن ماه منهای یک روز یعنی پایان ماه جاری
  const nextStart = jalaliMonthStart(addDays(from, 32));
  return { from: iso(from), to: iso(addDays(nextStart, -1)) };
}
