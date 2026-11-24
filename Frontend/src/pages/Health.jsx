import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ChartCanvas from '../components/ChartCanvas.jsx';
import { useData } from '../context/DataContext.jsx';
import { budgetCalc, stats } from '../lib/calc.js';
import { fmt } from '../lib/format.js';
import { health as H } from '../lib/health.js';
import { jalali as J } from '../lib/jalali.js';
import { chartGrid, chartSurface, chartTip, faDec } from '../lib/chart.js';

const dec = (n, d = 1) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: d }).format(n);
const pct = (x, d = 1) => (x < 0 ? '−' : '') + dec(Math.abs(x * 100), d) + '٪';
const signed = (n) => (n < 0 ? '−' : '') + fmt.money(Math.abs(n));
const PERIOD = { this: 'این ماه', '3m': '۳ ماه اخیر', '6m': '۶ ماه اخیر' };
const NAMES = { savings: 'نرخ پس‌انداز', budget: 'پایبندی به بودجه', ratio: 'نسبت هزینه به درآمد', consistency: 'ثبات مالی' };
const ICONS = { savings: 'piggy-bank', budget: 'pie-chart', ratio: 'scale', consistency: 'activity' };
const BAND_STYLE = {
  excellent: { color: 'var(--green)', bg: 'var(--green-50)', stroke: '#10b981', icon: 'award' },
  good: { color: 'var(--blue)', bg: 'var(--blue-50)', stroke: '#2563eb', icon: 'thumbs-up' },
  fair: { color: 'var(--amber)', bg: 'var(--amber-50)', stroke: '#f59e0b', icon: 'alert-triangle' },
  poor: { color: 'var(--red)', bg: 'var(--red-50)', stroke: '#ef4444', icon: 'alert-octagon' },
  none: { color: 'var(--ink2)', bg: 'var(--tint-slate)', stroke: '#cbd5e1', icon: 'help-circle' },
};
const SUFF = {
  full: ['داده کامل', 'database', 'var(--green)', 'var(--green-50)'],
  partial: ['داده ناقص', 'database', 'var(--amber)', 'var(--amber-50)'],
  insufficient: ['اطلاعات کافی نیست', 'database-zap', 'var(--red)', 'var(--red-50)'],
};
const monthName = (key) => budgetCalc.monthLabel(key);

const GAUGE_C = 2 * Math.PI * 84;

/* ---------- متن‌های توضیحی ---------- */
function periodText(r, period) {
  const m = r.months;
  if (!m.length) return PERIOD[period];
  return m.length === 1
    ? `${PERIOD[period]} ـ ${monthName(m[0].key)}`
    : `${PERIOD[period]} ـ ${monthName(m[0].key)} تا ${monthName(m[m.length - 1].key)}`;
}
function compStatus(c) {
  if (!c.available) return { label: 'محاسبه نشد', cls: 'na' };
  return c.share >= 0.8 ? { label: 'قوی', cls: 'ok' } : c.share >= 0.5 ? { label: 'قابل قبول', cls: 'mid' } : { label: 'ضعیف', cls: 'low' };
}
function whyText(r) {
  const comps = Object.values(r.components);
  const av = comps.filter((c) => c.available);
  const na = comps.filter((c) => !c.available);
  if (!r.sufficient) {
    return `برای این دوره فقط ${fmt.digits(r.availableWeight)} از ۱۰۰ وزن امتیاز قابل محاسبه است (حداقل لازم ${fmt.digits(H.MIN_WEIGHT)}). `
      + (na.length ? `مؤلفه‌های ${na.map((c) => NAMES[c.key]).join('، ')} به دلیل کمبود داده محاسبه نشدند.` : '');
  }
  const best = av.slice().sort((a, b) => b.share - a.share)[0];
  const worst = av.slice().sort((a, b) => a.share - b.share)[0];
  let t = `امتیاز از ${fmt.digits(av.length)} مؤلفه با مجموع وزن ${fmt.digits(r.availableWeight)} محاسبه و به مقیاس ۱۰۰ تبدیل شده است (${dec(r.earned)} از ${fmt.digits(r.availableWeight)}). `;
  t += `بهترین وضعیت: ${NAMES[best.key]} (${dec(best.points)} از ${fmt.digits(best.weight)})`;
  if (worst !== best) t += `؛ نیازمند توجه: ${NAMES[worst.key]} (${dec(worst.points)} از ${fmt.digits(worst.weight)})`;
  t += '.';
  if (na.length) t += ` ${na.map((c) => NAMES[c.key]).join(' و ')} به دلیل کمبود داده در امتیاز لحاظ نشد.`;
  return t;
}
function compExplain(c) {
  const m = c.metrics;
  switch (c.key) {
    case 'savings':
      return {
        text: m.savingsRate <= 0 ? 'هزینه‌ها برابر یا بیشتر از درآمد بوده و پس‌اندازی شکل نگرفته است.'
          : m.savingsRate >= 0.3 ? 'نرخ پس‌انداز ۳۰٪ یا بیشتر است و امتیاز کامل می‌گیرد.'
            : m.savingsRate >= 0.2 ? 'نرخ پس‌انداز از ۲۰٪ پیشنهادی بالاتر است.'
              : 'نرخ پس‌انداز کمتر از ۲۰٪ پیشنهادی است.',
        facts: [['درآمد', fmt.toman(m.income)], ['هزینه', fmt.toman(m.expense)], ['خالص', `${signed(m.net)} تومان`], ['نرخ پس‌انداز', pct(m.savingsRate)]],
      };
    case 'budget':
      return {
        text: m.over.length ? `${fmt.digits(m.over.length)} بودجه از سقف عبور کرده و امتیاز به نسبت مازاد کم شده است.`
          : m.near.length ? 'همه بودجه‌ها رعایت شده‌اند؛ برخی به سقف نزدیک‌اند.'
            : 'همه بودجه‌های این دوره رعایت شده‌اند.',
        facts: [['تعداد بودجه', fmt.digits(m.count)], ['مجموع سقف', fmt.toman(m.limitTotal)], ['هزینه دسته‌های دارای بودجه', fmt.toman(m.spentTotal)], ['ماه‌های دارای بودجه', `${fmt.digits(m.budgetedMonths)} از ${fmt.digits(m.months)}`]],
      };
    case 'ratio':
      return {
        text: m.ratio >= 1 ? 'هزینه‌ها به اندازه یا بیشتر از درآمد بوده است.'
          : m.ratio <= 0.5 ? 'نیمی از درآمد یا کمتر خرج شده و انعطاف مالی بالاست.'
            : `${pct(m.ratio, 0)} از درآمد صرف هزینه شده است.`,
        facts: [['نسبت هزینه به درآمد', pct(m.ratio)], ['امتیاز کامل', 'تا ۵۰٪'], ['امتیاز صفر', '۱۰۰٪ و بیشتر']],
      };
    case 'consistency':
      return {
        text: 'ترکیبی از منظم بودن ثبت ماهانه، ماه‌های بدون کسری و پایداری هزینه ماهانه.',
        facts: [
          ['ماه‌های با درآمد و هزینه', `${fmt.digits(m.covered)} از ${fmt.digits(m.months)} (${dec(m.parts.coverage)} از ۴)`],
          ['ماه‌های بدون کسری', `${pct(m.positive, 0)} (${dec(m.parts.positive)} از ۳)`],
          ['نوسان هزینه ماهانه', `${m.cv === null ? 'ـ' : pct(m.cv)} (${dec(m.parts.stability)} از ۳)`],
        ],
      };
    default:
      return { text: '', facts: [] };
  }
}

/* ---------- پیشنهادها ---------- */
function buildRecommendations(r, period, transactions, budgets) {
  const out = [];
  const t = r.totals;
  const keys = r.months.map((m) => m.key);
  const last = keys[keys.length - 1];
  const periodExp = transactions.filter((x) => x.type === 'expense' && keys.includes(J.monthKey(x.date)));
  const cats = stats.expenseByCategory(periodExp).rows;
  const top = cats[0];
  const add = (tone, icon, title, reason, href, linkText) => out.push({ tone, icon, title, reason, href, linkText });

  if (!r.sufficient) {
    add('info', 'clipboard-list', 'برای تحلیل دقیق‌تر، درآمدها و هزینه‌های خود را به‌صورت منظم ثبت کنید.',
      `اکنون فقط ${fmt.digits(r.availableWeight)} از ۱۰۰ وزن امتیاز برای ${PERIOD[period]} قابل محاسبه است.`, '/income', 'ثبت درآمد');
  }
  if (t.income === 0 && t.expense > 0) {
    add('warn', 'hand-coins', 'در این دوره درآمدی ثبت نشده است.',
      `${fmt.toman(t.expense)} هزینه ثبت شده ولی درآمدی وجود ندارد؛ بدون درآمد، نرخ پس‌انداز و نسبت هزینه به درآمد محاسبه نمی‌شوند.`, '/income', 'ثبت درآمد');
  }
  if (t.income > 0 && t.expense > t.income) {
    add('bad', 'trending-down', 'هزینه‌های ثبت‌شده از درآمد شما بیشتر است؛ دسته‌های پرهزینه را بررسی کنید.',
      `هزینه ${fmt.toman(t.expense)} در برابر درآمد ${fmt.toman(t.income)}؛ کسری ${fmt.toman(t.expense - t.income)}.` + (top ? ` بیشترین سهم: ${top.name} (${pct(top.share, 0)}).` : ''),
      `/expenses?range=${period}`, 'بررسی هزینه‌ها');
  } else if (t.income > 0 && t.savingsRate < H.RULES.savingsGood) {
    add('warn', 'piggy-bank', 'برای افزایش پس‌انداز، ابتدا هزینه‌های قابل‌کنترل را بررسی کنید.',
      `نرخ پس‌انداز ${pct(t.savingsRate)} است که از ۲۰٪ پیشنهادی کمتر است.` + (top ? ` بزرگ‌ترین دسته هزینه: ${top.name} با ${fmt.toman(top.amount)}.` : ''),
      top ? `/expenses?cat=${encodeURIComponent(top.name)}&range=${period}` : `/expenses?range=${period}`, 'مشاهده هزینه‌های این دسته');
  }

  const b = r.components.budget;
  if (!b.available) {
    add('info', 'pie-chart', 'با تعیین بودجه برای دسته‌های اصلی، کنترل هزینه‌ها را دقیق‌تر کنید.',
      `برای ماه‌های ${PERIOD[period]} بودجه‌ای تعریف نشده و مؤلفه پایبندی به بودجه (۳۰ امتیاز) محاسبه نمی‌شود.`, `/budgets?month=${last}`, 'ایجاد بودجه');
  } else {
    b.metrics.over.slice().sort((x, y) => (y.spent - y.limit) - (x.spent - x.limit)).slice(0, 3).forEach((o) => add('bad', 'alert-octagon',
      `هزینه‌های دسته «${o.category}» از بودجه «${o.title || o.category}» عبور کرده است.`,
      `${monthName(o.month)}: ${fmt.toman(o.spent)} هزینه در برابر سقف ${fmt.toman(o.limit)} (${fmt.toman(o.spent - o.limit)} مازاد).`,
      `/budgets?month=${o.month}`, 'مشاهده بودجه'));
    b.metrics.near.filter((o) => o.month === last).slice(0, 2).forEach((o) => add('warn', 'alert-triangle',
      `بودجه «${o.title || o.category}» (دسته ${o.category}) به سقف نزدیک شده است.`,
      `${fmt.digits(Math.round(o.spent / o.limit * 100))}٪ از سقف ${fmt.toman(o.limit)} در ${monthName(o.month)} مصرف شده است.`,
      `/budgets?month=${o.month}`, 'مشاهده بودجه'));
    const covered = new Set(budgets.filter((x) => x.month === last).map((x) => x.category));
    const lastExp = periodExp.filter((x) => J.monthKey(x.date) === last);
    const lastTotal = lastExp.reduce((a, x) => a + x.amount, 0);
    const unb = stats.expenseByCategory(lastExp).rows.find((c) => !covered.has(c.name));
    if (unb && lastTotal && unb.amount / lastTotal >= 0.15) {
      add('info', 'target', `برای دسته «${unb.name}» بودجه تعیین کنید.`,
        `${pct(unb.amount / lastTotal, 0)} از هزینه‌های ${monthName(last)} (${fmt.toman(unb.amount)}) در این دسته است و بودجه‌ای برای آن تعریف نشده.`,
        `/budgets?month=${last}`, 'تعیین بودجه');
    }
  }

  if (r.months.length > 1 && r.emptyMonths.length) {
    add('info', 'calendar-x', `در ${fmt.digits(r.emptyMonths.length)} ماه از این دوره هیچ تراکنشی ثبت نشده است.`,
      `ماه‌های بدون داده: ${r.emptyMonths.map((m) => monthName(m.key)).join('، ')}. ثبت منظم، تحلیل روند را دقیق‌تر می‌کند.`, '/expenses', 'ثبت هزینه');
  }

  const act = r.months.filter((m) => m.expenseCount > 0);
  if (act.length >= 3) {
    const lastM = act[act.length - 1];
    const prev = act.slice(0, -1);
    const avg = prev.reduce((a, m) => a + m.expense, 0) / prev.length;
    if (avg > 0 && lastM.expense > avg * 1.1) {
      add('warn', 'trending-up', 'هزینه‌های ماه آخر بالاتر از میانگین ماه‌های قبل است.',
        `${monthName(lastM.key)}: ${fmt.toman(lastM.expense)}؛ میانگین ماه‌های قبل ${fmt.toman(avg)} (${pct(lastM.expense / avg - 1, 0)} بیشتر).`,
        `/expenses?range=m:${lastM.key}`, 'بررسی هزینه‌های این ماه');
    }
  }

  if (r.sufficient && t.income > 0 && t.savingsRate >= H.RULES.savingsGood && !(b.available && b.metrics.over.length)) {
    add('good', 'check-circle-2', 'نرخ پس‌انداز در محدوده پیشنهادی است.',
      `${pct(t.savingsRate)} از درآمد این دوره پس‌انداز شده و بودجه‌ای از سقف عبور نکرده است. ثبت منظم را ادامه دهید تا ارزیابی دقیق بماند.`, null, null);
  }

  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b2) => order[a.tone] - order[b2.tone]);
}

function Gauge({ score, stroke }) {
  const [offset, setOffset] = useState(GAUGE_C);
  useEffect(() => {
    const t = setTimeout(() => setOffset(GAUGE_C * (1 - (score || 0) / 100)), 80);
    return () => clearTimeout(t);
  }, [score]);
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="84" className="g-bg" />
      <circle cx="100" cy="100" r="84" className="g-fg"
        style={{ strokeDasharray: GAUGE_C, stroke, strokeDashoffset: offset }} />
    </svg>
  );
}

export default function Health() {
  const { transactions, budgets } = useData();
  const [period, setPeriod] = useState('this');

  const r = useMemo(() => H.forPeriod(transactions, budgets, period), [transactions, budgets, period]);
  const recs = useMemo(() => buildRecommendations(r, period, transactions, budgets), [r, period, transactions, budgets]);

  const bandStyle = BAND_STYLE[r.band ? r.band.key : 'none'];
  const suff = SUFF[r.sufficiency];
  const t = r.totals;
  const n = r.months.length;
  const incCount = r.months.reduce((a, m) => a + m.incomeCount, 0);
  const expCount = r.months.reduce((a, m) => a + m.expenseCount, 0);
  const neg = t.net < 0;
  const none = !t.income && !t.expense;

  /* ---------- نمودارها ---------- */
  const months = r.months;
  const has = (m) => m.incomeCount + m.expenseCount > 0;
  const labels = months.map((m) => (has(m) ? m.label : [m.label, '(بدون داده)']));
  const inc = months.map((m) => (has(m) ? m.income / 1e6 : null));
  const exp = months.map((m) => (has(m) ? m.expense / 1e6 : null));
  const net = months.map((m) => (has(m) ? (m.income - m.expense) / 1e6 : null));
  const rate = months.map((m) => (m.income > 0 ? ((m.income - m.expense) / m.income) * 100 : null));
  const rateOk = rate.filter((v) => v !== null).length >= 2;
  const activeMonths = months.filter(has).length;

  const chartLabels = labels;

  const ieData = useMemo(() => ({
    labels: chartLabels,
    datasets: [
      { label: 'درآمد', data: inc, backgroundColor: '#2563eb', borderRadius: 8, barPercentage: 0.7, categoryPercentage: 0.62, maxBarThickness: 48 },
      { label: 'هزینه', data: exp, backgroundColor: '#f87171', borderRadius: 8, barPercentage: 0.7, categoryPercentage: 0.62, maxBarThickness: 48 },
    ],
  }), [chartLabels, inc, exp]);

  const ieOptions = useMemo(() => ({
    maintainAspectRatio: false,
    animation: { duration: 700 },
    plugins: {
      legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Vazirmatn' }, usePointStyle: true, boxWidth: 8 } },
      tooltip: { ...chartTip, callbacks: { label: (c) => ` ${c.dataset.label}: ${dec(c.raw, 2)} میلیون تومان` } },
    },
    scales: {
      x: { reverse: true, grid: { display: false }, border: { display: false } },
      y: { position: 'right', beginAtZero: true, grid: chartGrid, border: { display: false }, ticks: { callback: (v) => fmt.digits(v) } },
    },
  }), []);

  const netData = useMemo(() => ({
    labels: chartLabels,
    datasets: [
      { type: 'bar', label: 'خالص پس‌انداز', data: net, yAxisID: 'y', backgroundColor: net.map((v) => (v !== null && v < 0 ? '#ef4444' : '#14b8a6')), borderRadius: 8, barPercentage: 0.55, maxBarThickness: 56, order: 2 },
      {
        type: 'line', label: 'نرخ پس‌انداز', data: rateOk ? rate : [], yAxisID: 'y1', borderColor: '#7c3aed', backgroundColor: '#7c3aed',
        borderWidth: 2.5, tension: 0.3, pointRadius: 4, pointBackgroundColor: () => chartSurface(), pointBorderWidth: 2.5, spanGaps: false, order: 1,
      },
    ],
  }), [chartLabels, net, rate, rateOk]);

  const netOptions = useMemo(() => ({
    maintainAspectRatio: false,
    animation: { duration: 700 },
    plugins: {
      legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Vazirmatn' }, usePointStyle: true, boxWidth: 8 } },
      tooltip: {
        ...chartTip,
        callbacks: {
          label: (c) => (c.dataset.yAxisID === 'y1'
            ? ` ${c.dataset.label}: ${dec(c.raw)}٪`
            : ` ${c.dataset.label}: ${c.raw < 0 ? '−' : ''}${dec(Math.abs(c.raw), 2)} میلیون تومان`),
        },
      },
    },
    scales: {
      x: { reverse: true, grid: { display: false }, border: { display: false } },
      y: {
        position: 'right', grid: chartGrid, border: { display: false },
        ticks: { callback: (v) => (v < 0 ? '−' : '') + fmt.digits(Math.abs(v)) },
        title: { display: true, text: 'میلیون تومان', font: { family: 'Vazirmatn' } },
      },
      y1: { display: rateOk, position: 'left', grid: { display: false }, border: { display: false }, ticks: { callback: (v) => fmt.digits(v) + '٪' } },
    },
  }), [rateOk]);

  const trendWarn = [];
  if (months.length === 1) trendWarn.push('در بازه «این ماه» فقط یک ماه بررسی می‌شود؛ برای دیدن روند، بازه ۳ یا ۶ ماهه را انتخاب کنید.');
  if (r.emptyMonths.length) trendWarn.push(`ماه‌های بدون تراکنش (${r.emptyMonths.map((m) => m.label).join('، ')}) با برچسب «بدون داده» نمایش داده شده‌اند و صفر در نظر گرفته نمی‌شوند.`);
  if (!rateOk && months.length > 1) trendWarn.push('روند نرخ پس‌انداز به دست‌کم دو ماه دارای درآمد نیاز دارد و نمایش داده نمی‌شود.');

  const comps = Object.values(r.components);
  const TONE = { bad: 'مهم', warn: 'توجه', info: 'پیشنهاد', good: 'نقطه قوت' };
  const W = H.WEIGHTS;

  return (
    <div className="app-view" id="view-health">
      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <ol>
          <li><Link to="/"><Icon name="home" />داشبورد</Link></li>
          <li aria-hidden="true" className="sep">/</li>
          <li aria-current="page">سلامت مالی</li>
        </ol>
      </nav>

      <div className="page-head">
        <div>
          <h1 tabIndex="-1">سلامت مالی</h1>
          <p>وضعیت مالی خود را بررسی کنید، نقاط قوت و ضعف را بشناسید و برای بهبود آن تصمیم‌های آگاهانه بگیرید.</p>
        </div>
        <div className="head-actions">
          <div className="seg hs-period" role="group" aria-label="دوره تحلیل">
            {[['this', 'این ماه'], ['3m', '۳ ماه اخیر'], ['6m', '۶ ماه اخیر']].map(([key, label]) => (
              <button key={key} type="button" data-hp={key} className={period === key ? 'on' : ''}
                aria-pressed={period === key} onClick={() => setPeriod(key)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="hs-top">
        <article className="card hs-score" aria-labelledby="hsScoreTitle">
          <div className="card-head">
            <div>
              <h2 id="hsScoreTitle">امتیاز سلامت مالی</h2>
              <p>{periodText(r, period)}</p>
            </div>
            <span className="st-pill" style={{ color: suff[2], background: suff[3] }}
              title="مجموع وزن مؤلفه‌هایی که داده کافی برای محاسبه دارند">
              <Icon name={suff[1]} />{suff[0]} ـ {fmt.digits(r.availableWeight)} از ۱۰۰ وزن
            </span>
          </div>
          <div className="hs-gauge-row">
            <div className="hs-gauge" role="img"
              aria-label={r.score === null ? 'امتیاز سلامت مالی: اطلاعات کافی نیست' : `امتیاز سلامت مالی ${fmt.digits(r.score)} از ۱۰۰، وضعیت ${r.band.label}`}>
              <Gauge score={r.score} stroke={bandStyle.stroke} />
              <div className="g-txt">
                <b>{r.score === null ? '؟' : fmt.digits(r.score)}</b>
                <small>{r.score === null ? '' : 'از ۱۰۰'}</small>
                <span className="g-band" style={{ color: bandStyle.color, background: bandStyle.bg }}>
                  <Icon name={bandStyle.icon} />{r.band ? r.band.label : 'اطلاعات کافی نیست'}
                </span>
              </div>
            </div>
            <div className="hs-why">
              <p>{whyText(r)}</p>
              <ul className="hs-scale" aria-label="بازه‌های امتیاز">
                {[['poor', '۰ تا ۳۹ نیازمند بهبود'], ['fair', '۴۰ تا ۵۹ متوسط'], ['good', '۶۰ تا ۷۹ خوب'], ['excellent', '۸۰ تا ۱۰۰ عالی']].map(([key, label]) => {
                  const on = !!r.band && r.band.key === key;
                  return (
                    <li key={key} data-b={key} className={on ? 'on' : ''} aria-current={on ? 'true' : undefined}>
                      <i />{label}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <p className="hs-note"><Icon name="info" />این امتیاز یک شاخص آموزشی بر پایه تراکنش‌های ثبت‌شده شماست و ارزیابی اعتباری یا مشاوره مالی تخصصی نیست.</p>
        </article>

        <article className="card hs-comps" aria-labelledby="hsCompsTitle">
          <div className="card-head">
            <div>
              <h2 id="hsCompsTitle">تفکیک امتیاز</h2>
              <p>{fmt.digits(comps.filter((c) => c.available).length)} از ۴ مؤلفه قابل محاسبه ـ امتیاز خام {dec(r.earned)} از {fmt.digits(r.availableWeight)}</p>
            </div>
          </div>
          <ul className="hs-comp-list">
            {comps.map((c) => {
              const s = compStatus(c);
              const e = c.available ? compExplain(c) : null;
              const w = c.available ? Math.round(c.share * 100) : 0;
              return (
                <li className={`hc hc-${s.cls}`} key={c.key}>
                  <div className="hc-top">
                    <span className="hc-ic"><Icon name={ICONS[c.key]} /></span>
                    <strong>{NAMES[c.key]}</strong>
                    <span className="hc-tag">{s.label}</span>
                    <b className="hc-pts">
                      {c.available ? <>{dec(c.points)} <small>از {fmt.digits(c.weight)}</small></> : <small>ـ از {fmt.digits(c.weight)}</small>}
                    </b>
                  </div>
                  <div className="bar" role="progressbar" aria-valuemin="0" aria-valuemax={c.weight}
                    aria-valuenow={c.points} aria-label={NAMES[c.key]}
                    aria-valuetext={c.available ? `${dec(c.points)} از ${fmt.digits(c.weight)} امتیاز ـ ${s.label}` : 'محاسبه نشد'}>
                    <span style={{ width: `${w}%` }} />
                  </div>
                  {c.available ? (
                    <>
                      <p className="hc-txt">{e.text}</p>
                      <dl className="hc-facts">
                        {e.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                      </dl>
                    </>
                  ) : (
                    <p className="hc-warn"><Icon name="alert-circle" />{c.reason} این مؤلفه امتیازی نمی‌گیرد و از مخرج حذف شده است.</p>
                  )}
                </li>
              );
            })}
          </ul>
        </article>
      </div>

      <div className="kpis kpis-5" id="hsKpis">
        <article className="kpi card">
          <div className="kpi-top"><span className="kpi-ic blue"><Icon name="wallet" /></span></div>
          <span className="kpi-label">مجموع درآمد در دوره انتخاب‌شده</span>
          <div className="kpi-val"><b>{fmt.money(t.income)}</b><small>تومان</small></div>
          <div className="kpi-foot">
            <span>{incCount ? `${fmt.digits(incCount)} درآمد ثبت‌شده${n > 1 ? ` ـ میانگین ماهانه ${fmt.toman(t.income / n)}` : ''}` : 'درآمدی در این دوره ثبت نشده'}</span>
          </div>
        </article>

        <article className="kpi card">
          <div className="kpi-top"><span className="kpi-ic red"><Icon name="credit-card" /></span></div>
          <span className="kpi-label">مجموع هزینه در دوره انتخاب‌شده</span>
          <div className="kpi-val"><b>{fmt.money(t.expense)}</b><small>تومان</small></div>
          <div className="kpi-foot">
            <span>{expCount ? `${fmt.digits(expCount)} هزینه ثبت‌شده${n > 1 ? ` ـ میانگین ماهانه ${fmt.toman(t.expense / n)}` : ''}` : 'هزینه‌ای در این دوره ثبت نشده'}</span>
          </div>
        </article>

        <article className={`kpi card${neg ? ' kpi-over' : ''}`}>
          <div className="kpi-top">
            <span className={`kpi-ic ${neg ? 'red' : 'green'}`}><Icon name="piggy-bank" /></span>
            {!none && (
              <span className={`chg ${neg ? 'down-bad' : 'up'}`}>
                <Icon name={neg ? 'arrow-down-left' : 'arrow-up-right'} />{neg ? 'کسری' : 'پس‌انداز مثبت'}
              </span>
            )}
          </div>
          <span className="kpi-label">خالص پس‌انداز</span>
          <div className="kpi-val"><b className={neg ? 'neg' : ''}>{signed(t.net)}</b><small>تومان</small></div>
          <div className="kpi-foot">
            <span>{none ? 'تراکنشی در این دوره ثبت نشده' : neg ? `هزینه‌ها ${fmt.toman(-t.net)} بیشتر از درآمد بوده است` : 'درآمد منهای هزینه'}</span>
          </div>
        </article>

        <article className="kpi card">
          <div className="kpi-top"><span className="kpi-ic teal"><Icon name="percent" /></span></div>
          <span className="kpi-label">نرخ پس‌انداز</span>
          <div className="kpi-val"><b className={t.savingsRate !== null && t.savingsRate < 0 ? 'neg' : ''}>{t.savingsRate === null ? 'ـ' : pct(t.savingsRate)}</b></div>
          <div className="kpi-foot">
            <span>{t.savingsRate === null ? 'بدون درآمد قابل محاسبه نیست' : `حد پیشنهادی: ۲۰٪ ـ ${t.savingsRate >= 0.2 ? 'بالاتر از حد پیشنهادی' : 'کمتر از حد پیشنهادی'}`}</span>
          </div>
        </article>

        <article className="kpi card">
          <div className="kpi-top"><span className="kpi-ic amber"><Icon name="scale" /></span></div>
          <span className="kpi-label">نسبت هزینه به درآمد</span>
          <div className="kpi-val"><b className={t.ratio !== null && t.ratio > 1 ? 'neg' : ''}>{t.ratio === null ? 'ـ' : pct(t.ratio)}</b></div>
          <div className="kpi-foot">
            <span>{t.ratio === null ? 'بدون درآمد قابل محاسبه نیست' : `از هر ۱۰۰ تومان درآمد، ${dec(t.ratio * 100, 0)} تومان خرج شده`}</span>
          </div>
        </article>
      </div>

      <article className="card hs-trend" aria-labelledby="hsTrendTitle">
        <div className="card-head">
          <div>
            <h2 id="hsTrendTitle">روند ماهانه</h2>
            <p>{periodText(r, period)} ـ {fmt.digits(activeMonths)} از {fmt.digits(months.length)} ماه دارای تراکنش</p>
          </div>
        </div>
        {trendWarn.length > 0 && (
          <p className="hs-alert">
            {trendWarn.map((w, i) => <span key={i}>{w}{i < trendWarn.length - 1 ? <br /> : null}</span>)}
          </p>
        )}
        {activeMonths > 0 && (
          <div className="hs-charts">
            <figure>
              <figcaption>درآمد و هزینه ماهانه <small>(میلیون تومان)</small></figcaption>
              <div className="chart-box h260"><ChartCanvas type="bar" data={ieData} options={ieOptions} ariaLabel="نمودار درآمد و هزینه ماهانه" /></div>
            </figure>
            <figure>
              <figcaption>خالص پس‌انداز و نرخ پس‌انداز</figcaption>
              <div className="chart-box h260"><ChartCanvas type="bar" data={netData} options={netOptions} ariaLabel="نمودار خالص پس‌انداز و نرخ پس‌انداز ماهانه" /></div>
            </figure>
          </div>
        )}
        <div className="table-wrap">
          <table className="tx hs-table">
            <caption className="sr-only">جدول ماهانه درآمد، هزینه و پس‌انداز</caption>
            <thead>
              <tr><th scope="col">ماه</th><th scope="col">درآمد</th><th scope="col">هزینه</th><th scope="col">خالص پس‌انداز</th><th scope="col">نرخ پس‌انداز</th></tr>
            </thead>
            <tbody>
              {months.slice().reverse().map((m) => {
                if (!has(m)) {
                  return <tr key={m.key}><th scope="row">{monthName(m.key)}</th><td colSpan={4} className="muted">بدون تراکنش ثبت‌شده</td></tr>;
                }
                const netM = m.income - m.expense;
                return (
                  <tr key={m.key}>
                    <th scope="row">{monthName(m.key)}</th>
                    <td className="amt in">{fmt.money(m.income)}</td>
                    <td className="amt out">{fmt.money(m.expense)}</td>
                    <td className={`amt ${netM < 0 ? 'out' : 'in'}`}>{signed(netM)}</td>
                    <td>{m.income > 0 ? pct(netM / m.income) : <span className="muted">بدون درآمد</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <div className="hs-bottom">
        <article className="card hs-recs" aria-labelledby="hsRecsTitle">
          <div className="card-head">
            <div>
              <h2 id="hsRecsTitle">پیشنهادهای بهبود</h2>
              <p>{recs.length ? `${fmt.digits(recs.length)} پیشنهاد بر اساس داده‌های ${PERIOD[period]}` : PERIOD[period]}</p>
            </div>
          </div>
          <ul className="hs-rec-list">
            {!recs.length ? (
              <li className="empty-state">
                <div className="es-ic"><Icon name="sparkles" /></div>
                <strong>پیشنهاد فوری‌ای وجود ندارد</strong>
                <p>بر اساس داده‌های ثبت‌شده، مورد نیازمند اقدامی در این دوره پیدا نشد.</p>
              </li>
            ) : recs.map((x, i) => (
              <li className={`rec rec-${x.tone}`} key={`${x.title}-${i}`}>
                <span className="rec-ic"><Icon name={x.icon} /></span>
                <div>
                  <span className="rec-tone">{TONE[x.tone]}</span>
                  <strong>{x.title}</strong>
                  <p><b>دلیل:</b> {x.reason}</p>
                  {x.href && <Link className="link-btn" to={x.href}>{x.linkText}<Icon name="chevron-left" /></Link>}
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="card hs-about" aria-labelledby="hsAboutTitle">
          <div className="card-head">
            <div><h2 id="hsAboutTitle">درباره محاسبه سلامت مالی</h2><p>شاخص آموزشی بر پایه داده‌های ثبت‌شده در Finova</p></div>
          </div>
          <ul className="hs-about-list">
            <li><b>داده‌های بررسی‌شده:</b> درآمدها و هزینه‌های ثبت‌شده در دوره انتخابی (بر اساس تاریخ هر تراکنش) و بودجه‌های تعریف‌شده برای همان ماه‌ها.</li>
            <li><b>مؤلفه‌ها:</b> نرخ پس‌انداز، پایبندی به بودجه، نسبت هزینه به درآمد و ثبات مالی.</li>
            <li><b>اطلاعات ناقص:</b> مؤلفه‌ای که داده کافی ندارد امتیاز نمی‌گیرد و از محاسبه کنار می‌رود؛ امتیاز کل فقط بر اساس وزن مؤلفه‌های موجود به ۱۰۰ تبدیل می‌شود. اگر کمتر از نیمی از وزن‌ها در دسترس باشد، امتیازی نمایش داده نمی‌شود.</li>
            <li><b>محدودیت‌ها:</b> تراکنش‌های نقدی ثبت‌نشده، بدهی‌ها، وام‌ها، اقساط، دارایی‌ها و سایر تعهدات مالی در این امتیاز دیده نمی‌شوند، چون Finova فعلاً امکان ثبت آن‌ها را ندارد.</li>
            <li><b>ماهیت امتیاز:</b> این عدد یک شاخص آموزشی است؛ رتبه اعتباری، ارزیابی تأییدشده یا مشاوره مالی تخصصی نیست.</li>
          </ul>
          <details className="hs-details">
            <summary><Icon name="calculator" />وزن‌ها و قواعد محاسبه</summary>
            <div className="hs-rules">
              <table className="tx hs-rule-table">
                <caption className="sr-only">وزن مؤلفه‌ها و قواعد امتیازدهی</caption>
                <thead><tr><th scope="col">مؤلفه</th><th scope="col">وزن</th><th scope="col">قاعده</th><th scope="col">در صورت کمبود داده</th></tr></thead>
                <tbody>
                  <tr><th scope="row">نرخ پس‌انداز</th><td>{fmt.digits(W.savings)}</td><td>(درآمد − هزینه) ÷ درآمد. صفر یا منفی: ۰ امتیاز؛ ۰ تا ۲۰٪: خطی تا ۸۰٪ امتیاز؛ ۲۰ تا ۳۰٪: خطی تا امتیاز کامل؛ ۳۰٪ و بیشتر: کامل.</td><td>بدون درآمد محاسبه نمی‌شود.</td></tr>
                  <tr><th scope="row">پایبندی به بودجه</th><td>{fmt.digits(W.budget)}</td><td>برای هر بودجه ماه‌های دوره: هزینه تا سقف = کامل؛ بیش از سقف = ۱ − (مازاد ÷ سقف)، حداقل صفر. میانگین وزنی بر اساس مبلغ سقف.</td><td>بدون بودجه محاسبه نمی‌شود (امتیاز کامل فرض نمی‌شود).</td></tr>
                  <tr><th scope="row">نسبت هزینه به درآمد</th><td>{fmt.digits(W.ratio)}</td><td>هزینه ÷ درآمد. ۵۰٪ و کمتر: کامل؛ ۱۰۰٪ و بیشتر: صفر؛ بین این دو خطی.</td><td>بدون درآمد محاسبه نمی‌شود.</td></tr>
                  <tr><th scope="row">ثبات مالی</th><td>{fmt.digits(W.consistency)}</td><td>پوشش ثبت (۴): سهم ماه‌های دارای درآمد و هزینه. ماه‌های بدون کسری (۳). پایداری هزینه (۳): نوسان ماهانه ۱۰٪ و کمتر کامل، ۴۰٪ و بیشتر صفر.</td><td>به دست‌کم ۳ ماه و ۲ ماه دارای تراکنش نیاز دارد.</td></tr>
                </tbody>
              </table>
              <p><b>امتیاز کل</b> = مجموع امتیاز مؤلفه‌های قابل محاسبه ÷ مجموع وزن همان مؤلفه‌ها × ۱۰۰. اگر مجموع وزن قابل محاسبه کمتر از {fmt.digits(H.MIN_WEIGHT)} باشد، «اطلاعات کافی نیست» نمایش داده می‌شود.</p>
              <p><b>برچسب‌ها:</b> ۰ تا ۳۹ نیازمند بهبود، ۴۰ تا ۵۹ متوسط، ۶۰ تا ۷۹ خوب، ۸۰ تا ۱۰۰ عالی.</p>
              <p><b>ماه جاری:</b> {monthName(stats.periodKey(0))}؛ دوره‌ها بر اساس ماه شمسی تاریخ هر تراکنش تعیین می‌شوند.</p>
            </div>
          </details>
        </article>
      </div>
    </div>
  );
}
