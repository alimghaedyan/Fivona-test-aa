import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ChartCanvas from '../components/ChartCanvas.jsx';
import ProphetForecastPanel from '../components/ProphetForecastPanel.jsx';
import { Count } from '../components/common.jsx';
import { useData } from '../context/DataContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { budgetCalc } from '../lib/calc.js';
import { catMeta } from '../lib/categories.js';
import { fmt } from '../lib/format.js';
import { forecast as FC } from '../lib/forecast.js';
import { jalali as J } from '../lib/jalali.js';
import { chartTip, faDec, stripes } from '../lib/chart.js';

const dec = (n, d = 1) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: d }).format(n);
const pct = (x, d = 1) => (Math.abs(x * 100) < 0.5 * 10 ** -d ? '' : x > 0 ? '+' : '−') + dec(Math.abs(x * 100), d) + '٪';
const money = (n) => fmt.money(n);
const toman = (n) => fmt.toman(n);
const monthName = (key) => budgetCalc.monthLabel(key);
const shortMonth = (key, refYear) => { const [y, m] = key.split('-'); return J.monthNames[+m - 1] + (y !== refYear ? ' ' + fmt.digits(y) : ''); };
const H_LABEL = { 1: 'ماه آینده', 3: '۳ ماه آینده', 6: '۶ ماه آینده' };
const H_OPTIONS = [[1, 'ماه آینده'], [3, '۳ ماه آینده'], [6, '۶ ماه آینده']];
const STATUS = {
  over: { label: 'بیش از بودجه', icon: 'alert-octagon', cls: 'bad' },
  near: { label: 'نزدیک به سقف', icon: 'alert-triangle', cls: 'warn' },
  ok: { label: 'در محدوده بودجه', icon: 'check-circle-2', cls: 'good' },
  nobudget: { label: 'بدون بودجه', icon: 'circle-dashed', cls: 'muted' },
  insufficient: { label: 'سابقه ناکافی', icon: 'help-circle', cls: 'muted' },
};
const TONE_TXT = { bad: 'مهم', warn: 'توجه', info: 'اطلاع', good: 'وضعیت مطلوب' };
const INS_TONE = { up: 'افزایش', down: 'کاهش', warn: 'توجه', info: 'مشاهده' };

/* ---------- متن مبنا و اعلان کمبود داده ---------- */
function basisText(r) {
  const hist = r.history;
  const from = monthName(hist[0].key);
  const to = monthName(hist[hist.length - 1].key);
  const parts = [];
  if (!r.ok) {
    parts.push(r.baseline.length
      ? `ماه‌های کامل دارای داده: ${r.baseline.map((b) => monthName(b.key)).join('، ')}؛ هنوز پیش‌بینی‌ای محاسبه نشده است.`
      : 'هنوز ماه کاملی با هزینه ثبت‌شده وجود ندارد؛ پیش‌بینی‌ای محاسبه نشده است.');
  } else if (r.baseline.length) {
    parts.push(`پیش‌بینی بر پایه ${fmt.digits(r.baseline.length)} ماه کامل اخیرِ دارای داده محاسبه شده است: `
      + r.baseline.map((b) => `${monthName(b.key)} (وزن ${fmt.digits(b.weight)})`).join('، ') + '.');
  }
  parts.push(`بازه بررسی: ${from} تا ${to} (${fmt.digits(hist.length)} ماه کامل گذشته).`);
  parts.push(`ماه جاری (${monthName(r.currentKey)}) چون هنوز تمام نشده در مبنا نیست.`);
  if (r.missing.length) parts.push(`ماه‌های بدون هزینه ثبت‌شده (${r.missing.map((k) => shortMonth(k, '')).join('، ')}) صفر فرض نشده و کنار گذاشته شده‌اند.`);
  if (r.category !== 'all') parts.push(`دسته انتخاب‌شده: «${r.category}».`);
  if (r.skipped) parts.push(`${fmt.digits(r.skipped)} رکورد هزینه نامعتبر (تاریخ یا مبلغ نادرست) نادیده گرفته شد.`);
  return parts.join(' ');
}

function noticeText(r) {
  if (r.ok) return null;
  const why = {
    none: 'هنوز هیچ هزینه معتبری ثبت نشده است. با ثبت هزینه‌ها در صفحه مدیریت هزینه‌ها، پیش‌بینی ممکن می‌شود.',
    months: `برای پیش‌بینی دست‌کم ${fmt.digits(r.rules.minMonths)} ماه کامل دارای هزینه لازم است؛ اکنون ${fmt.digits(r.validCount)} ماه کامل داده دارد. هزینه‌های ماه جاری پس از پایان ماه در محاسبه وارد می‌شوند.`,
    category: `دسته «${r.category}» در ماه‌های مبنا کمتر از ${fmt.digits(r.rules.minMonths)} ماه هزینه داشته است؛ پیش‌بینی جداگانه برای آن قابل اعتماد نیست.`,
    zero: 'در ماه‌های مبنا هزینه‌ای برای این انتخاب ثبت نشده است.',
  }[r.reason];
  return { title: 'داده کافی برای پیش‌بینی وجود ندارد', why };
}

/* ---------- هشدارها (قاعده‌محور) ---------- */
function buildAlerts(r) {
  const out = [];
  const add = (tone, icon, title, why, href, cta) => out.push({ tone, icon, title, why, href, cta });
  const scope = r.category === 'all' ? r.categories : [r.selected];
  const bLink = (c) => `/budgets?month=${c.budget ? c.budget.month : r.nextKey}`;
  const eLink = (c) => `/expenses?cat=${encodeURIComponent(c.name)}&range=6m`;
  if (!r.ok) {
    add('info', 'info', 'مقایسه پیش‌بینی با بودجه فعلاً ممکن نیست.', noticeText(r).why, '/expenses', 'مدیریت هزینه‌ها');
    return out;
  }
  scope.filter((c) => c.budgetStatus === 'over').sort((a, b) => a.diff - b.diff).forEach((c) => add('bad', 'alert-octagon',
    `پیش‌بینی هزینه «${c.name}» از سقف بودجه بیشتر است.`,
    `پیش‌بینی ماهانه ${toman(c.forecast)} در برابر سقف ${toman(c.budget.limit)} (${monthName(c.budget.month)})؛ ${toman(-c.diff)} بیشتر از سقف.`,
    bLink(c), 'مشاهده بودجه'));
  scope.filter((c) => c.budgetStatus === 'near').forEach((c) => add('warn', 'alert-triangle',
    `پیش‌بینی هزینه «${c.name}» به سقف بودجه نزدیک است.`,
    `پیش‌بینی ${toman(c.forecast)} برابر ${fmt.digits(Math.round(c.forecast / c.budget.limit * 100))}٪ سقف ${toman(c.budget.limit)} است (آستانه هشدار: ۸۰٪).`,
    bLink(c), 'مشاهده بودجه'));
  const bt = r.budgetTotals;
  if (r.category === 'all' && bt.count && bt.forecastBudgeted > bt.limits) add('bad', 'layers',
    'مجموع پیش‌بینی دسته‌های دارای بودجه از مجموع سقف‌ها بیشتر است.',
    `پیش‌بینی ${fmt.digits(bt.count)} دسته دارای بودجه ${toman(bt.forecastBudgeted)} و مجموع سقف آن‌ها ${toman(bt.limits)} است (${toman(bt.forecastBudgeted - bt.limits)} بیشتر). پیش‌بینی دسته‌های بدون بودجه (${toman(bt.forecastUnbudgeted)}) در این مقایسه نیست.`,
    `/budgets?month=${r.currentKey}`, 'مدیریت بودجه‌ها');
  scope.filter((c) => c.increase).sort((a, b) => b.change - a.change).forEach((c) => add('info', 'trending-up',
    `هزینه «${c.name}» نسبت به میانگین گذشته افزایش نشان می‌دهد.`,
    `پیش‌بینی ${toman(c.forecast)} در برابر میانگین ماهانه ${toman(c.avg)} (${pct(c.change, 0)}). ماه‌های اخیر در این روش وزن بیشتری دارند و هزینه این دسته در آن‌ها بیشتر بوده است.`,
    eLink(c), 'مشاهده هزینه‌های این دسته'));
  if (!scope.some((c) => c.budget)) add('info', 'pie-chart',
    r.category === 'all' ? 'برای مقایسه پیش‌بینی با بودجه، بودجه تعریف کنید.' : `برای دسته «${r.category}» بودجه‌ای تعریف نشده است.`,
    `برای ${monthName(r.nextKey)} و ${monthName(r.currentKey)} بودجه‌ای${r.category === 'all' ? '' : ' در این دسته'} وجود ندارد؛ با تعریف بودجه، پیش‌بینی با سقف آن مقایسه می‌شود.`,
    `/budgets?month=${r.nextKey}`, 'ایجاد بودجه');
  if (!out.length) add('good', 'check-circle-2', 'پیش‌بینی هیچ دسته‌ای از سقف بودجه‌اش بیشتر نیست.',
    `${fmt.digits(scope.filter((c) => c.budgetStatus === 'ok').length)} دسته دارای بودجه، با پیش‌بینی فعلی، کمتر از ۸۰٪ سقف خود هزینه خواهند داشت.`,
    `/budgets?month=${r.currentKey}`, 'مشاهده بودجه‌ها');
  return out;
}

/* ---------- تحلیل پیش‌بینی ---------- */
function buildInsights(r) {
  const out = [];
  const add = (tone, icon, text) => out.push({ tone, icon, text });
  if (!r.ok) {
    add('info', 'database', `داده‌های ثبت‌شده برای پیش‌بینی هنوز محدود است. ${noticeText(r).why}`);
    return out;
  }
  const catTxt = r.category === 'all' ? '' : ` دسته «${r.category}»`;
  if (r.historicalAvg > 0) {
    const d = (r.forecast - r.historicalAvg) / r.historicalAvg;
    if (Math.abs(d) < r.rules.steadyPct) add('info', 'move-horizontal', `هزینه پیش‌بینی‌شده${catTxt} تقریباً هم‌سطح میانگین گذشته است (${toman(r.forecast)} در برابر ${toman(r.historicalAvg)}، ${pct(d)}).`);
    else if (d > 0) add('up', 'trending-up', `هزینه پیش‌بینی‌شده${catTxt} نسبت به میانگین گذشته افزایش یافته است: ${toman(r.forecast)} در برابر ${toman(r.historicalAvg)} (${pct(d)})، چون هزینه ماه‌های اخیر که وزن بیشتری دارند بالاتر از میانگین بوده است.`);
    else add('down', 'trending-down', `هزینه پیش‌بینی‌شده${catTxt} نسبت به میانگین گذشته کاهش یافته است: ${toman(r.forecast)} در برابر ${toman(r.historicalAvg)} (${pct(d)}).`);
  }
  if (r.baseline.length >= 2) {
    const a = r.baseline[0];
    const b = r.baseline[r.baseline.length - 1];
    if (a.value > 0) {
      const d = (b.value - a.value) / a.value;
      if (Math.abs(d) >= r.rules.steadyPct) add(d > 0 ? 'up' : 'down', d > 0 ? 'arrow-up-left' : 'arrow-down-left',
        `هزینه${catTxt} از ${monthName(a.key)} تا ${monthName(b.key)} ${d > 0 ? 'افزایش' : 'کاهش'} داشته است (${toman(a.value)} ← ${toman(b.value)}، ${pct(d)}).`);
    }
  }
  if (r.category === 'all') {
    const top = r.categories.find((c) => c.forecast !== null);
    if (top && r.forecast > 0) add('info', 'pie-chart', `بیشترین سهم پیش‌بینی مربوط به «${top.name}» است: ${toman(top.forecast)} (${fmt.digits(Math.round(top.forecast / r.forecast * 100))}٪ از کل).`);
    const over = r.categories.filter((c) => c.budgetStatus === 'over');
    if (over.length) add('warn', 'alert-octagon', `هزینه ${fmt.digits(over.length)} دسته از سقف بودجه بیشتر پیش‌بینی می‌شود: ${over.map((c) => `«${c.name}»`).join('، ')}.`);
  } else if (r.selected.budgetStatus === 'over') add('warn', 'alert-octagon', `هزینه این دسته از سقف بودجه بیشتر پیش‌بینی می‌شود (${toman(r.forecast)} در برابر ${toman(r.selected.budget.limit)}).`);
  if (r.current.value > 0) {
    const p = r.current.value / r.forecast;
    add(p > 1 ? 'warn' : 'info', 'calendar-clock', p > 1
      ? `هزینه ثبت‌شده${catTxt} در ${monthName(r.currentKey)} تا امروز (${toman(r.current.value)}) هم‌اکنون از سطح پیش‌بینی پایه بیشتر است. این ماه هنوز در مبنا نیست و پس از پایان ماه وارد محاسبه می‌شود.`
      : `تا امروز در ${monthName(r.currentKey)}${catTxt} ${toman(r.current.value)} ثبت شده که ${fmt.digits(Math.round(p * 100))}٪ سطح پیش‌بینی پایه است.`);
  }
  if (r.reliability === 'limited' || r.missing.length) add('info', 'database',
    `داده‌های ثبت‌شده برای پیش‌بینی هنوز محدود است: ${fmt.digits(r.validCount)} از ${fmt.digits(r.history.length)} ماه گذشته هزینه ثبت‌شده دارد و مبنا ${fmt.digits(r.baseline.length)} ماه است.`);
  if (r.highVariation) add('warn', 'activity', `نوسان هزینه در ماه‌های مبنا زیاد است (ضریب تغییرات ${dec(r.variation * 100, 0)}٪)؛ پیش‌بینی را با احتیاط بیشتری تفسیر کنید.`);
  if (!out.length) add('info', 'info', 'الگوی مشخصی در داده‌های فعلی دیده نمی‌شود؛ پیش‌بینی تقریباً برابر سطح هزینه‌های اخیر است.');
  return out;
}

export default function Forecast() {
  const { transactions, budgets, categoriesFor } = useData();
  const { toast } = useUI();
  const [searchParams] = useSearchParams();

  const [horizon, setHorizon] = useState(1);
  const [category, setCategory] = useState('all');
  const [stamp, setStamp] = useState('');
  const lastRef = useRef(null);

  const paramsKey = searchParams.toString();

  useEffect(() => {
    const h = Number(searchParams.get('h'));
    if ([1, 3, 6].includes(h)) setHorizon(h);
    const cat = searchParams.get('cat');
    if (cat !== null) setCategory(cat || 'all');
  }, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const categoryOptions = useMemo(() => {
    const seen = new Set(categoriesFor('expense').map((c) => c.name));
    transactions.forEach((x) => { if (x.type === 'expense' && x.category) seen.add(x.category); });
    if (category !== 'all') seen.add(category);
    return [...seen];
  }, [categoriesFor, transactions, category]);

  const activeCategory = category !== 'all' && !categoryOptions.includes(category) ? 'all' : category;
  const selectedCategoryId = activeCategory === 'all'
    ? null
    : categoriesFor('expense').find((item) => item.name === activeCategory)?.id ?? null;

  const r = useMemo(
    () => FC.fromData(transactions, budgets, { horizon, category: activeCategory }),
    [transactions, budgets, horizon, activeCategory],
  );

  lastRef.current = r;

  useEffect(() => {
    setStamp('آخرین محاسبه: ' + fmt.digits(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })));
  }, [r]);

  const nextName = monthName(r.nextKey);
  const catTxtShort = r.category === 'all' ? '' : ` ـ دسته «${r.category}»`;
  const notice = noticeText(r);

  /* ---------- نمودار ---------- */
  const chartRows = useMemo(() => {
    const curY = r.currentKey.slice(0, 4);
    const rows = [
      ...r.history.map((h) => ({ key: h.key, kind: h.valid ? 'actual' : 'missing', value: h.valid ? h.value : null, base: r.baseline.find((b) => b.key === h.key) })),
      { key: r.current.key, kind: 'partial', value: r.current.value },
      ...r.horizonMonths.map((h) => ({ key: h.key, kind: 'forecast', value: r.ok ? h.value : null })),
    ];
    const tag = { actual: null, missing: '(بدون داده)', partial: '(تا امروز)', forecast: r.ok ? '(پیش‌بینی)' : '(بدون پیش‌بینی)' };
    return rows.map((x) => ({
      ...x,
      tag: tag[x.kind],
      label: tag[x.kind] ? [shortMonth(x.key, curY), tag[x.kind]] : shortMonth(x.key, curY),
    }));
  }, [r]);

  const chartData = useMemo(() => {
    const pick = (kind) => chartRows.map((x) => (x.kind === kind && x.value !== null ? x.value / 1e6 : null));
    const datasets = [
      { label: 'هزینه واقعی', data: pick('actual'), backgroundColor: '#2563eb', borderRadius: 8, maxBarThickness: 44, skipNull: true },
      { label: 'ماه جاری تا امروز (ناقص)', data: pick('partial'), backgroundColor: stripes('#93c5fd', 'rgba(37,99,235,.12)'), borderColor: '#2563eb', borderWidth: 1.5, borderRadius: 8, maxBarThickness: 44, skipNull: true },
      { label: 'پیش‌بینی (برآورد)', data: pick('forecast'), backgroundColor: stripes('#6ee7b7', 'rgba(16,185,129,.14)'), borderColor: '#059669', borderWidth: 2, borderRadius: 8, maxBarThickness: 44, skipNull: true },
    ];
    if (r.historicalAvg !== null) datasets.push({
      type: 'line', label: 'میانگین گذشته', data: chartRows.map(() => r.historicalAvg / 1e6),
      borderColor: '#94a3b8', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, fill: false,
    });
    return { labels: chartRows.map((x) => x.label), datasets };
  }, [chartRows, r.historicalAvg]);

  const chartOptions = useMemo(() => ({
    maintainAspectRatio: false,
    animation: { duration: 600 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartTip,
        filter: (i) => i.raw !== null,
        callbacks: {
          title: (items) => [].concat(items[0].label).join(' '),
          label: (c) => ` ${c.dataset.label}: ${dec(c.raw, 2)} میلیون تومان`,
          afterBody: (items) => {
            const last = lastRef.current;
            return items.some((i) => i.datasetIndex === 2) && last && last.ok
              ? [' ' + `دامنه ماه‌های پایه: ${dec(last.range.low / 1e6, 2)} تا ${dec(last.range.high / 1e6, 2)} میلیون`] : [];
          },
        },
      },
    },
    scales: {
      x: { reverse: true, grid: { display: false }, border: { display: false }, ticks: { font: { family: 'Vazirmatn', size: 11 } } },
      y: {
        position: 'right', beginAtZero: true, grid: { color: '#eef2f7' }, border: { display: false },
        ticks: { callback: (v) => fmt.digits(v) },
        title: { display: true, text: 'میلیون تومان', font: { family: 'Vazirmatn' } },
      },
    },
  }), []);

  const chartAria = useMemo(() => {
    const summary = chartRows.map((x) => `${monthName(x.key)}: ${x.value === null
      ? (x.kind === 'missing' ? 'بدون داده' : 'پیش‌بینی ندارد')
      : dec(x.value / 1e6, 2) + ' میلیون تومان'} ${x.tag || '(واقعی)'}`).join('؛ ');
    return 'نمودار هزینه واقعی و پیش‌بینی‌شده. ' + summary;
  }, [chartRows]);

  const chartSub = `${r.category === 'all' ? 'همه دسته‌ها' : `دسته «${r.category}»`} ـ ${fmt.digits(r.history.length)} ماه واقعی، ماه جاری و ${H_LABEL[r.horizon]} (میلیون تومان)`;
  const chartNote = r.ok
    ? `ستون‌های راه‌راه سبز برآوردند، نه هزینه واقعی. برای هر ماه آینده همان مقدار پایه (${toman(r.forecast)}) تکرار شده است؛ این روش هزینه‌های فصلی یا نامنظم را در نظر نمی‌گیرد. دامنه ماه‌های پایه: ${dec(r.range.low / 1e6, 2)} تا ${dec(r.range.high / 1e6, 2)} میلیون.`
    : 'پیش‌بینی برای این انتخاب نمایش داده نمی‌شود، چون داده کافی وجود ندارد؛ فقط هزینه‌های واقعی ثبت‌شده نشان داده شده‌اند.';

  /* ---------- KPI ---------- */
  const chg = r.change;
  const chgUp = chg ? chg.abs > 0 : false;
  const chgFlat = chg && chg.pct !== null && Math.abs(chg.pct) < r.rules.steadyPct;
  const chgIcon = !r.ok || !chg ? 'minus' : chgFlat ? 'move-horizontal' : chgUp ? 'trending-up' : 'trending-down';
  const chgIconCls = !r.ok || !chg ? 'amber' : chgFlat ? 'blue' : chgUp ? 'red' : 'green';

  const nextNote = !r.ok
    ? 'داده کافی برای پیش‌بینی وجود ندارد'
    : (r.horizon > 1
      ? `برآورد ${nextName}${catTxtShort}؛ مجموع ${H_LABEL[r.horizon]} (تا ${monthName(r.horizonMonths[r.horizonMonths.length - 1].key)}): ${toman(r.horizonTotal)}`
      : `برآورد ${nextName}${catTxtShort}`) + `؛ دامنه ماه‌های پایه: ${money(r.range.low)} تا ${money(r.range.high)}`;

  const avgNote = r.historicalAvg === null
    ? 'هنوز ماه کاملی با هزینه ثبت‌شده وجود ندارد'
    : `میانگین ساده ${fmt.digits(r.avgMonths)} ماه کامل دارای داده${catTxtShort} (هزینه واقعی)`;

  const chgNote = !r.ok || !chg
    ? 'بدون پیش‌بینی قابل محاسبه نیست'
    : `برآورد ${nextName} در مقایسه با هزینه واقعی ${monthName(chg.vsKey)} (آخرین ماه کامل): `
      + (Math.round(chg.abs) === 0 ? 'بدون تغییر' : `${toman(Math.abs(chg.abs))} ${chgUp ? 'بیشتر' : 'کمتر'}`);

  const validNote = (r.missing.length
    ? `بدون داده: ${r.missing.map((k) => shortMonth(k, '')).join('، ')}`
    : 'همه ماه‌های بررسی‌شده هزینه ثبت‌شده دارند')
    + (r.baseline.length ? ` ـ مبنا: ${fmt.digits(r.baseline.length)} ماه اخیر` : '')
    + (r.reliability === 'limited' ? ' (پیش‌بینی با داده محدود)' : '');

  /* ---------- جدول ماهانه ---------- */
  const kindTxt = { actual: 'واقعی', missing: 'بدون داده', partial: 'ماه جاری ـ ناقص', forecast: 'برآورد پایه WMA' };
  const monthRows = chartRows.slice().reverse().map((x) => ({
    ...x,
    note: x.kind === 'actual' ? (x.base ? `در مبنای پیش‌بینی با وزن ${fmt.digits(x.base.weight)}` : 'خارج از ۳ ماه مبنا')
      : x.kind === 'missing' ? 'هزینه‌ای ثبت نشده؛ صفر فرض نمی‌شود'
        : x.kind === 'partial' ? 'ثبت‌شده تا امروز؛ در مبنا نیست'
          : r.ok ? 'تکرار مقدار پایه' : 'داده کافی نیست',
  }));

  /* ---------- جدول دسته‌ها ---------- */
  const catList = r.category === 'all' ? r.categories : [r.selected];
  const catsSub = r.category === 'all'
    ? `پیش‌بینی ماهانه ${nextName} برای هر دسته با همان ماه‌ها و وزن‌های پیش‌بینی کل`
    : `دسته «${r.category}» ـ پیش‌بینی ماهانه ${nextName}`;

  const catNotes = [];
  const thin = r.insufficientCats.filter((c) => c.raw > 0);
  if (r.category === 'all' && r.ok && thin.length) catNotes.push(`مجموع کل شامل ${toman(thin.reduce((a, c) => a + c.raw, 0))} از دسته‌هایی است که سابقه کافی ندارند (${thin.map((c) => c.name).join('، ')}) و جداگانه پیش‌بینی نشده‌اند.`);
  catNotes.push('سقف بودجه: بودجه تعریف‌شده برای ماه آینده، و اگر وجود نداشته باشد بودجه ماه جاری. «نزدیک به سقف» یعنی پیش‌بینی دست‌کم ۸۰٪ سقف است.');

  const alerts = buildAlerts(r);
  const insights = buildInsights(r);
  const bt = r.budgetTotals;
  const bsumP = bt.limits > 0 ? bt.forecastBudgeted / bt.limits : 0;

  const refresh = () => {
    setStamp('آخرین محاسبه: ' + fmt.digits(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })));
    toast('پیش‌بینی با آخرین داده‌های ثبت‌شده دوباره محاسبه شد.', 'info');
  };

  const R = r.rules;

  return (
    <div className="app-view" id="view-forecast">
      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <ol>
          <li><Link to="/"><Icon name="home" />داشبورد</Link></li>
          <li aria-hidden="true" className="sep">/</li>
          <li aria-current="page">پیش‌بینی هزینه‌ها</li>
        </ol>
      </nav>

      <div className="page-head">
        <div>
          <h1 tabIndex="-1">پیش‌بینی هزینه‌ها</h1>
          <p>با بررسی سوابق هزینه‌های خود، دید بهتری نسبت به مخارج احتمالی آینده به دست آورید.</p>
        </div>
        <div className="head-actions fc-controls">
          <div className="sel fc-horizon">
            <span className="fc-lbl" id="fcHorizonLbl">افق پیش‌بینی</span>
            <div className="seg" role="group" aria-labelledby="fcHorizonLbl">
              {H_OPTIONS.map(([h, label]) => (
                <button key={h} type="button" data-fh={h} className={horizon === h ? 'on' : ''}
                  aria-pressed={horizon === h} onClick={() => setHorizon(h)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="sel fc-cat">
            <label htmlFor="fcCat">دسته هزینه</label>
            <select id="fcCat" value={activeCategory} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">همه دسته‌ها</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button type="button" className="btn ghost fc-refresh" id="fcRefresh" onClick={refresh}>
            <Icon name="refresh-cw" />محاسبه دوباره
          </button>
        </div>
      </div>

      <ProphetForecastPanel horizon={horizon} categoryId={selectedCategoryId} />

      <section className="card fc-basis" aria-labelledby="fcBasisTitle">
        <span className="fc-basis-ic" aria-hidden="true"><Icon name="history" /></span>
        <div className="fc-basis-txt">
          <h2 id="fcBasisTitle">مبنای پیش‌بینی <span className="fc-method">روش پایه مقایسه: میانگین متحرک وزنی</span></h2>
          <p id="fcBasis">{basisText(r)}</p>
        </div>
        <small className="fc-stamp" id="fcStamp" aria-live="polite">{stamp}</small>
      </section>

      {notice && (
        <div className="fc-notice" id="fcNotice" role="status">
          <Icon name="info" />
          <div>
            <strong>{notice.title}</strong>
            <p>{notice.why}</p>
            <Link className="link-btn" to="/expenses">ثبت یا مشاهده هزینه‌ها<Icon name="chevron-left" /></Link>
          </div>
        </div>
      )}

      <div className="kpis fc-kpis">
        <article className="kpi card fc-kpi-main">
          <div className="kpi-top"><span className="kpi-ic green"><Icon name="sparkles" /></span><span className="chg fc-est">برآورد</span></div>
          <span className="kpi-label" id="fcNextLbl">برآورد پایه WMA برای ماه آینده</span>
          <div className="kpi-val">
            <b id="fcNext">{r.ok ? <Count value={r.forecast} animate={false} /> : 'ـ'}</b>
            {r.ok && <small id="fcNextUnit">تومان</small>}
          </div>
          <div className="kpi-foot"><span id="fcNextNote">{nextNote}</span></div>
        </article>
        <article className="kpi card">
          <div className="kpi-top"><span className="kpi-ic blue"><Icon name="calendar-range" /></span><span className="chg fc-act">واقعی</span></div>
          <span className="kpi-label">میانگین هزینه ماهانه گذشته</span>
          <div className="kpi-val">
            <b id="fcAvg">{r.historicalAvg === null ? 'ـ' : money(r.historicalAvg)}</b>
            {r.historicalAvg !== null && <small id="fcAvgUnit">تومان</small>}
          </div>
          <div className="kpi-foot"><span id="fcAvgNote">{avgNote}</span></div>
        </article>
        <article className="kpi card">
          <div className="kpi-top"><span className={`kpi-ic ${chgIconCls}`} id="fcChgIc"><Icon name={chgIcon} /></span></div>
          <span className="kpi-label">تغییر پیش‌بینی‌شده نسبت به ماه قبل</span>
          <div className="kpi-val">
            <b id="fcChg" className={r.ok && chg && chgUp && !chgFlat ? 'neg' : ''}>
              {!r.ok || !chg || chg.pct === null ? 'ـ' : pct(chg.pct)}
            </b>
          </div>
          <div className="kpi-foot"><span id="fcChgNote">{chgNote}</span></div>
        </article>
        <article className="kpi card">
          <div className="kpi-top"><span className="kpi-ic teal"><Icon name="database" /></span></div>
          <span className="kpi-label">تعداد ماه‌های دارای داده معتبر</span>
          <div className="kpi-val"><b id="fcValid">{fmt.digits(r.validCount)}</b><small id="fcValidOf">از {fmt.digits(r.history.length)} ماه</small></div>
          <div className="kpi-foot"><span id="fcValidNote">{validNote}</span></div>
        </article>
      </div>

      <article className="card fc-chart-card" aria-labelledby="fcChartTitle">
        <div className="card-head">
          <div><h2 id="fcChartTitle">هزینه واقعی و برآورد پایه WMA</h2><p id="fcChartSub">{chartSub}</p></div>
          <ul className="fc-legend" aria-label="راهنمای نمودار">
            <li><i className="lg lg-act" />هزینه واقعی (ماه کامل)</li>
            <li><i className="lg lg-part" />ماه جاری تا امروز (ناقص)</li>
            <li><i className="lg lg-fc" />پیش‌بینی (برآورد)</li>
            <li><i className="lg lg-avg" />میانگین گذشته</li>
          </ul>
        </div>
        <div className="h300">
          <ChartCanvas type="bar" data={chartData} options={chartOptions} ariaLabel={chartAria} />
        </div>
        <p className="fc-chart-note" id="fcChartNote">{chartNote}</p>
        <details className="hs-details fc-month-details">
          <summary><Icon name="table" />جدول ماه‌به‌ماه داده‌های نمودار</summary>
          <div className="table-wrap">
            <table className="tx fc-table">
              <caption className="sr-only">مقادیر ماهانه واقعی و پیش‌بینی‌شده</caption>
              <thead><tr><th scope="col">ماه</th><th scope="col">نوع داده</th><th scope="col">مبلغ</th><th scope="col">توضیح</th></tr></thead>
              <tbody id="fcMonthBody">
                {monthRows.map((x) => (
                  <tr className={`fc-row-${x.kind}`} key={x.key + x.kind}>
                    <th scope="row">{monthName(x.key)}</th>
                    <td><span className={`fc-kind fc-kind-${x.kind}`}>{kindTxt[x.kind]}</span></td>
                    <td className="amt">{x.value === null ? 'ـ' : money(x.value)}</td>
                    <td className="muted">{x.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </article>

      <div className="fc-grid">
        <article className="card fc-cats" aria-labelledby="fcCatsTitle">
          <div className="card-head">
            <div><h2 id="fcCatsTitle">پیش‌بینی به تفکیک دسته</h2><p id="fcCatsSub">{catsSub}</p></div>
            <Link className="btn ghost sm" to="/budgets" id="fcBudgetLink"><Icon name="pie-chart" />مدیریت بودجه‌ها</Link>
          </div>
          <div className="table-wrap">
            <table className="tx fc-cat-table">
              <caption className="sr-only">پیش‌بینی ماهانه هر دسته در مقایسه با میانگین گذشته و سقف بودجه</caption>
              <thead><tr><th scope="col">دسته</th><th scope="col">میانگین ماهانه گذشته</th><th scope="col">پیش‌بینی ماهانه</th><th scope="col">سقف بودجه</th><th scope="col">اختلاف با بودجه</th><th scope="col">وضعیت</th></tr></thead>
              <tbody id="fcCatBody">
                {!catList.length ? (
                  <tr><td colSpan={6} className="empty">هنوز هزینه‌ای برای تفکیک دسته‌ها ثبت نشده است.</td></tr>
                ) : catList.map((c) => {
                  const meta = catMeta('expense', c.name);
                  const st = STATUS[c.status];
                  const b = c.budget;
                  return (
                    <tr key={c.name}>
                      <th scope="row">
                        <span className="fc-cat-name"><i style={{ background: meta.color }} />{c.name}</span>
                      </th>
                      <td className="amt">{c.avg > 0 ? money(c.avg) : <span className="muted">ـ</span>}</td>
                      <td className="amt">{c.forecast === null
                        ? <span className="muted">{c.activeMonths ? 'سابقه ناکافی' : 'بدون سابقه'}</span>
                        : <b>{money(c.forecast)}</b>}</td>
                      <td className="amt">{b
                        ? <>{money(b.limit)}<small className="fc-src">{b.source === 'next' ? 'بودجه ' : 'بودجه ماه جاری ـ '}{monthName(b.month)}</small></>
                        : <span className="muted">تعریف نشده</span>}</td>
                      <td>{c.diff === null ? <span className="muted">ـ</span>
                        : c.diff >= 0 ? <span className="fc-diff ok">{money(c.diff)} کمتر از سقف</span>
                          : <span className="fc-diff bad">{money(-c.diff)} بیشتر از سقف</span>}</td>
                      <td>
                        <span className={`fc-pill ${st.cls}`}><Icon name={st.icon} />{st.label}</span>
                        {c.increase && <span className="fc-pill warn"><Icon name="arrow-up-left" />افزایش {pct(c.change, 0)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot id="fcCatFoot">
                {r.category === 'all' && r.ok && (
                  <tr>
                    <th scope="row">مجموع کل</th>
                    <td className="amt">{money(r.historicalAvg)}</td>
                    <td className="amt"><b>{money(r.forecast)}</b></td>
                    <td className="amt">{r.budgetTotals.count ? money(r.budgetTotals.limits) : 'ـ'}</td>
                    <td colSpan={2} className="muted">{r.budgetTotals.count
                      ? `مجموع سقف ${fmt.digits(r.budgetTotals.count)} دسته دارای بودجه`
                      : 'بودجه‌ای تعریف نشده'}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
          <p className="fc-foot-note" id="fcCatNote">{catList.length ? catNotes.join(' ') : ''}</p>
        </article>

        <article className="card fc-alerts" aria-labelledby="fcAlertsTitle">
          <div className="card-head">
            <div>
              <h2 id="fcAlertsTitle">مقایسه با بودجه و هشدارها</h2>
              <p id="fcAlertsSub">{r.ok
                ? `${fmt.digits(alerts.filter((a) => a.tone !== 'good').length)} مورد بر اساس پیش‌بینی ${nextName}`
                : 'پیش‌بینی در دسترس نیست'}</p>
            </div>
          </div>
          {r.ok && bt.count > 0 && (
            <div className="fc-bsum" id="fcBudgetSum">
              <div className="fc-bsum-row"><span>پیش‌بینی دسته‌های دارای بودجه</span><b>{toman(bt.forecastBudgeted)}</b></div>
              <div className="fc-bsum-row"><span>مجموع سقف بودجه‌ها ({fmt.digits(bt.count)} دسته)</span><b>{toman(bt.limits)}</b></div>
              <div className="bar" role="progressbar" aria-label="نسبت پیش‌بینی به مجموع سقف بودجه‌ها"
                aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(Math.min(bsumP, 1) * 100)}
                aria-valuetext={`${fmt.digits(Math.round(bsumP * 100))}٪ سقف`}>
                <span style={{ width: `${Math.min(100, bsumP * 100)}%`, background: bsumP > 1 ? '#ef4444' : bsumP >= 0.8 ? '#f59e0b' : '#10b981' }} />
              </div>
              <div className="fc-bsum-row small">
                <span>{fmt.digits(Math.round(bsumP * 100))}٪ مجموع سقف‌ها{bsumP > 1 ? ' ـ بیش از سقف' : bsumP >= 0.8 ? ' ـ نزدیک به سقف' : ' ـ در محدوده'}</span>
                {bt.forecastUnbudgeted !== null && <span>دسته‌های بدون بودجه: {toman(bt.forecastUnbudgeted)}</span>}
              </div>
            </div>
          )}
          <ul className="hs-rec-list" id="fcAlerts">
            {alerts.map((a, i) => (
              <li className={`rec rec-${a.tone}`} key={`${a.title}-${i}`}>
                <span className="rec-ic" aria-hidden="true"><Icon name={a.icon} /></span>
                <div>
                  <span className="rec-tone">{TONE_TXT[a.tone]}</span>
                  <strong>{a.title}</strong>
                  <p><b>دلیل:</b> {a.why}</p>
                  {a.href && <Link className="link-btn" to={a.href}>{a.cta}<Icon name="chevron-left" /></Link>}
                </div>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <div className="hs-bottom">
        <article className="card" aria-labelledby="fcInsTitle">
          <div className="card-head"><div><h2 id="fcInsTitle">تحلیل پیش‌بینی</h2><p>مشاهده‌های قاعده‌محور بر پایه همین محاسبه</p></div></div>
          <ul className="fc-insights" id="fcInsights">
            {insights.map((i, idx) => (
              <li className={`fc-ins fc-ins-${i.tone}`} key={idx}>
                <span className="fc-ins-ic" aria-hidden="true"><Icon name={i.icon} /></span>
                <p><span className="sr-only">{INS_TONE[i.tone]}: </span>{i.text}</p>
              </li>
            ))}
          </ul>
        </article>
        <article className="card hs-about" aria-labelledby="fcAboutTitle">
          <div className="card-head"><div><h2 id="fcAboutTitle">روش پیش‌بینی و محدودیت‌ها</h2><p>پیش‌بینی پایه و قطعی‌نبودن نتیجه</p></div></div>
          <ul className="hs-about-list">
            <li><b>روش:</b> میانگین متحرک وزنی مجموع هزینه‌های ماهانه؛ ماه‌های جدیدتر وزن بیشتری دارند. از یادگیری ماشین یا مدل آموزش‌دیده استفاده نمی‌شود.</li>
            <li><b>داده‌ها:</b> فقط تراکنش‌های هزینه ثبت‌شده در Finova، گروه‌بندی‌شده بر اساس ماه شمسی تاریخ تراکنش. درآمدها در پیش‌بینی هزینه شمرده نمی‌شوند.</li>
            <li><b>ماه جاری:</b> چون هنوز تمام نشده، در مبنا شرکت نمی‌کند و فقط مبلغ ثبت‌شده تا امروز نمایش داده می‌شود.</li>
            <li><b>ماه‌های بدون داده:</b> ماهی که هیچ هزینه‌ای در آن ثبت نشده صفر فرض نمی‌شود و از مبنا کنار می‌رود.</li>
            <li><b>چند ماه آینده:</b> همان مقدار پایه برای هر ماه تکرار می‌شود. این روش هزینه‌های فصلی، سالانه یا نامنظم (مثل شهریه سالانه، سفر یا تعمیرات) را پیش‌بینی نمی‌کند.</li>
            <li><b>ماهیت نتیجه:</b> این عدد یک برآورد پایه است، نه تضمین هزینه‌های آینده؛ تغییر درآمد، قیمت‌ها یا شرایط زندگی می‌تواند نتیجه را تغییر دهد.</li>
          </ul>
          <details className="hs-details">
            <summary><Icon name="calculator" />فرمول و محاسبه همین صفحه</summary>
            <div className="hs-rules" id="fcFormula">
              <p className="fc-eq"><b>فرمول با ۳ ماه:</b> پیش‌بینی = (۱ × هزینه ماه اول + ۲ × هزینه ماه دوم + ۳ × هزینه ماه سوم) ÷ ۶ ـ ماه اول قدیمی‌ترین و ماه سوم جدیدترین ماه کامل مبناست.</p>
              <p className="fc-eq"><b>با ۲ ماه:</b> پیش‌بینی = (۱ × هزینه ماه اول + ۲ × هزینه ماه دوم) ÷ ۳ ـ با کمتر از {fmt.digits(R.minMonths)} ماه معتبر پیش‌بینی انجام نمی‌شود.</p>
              {r.ok ? (
                <>
                  <p className="fc-eq" dir="rtl">
                    <b>محاسبه فعلی:</b> پیش‌بینی = ({r.baseline.map((b) => `${fmt.digits(b.weight)} × ${money(b.value)}`).join(' + ')}) ÷ {fmt.digits(r.weightSum)} = <b>{money(r.forecast)} تومان</b>
                  </p>
                  <p>
                    ماه‌های مبنا به ترتیب: {r.baseline.map((b) => monthName(b.key)).join('، ')}.
                    {r.horizon > 1 ? ` مجموع ${H_LABEL[r.horizon]}: ${money(r.forecast)} × ${fmt.digits(r.horizon)} = ${toman(r.horizonTotal)}.` : ''}
                  </p>
                </>
              ) : (
                <p>برای این انتخاب هنوز ماه کافی برای محاسبه وجود ندارد.</p>
              )}
              <ul className="fc-rule-list">
                <li>فقط تراکنش‌های هزینه با تاریخ معتبر و مبلغ مثبت شمرده می‌شوند؛ درآمدها حذف می‌شوند.</li>
                <li>مبنا حداکثر {fmt.digits(R.window)} ماه معتبر اخیر از {fmt.digits(R.lookback)} ماه کامل گذشته است؛ ماه جاری ناقص است و شرکت نمی‌کند.</li>
                <li>ماه بدون هیچ هزینه ثبت‌شده صفر فرض نمی‌شود؛ ولی در ماهی که هزینه ثبت شده، نبود هزینه در یک دسته صفر حساب می‌شود.</li>
                <li>پیش‌بینی هر دسته با همان ماه‌ها و وزن‌ها محاسبه می‌شود؛ پس جمع دسته‌ها برابر پیش‌بینی کل است. دسته‌ای که در کمتر از {fmt.digits(R.minMonths)} ماه مبنا هزینه داشته «سابقه ناکافی» است.</li>
                <li>افق چندماهه: همان مقدار پایه برای هر ماه تکرار می‌شود؛ روند فصلی مدل نمی‌شود.</li>
                <li>دامنه ماه‌های پایه = کمترین و بیشترین مجموع ماه‌های مبنا؛ بازه اطمینان آماری نیست.</li>
                <li>بودجه: پیش‌بینی بیش از سقف ← «بیش از بودجه»؛ دست‌کم {fmt.digits(R.nearPct * 100)}٪ سقف ← «نزدیک به سقف».</li>
                <li>افزایش معنادار: پیش‌بینی دسته دست‌کم {fmt.digits(R.increasePct * 100)}٪ و {money(R.increaseMin)} تومان بیشتر از میانگین گذشته آن.</li>
                <li>نوسان زیاد: ضریب تغییرات ماه‌های مبنا بیش از {fmt.digits(R.highCv * 100)}٪.</li>
              </ul>
            </div>
          </details>
        </article>
      </div>
    </div>
  );
}
