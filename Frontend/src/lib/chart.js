/* تنظیمات مشترک نمودارها ـ با پشتیبانی از پوسته روشن و تیره */
import Chart from 'chart.js/auto';

Chart.defaults.font.family = 'Vazirmatn';
Chart.defaults.font.size = 12;

/** رنگ‌های نمودار بر اساس پوسته فعال */
export function chartPalette() {
  const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
  return dark
    ? { text: '#93a3bc', grid: 'rgba(148,163,184,.16)', surface: '#111a2b', net: '#dbe6f7' }
    : { text: '#94a3b8', grid: '#eef2f7', surface: '#ffffff', net: '#0f172a' };
}

export const chartSurface = () => chartPalette().surface;
export const chartNet = () => chartPalette().net;

Chart.defaults.color = chartPalette().text;

if (typeof window !== 'undefined') {
  window.addEventListener('finova:theme', () => {
    Chart.defaults.color = chartPalette().text;
    Object.values(Chart.instances).forEach((chart) => chart.update('none'));
  });
}

export { Chart };

export const chartTip = {
  rtl: true,
  textDirection: 'rtl',
  backgroundColor: '#0f172a',
  padding: 12,
  cornerRadius: 10,
  borderColor: 'rgba(148,163,184,.28)',
  borderWidth: 1,
  titleFont: { family: 'Vazirmatn', weight: '700' },
  bodyFont: { family: 'Vazirmatn' },
  boxPadding: 6,
  usePointStyle: true,
};

/** رنگ خطوط شبکه به‌صورت پویا با تغییر پوسته به‌روز می‌شود */
export const chartGridY = { color: () => chartPalette().grid, drawTicks: false };
export const chartGrid = { color: () => chartPalette().grid };

export const faDec = (n, d = 1) =>
  new Intl.NumberFormat('fa-IR', { maximumFractionDigits: d }).format(n);

/** الگوی راه‌راه برای ستون‌های پیش‌بینی */
export function stripes(color, bg) {
  const c = document.createElement('canvas');
  c.width = c.height = 10;
  const x = c.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, 10, 10);
  x.strokeStyle = color;
  x.lineWidth = 2.2;
  x.beginPath();
  x.moveTo(-2, 12); x.lineTo(12, -2);
  x.moveTo(-2, 2); x.lineTo(2, -2);
  x.moveTo(8, 12); x.lineTo(12, 8);
  x.stroke();
  return x.createPattern(c, 'repeat');
}
