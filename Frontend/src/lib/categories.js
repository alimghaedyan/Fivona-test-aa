/** متادیتای دسته‌بندی‌ها؛ بر اساس نام دسته (همان نام‌های پیش‌فرض بک‌اند) */
export const incomeCategories = {
  'حقوق و دستمزد': { icon: 'briefcase', color: '#2563eb' },
  'درآمد فریلنسری': { icon: 'laptop', color: '#7c3aed' },
  'فروش': { icon: 'shopping-cart', color: '#0284c7' },
  'سرمایه‌گذاری': { icon: 'line-chart', color: '#059669' },
  'پاداش': { icon: 'award', color: '#d97706' },
  'هدیه': { icon: 'gift', color: '#db2777' },
  'سایر درآمدها': { icon: 'circle-dollar-sign', color: '#64748b' },
};

export const expenseCategories = {
  'خوراک و مواد غذایی': { icon: 'utensils', color: '#2563eb' },
  'مسکن و قبوض': { icon: 'home', color: '#6366f1' },
  'حمل‌ونقل': { icon: 'car', color: '#0ea5e9' },
  'خرید و پوشاک': { icon: 'shirt', color: '#db2777' },
  'درمان و سلامت': { icon: 'stethoscope', color: '#f59e0b' },
  'آموزش': { icon: 'graduation-cap', color: '#10b981' },
  'سرگرمی': { icon: 'film', color: '#8b5cf6' },
  'سایر هزینه‌ها': { icon: 'shopping-bag', color: '#64748b' },
};

export const paymentMethods = ['انتقال بانکی', 'کارت به کارت', 'وجه نقد', 'درگاه پرداخت', 'سایر'];
export const expenseMethods = ['کارت بانکی', 'نقدی', 'انتقال بانکی', 'سایر'];

const FALLBACK = { icon: 'circle-dollar-sign', color: '#64748b' };

/** پس‌زمینه کم‌رنگ از رنگ دسته؛ در پوسته روشن و تیره هر دو خوانا می‌ماند */
const TINT = 0.1;
export function tint(hex, alpha = TINT) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const withTint = (meta) => ({ ...meta, bg: tint(meta.color) });

export const catMeta = (type, cat) =>
  withTint((type === 'income' ? incomeCategories[cat] : expenseCategories[cat]) || FALLBACK);

export const defaultIncomeNames = Object.keys(incomeCategories);
export const defaultExpenseNames = Object.keys(expenseCategories);

/** رنگ ثابت برای دسته‌های سفارشی کاربر */
const EXTRA_COLORS = ['#0891b2', '#7c3aed', '#db2777', '#059669', '#d97706', '#2563eb'];
export function metaForCategory(type, name, allNames = []) {
  const known = (type === 'income' ? incomeCategories : expenseCategories)[name];
  if (known) return withTint(known);
  const idx = Math.max(0, allNames.indexOf(name));
  return withTint({ icon: 'circle-dollar-sign', color: EXTRA_COLORS[idx % EXTRA_COLORS.length] });
}
