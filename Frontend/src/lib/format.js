import { jalali } from './jalali.js';

const FA = '۰۱۲۳۴۵۶۷۸۹';
const nf = new Intl.NumberFormat('fa-IR');

let dateFormat = 'numeric';
export function setDateFormat(mode) {
  dateFormat = mode === 'long' ? 'long' : 'numeric';
}

export const fmt = {
  digits: (s) => String(s).replace(/\d/g, (d) => FA[d]),
  /** ارقام فارسی و عربی ← لاتین */
  toLatin: (s) => String(s)
    .replace(/[۰-۹]/g, (d) => FA.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)),
  money: (n) => nf.format(Math.round(n)),
  toman: (n) => nf.format(Math.round(n)) + ' تومان',
  million: (n, d = 2) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: d }).format(n / 1e6),
  percent(n) { return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(Math.abs(n)) + '٪'; },
  /** نمایش تاریخ مطابق تنظیم قالب نمایش تاریخ */
  date(iso) { return dateFormat === 'long' ? fmt.dateLong(iso) : fmt.dateInput(iso); },
  /** تاریخ شمسی عددی ۱۴۰۵/۰۷/۲۶ */
  dateInput(iso) {
    const j = jalali.fromISO(iso);
    return fmt.digits(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`);
  },
  /** نمایش تاریخ شمسی بلند: ۲۶ مهر ۱۴۰۵ */
  dateLong(iso) {
    const j = jalali.fromISO(iso);
    return fmt.digits(`${j.jd} ${jalali.monthNames[j.jm - 1]} ${j.jy}`);
  },
  escape: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  /** تاریخ کامل با ساعت، برای مهر زمانی ذخیره‌سازی */
  stamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${fmt.dateLong(day)}، ساعت ${fmt.digits(pad(d.getHours()) + ':' + pad(d.getMinutes()))}`;
  },
};
