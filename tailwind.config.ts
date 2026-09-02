import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // پالت «اتاق سرور» — سرد، تیره، با تأکید فیروزه‌ای
        rack: '#0A0D12',   // پس‌زمینه
        panel: '#121721',  // سطح کارت
        panel2: '#171E2A', // سطح دوم
        line: '#1E2633',   // خط جداکننده
        cyan: '#3ED6C5',   // عمل و تأکید
        amber: '#F2B44C',  // هشدار
        danger: '#F2555A', // خطر
        ok: '#4ADE80',     // سالم
        muted: '#7C8AA0',  // متن کم‌رنگ
      },
      fontFamily: {
        sans: ['Vazirmatn', 'Tahoma', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
