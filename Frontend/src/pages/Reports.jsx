import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ChartCanvas from '../components/ChartCanvas.jsx';
import { chartSurface } from '../lib/chart.js';
import { Highlight, Pager } from '../components/common.jsx';
import { useData } from '../context/DataContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { budgetCalc, stats, util } from '../lib/calc.js';
import { catMeta } from '../lib/categories.js';
import { fmt } from '../lib/format.js';
import { jalali as J } from '../lib/jalali.js';
import { reports as RP } from '../lib/reports.js';

const dec = (n, d = 1) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: d }).format(n);
const LRI = '\u2066';
const PDI = '\u2069';
const money = (n) => fmt.money(n);
const mil = (n) => dec(n / 1e6, 2);
const netMoney = (n) => (n < 0 ? `${LRI}−${money(-n)}${PDI}` : money(n));
const signedMoney = (n) => (Math.round(n) === 0 ? '۰' : `${LRI}${n > 0 ? '+' : '−'}${money(Math.abs(n))}${PDI}`);
const pctAbs = (x, d = 1) => dec(Math.abs(x * 100), d) + '٪';
const signedPct = (x, d = 1) => (Math.abs(x * 100) < 0.5 * 10 ** -d ? '۰٪' : `${LRI}${x > 0 ? '+' : '−'}${pctAbs(x, d)}${PDI}`);
const ratePct = (x) => (x < 0 ? `${LRI}−${pctAbs(x)}${PDI}` : pctAbs(x));
const points = (x) => (Math.abs(x * 100) < 0.05 ? '۰' : `${LRI}${x > 0 ? '+' : '−'}${dec(Math.abs(x * 100), 1)}${PDI}`) + ' واحد درصد';
const count = (n) => fmt.digits(n);

const PRESET_LABEL = { this: 'ماه جاری', last: 'ماه گذشته', '3m': '۳ ماه اخیر', '6m': '۶ ماه اخیر', year: 'سال جاری', custom: 'بازه دلخواه' };
const TYPE_LABEL = { all: 'همه تراکنش‌ها', income: 'فقط درآمد', expense: 'فقط هزینه' };
const PAGE = 10;
const DEFAULTS = { preset: '6m', from: '', to: '', type: 'all', category: '', search: '', sort: 'date-desc', page: 1 };
const PRESETS = [['this', 'ماه جاری'], ['last', 'ماه گذشته'], ['3m', '۳ ماه اخیر'], ['6m', '۶ ماه اخیر'], ['year', 'سال جاری'], ['custom', 'بازه دلخواه']];

/* تنظیمات مشترک نمودارها */
const RP_TIP = {
  rtl: true,
  textDirection: 'rtl',
  backgroundColor: '#0f172a',
  padding: 12,
  cornerRadius: 10,
  titleFont: { family: 'Vazirmatn', weight: '700' },
  bodyFont: { family: 'Vazirmatn' },
  boxPadding: 6,
  usePointStyle: true,
};
const FONT = { family: 'Vazirmatn', size: 11 };

let reportsMemory = { ...DEFAULTS };

const isoToJ = (iso) => {
  const j = J.fromISO(iso);
  return `${j.jy}-${String(j.jm).padStart(2, '0')}-${String(j.jd).padStart(2, '0')}`;
};
const jToIso = (s) => {
  const p = util.parseJalali(String(s || '').replace(/-/g, '/'));
  return p.iso || null;
};

function serialize(st) {
  const q = new URLSearchParams();
  if (st.preset !== DEFAULTS.preset) q.set('p', st.preset);
  if (st.preset === 'custom') { q.set('from', isoToJ(st.from)); q.set('to', isoToJ(st.to)); }
  if (st.type !== 'all') q.set('type', st.type);
  if (st.category) q.set('cat', st.category);
  if (st.search) q.set('q', st.search);
  if (st.sort !== DEFAULTS.sort) q.set('sort', st.sort);
  return q.toString();
}

const REASON = {
  filtered: () => 'با فیلتر فعلی محاسبه نمی‌شود',
  history: (c) => `سابقه کافی وجود ندارد؛ دوره قبل (${c.period.label}) پیش از نخستین ماهِ دارای تراکنش ثبت‌شده آغاز می‌شود`,
  empty: (c, t) => `در دوره قبل (${c.period.label}) تراکنش ${t === 'income' ? 'درآمدی' : 'هزینه‌ای'} ثبت نشده است`,
  base: () => 'درآمد یکی از دو دوره صفر است؛ نرخ پس‌انداز قابل مقایسه نیست',
};

function monthTag(m, r) {
  const st = m.status;
  const inc = r.include;
  const vals = ['income', 'expense'].filter((t) => inc[t]).map((t) => st[t]);
  if (vals.every((v) => v === 'future')) return '(هنوز نرسیده)';
  if (vals.every((v) => v === 'unavailable')) return '(بدون داده)';
  if (m.partial) return m.key === stats.periodKey(0) && r.period.toDate ? '(تا امروز)' : '(بخشی از ماه)';
  return null;
}
function monthLabel(m, r) {
  const multiYear = r.period.months.some((x) => x.key.slice(0, 4) !== r.period.months[0].key.slice(0, 4));
  const name = m.short + (multiYear ? ' ' + fmt.digits(m.key.slice(0, 4)) : '');
  const tag = monthTag(m, r);
  return tag ? [name, tag] : name;
}
function cellFor(m, t) {
  const s = m.status[t];
  if (s === 'filtered') return <span className="rp-na">ـ (فیلتر شده)</span>;
  if (s === 'unavailable') return <span className="rp-na">بدون داده</span>;
  if (s === 'future') return <span className="rp-na">هنوز نرسیده</span>;
  if (s === 'none') return <>۰ <span className="rp-na">(تراکنشی ثبت نشده)</span></>;
  return <>{money(m[t])} <small className="rp-na">تومان</small></>;
}

function buildInsights(r, category) {
  const out = [];
  const s = r.summary;
  const c = r.comparison;
  if (!r.records.length) return [{ tone: 'info', icon: 'info', text: 'در این دوره تراکنشی ثبت نشده است؛ با انتخاب دوره دیگر یا ثبت تراکنش، یافته‌ها اینجا نمایش داده می‌شوند.' }];
  if (s.net !== null && s.count) {
    if (s.net < 0) out.push({ tone: 'warn', icon: 'scale', text: `در این دوره هزینه‌های ثبت‌شده ${money(-s.net)} تومان بیشتر از درآمدهای ثبت‌شده بوده است.` });
    else if (s.rate !== null) out.push({ tone: 'info', icon: 'piggy-bank', text: `درآمدهای ثبت‌شده ${money(s.net)} تومان بیشتر از هزینه‌های ثبت‌شده بوده و نرخ پس‌انداز دوره ${ratePct(s.rate)} است.` });
  }
  const cats = r.categories;
  if (cats.length && !category) {
    const top = cats[0];
    out.push({ tone: 'info', icon: 'pie-chart', text: `بیشترین هزینه ثبت‌شده مربوط به «${top.name}» است: ${money(top.amount)} تومان، معادل ${pctAbs(top.share)} از کل هزینه‌ها در ${count(top.count)} تراکنش.` });
    if (cats.length >= 4) {
      const three = cats.slice(0, 3);
      const share = three.reduce((a, x) => a + x.share, 0);
      out.push({ tone: 'info', icon: 'layers', text: `سه دسته اول (${three.map((x) => '«' + x.name + '»').join('، ')}) روی هم ${pctAbs(share)} از هزینه‌های این دوره را تشکیل می‌دهند.` });
    }
  }
  const full = r.monthly.filter((m) => !m.partial && m.status.expense === 'recorded');
  if (r.include.expense && full.length >= 2) {
    const hi = full.reduce((a, m) => (m.expense > a.expense ? m : a));
    const lo = full.reduce((a, m) => (m.expense < a.expense ? m : a));
    out.push({ tone: 'info', icon: 'calendar-range', text: `در میان ماه‌های کامل این دوره، بیشترین هزینه در ${hi.label} (${money(hi.expense)} تومان) و کمترین در ${lo.label} (${money(lo.expense)} تومان) ثبت شده است.` });
  }
  if (c && c.expense) {
    const x = c.expense;
    out.push({ tone: 'info', icon: x.abs >= 0 ? 'trending-up' : 'trending-down', text: `هزینه‌های ثبت‌شده نسبت به دوره مشابه قبل (${c.period.label}) ${money(Math.abs(x.abs))} تومان${x.pct !== null ? ` (${pctAbs(x.pct)})` : ''} ${x.abs > 0 ? 'بیشتر' : x.abs < 0 ? 'کمتر' : 'بدون تغییر'} ${x.abs === 0 ? 'مانده' : 'شده'} است.` });
    const moved = c.categories.filter((k) => k && k.abs).sort((a, b) => Math.abs(b.abs) - Math.abs(a.abs))[0];
    if (moved && !category) out.push({ tone: 'info', icon: 'arrow-left-right', text: `بیشترین تغییر در دسته «${moved.name}» بوده است: ${money(moved.prev)} تومان در دوره قبل و ${money(moved.cur)} تومان در این دوره.` });
  } else if (c && !c.available && c.reason.expense === 'history') {
    out.push({ tone: 'info', icon: 'history', text: `مقایسه با دوره قبل انجام نشد، چون برای ${c.period.label} سابقه کامل ثبت‌شده‌ای وجود ندارد.` });
  }
  if (r.topExpenses.length && r.expenseTotal) {
    const x = r.topExpenses[0];
    out.push({ tone: 'info', icon: 'receipt', text: `بزرگ‌ترین هزینه ثبت‌شده «${x.title}» به مبلغ ${money(x.amount)} تومان در ${fmt.dateLong(x.date)} است (${pctAbs(x.amount / r.expenseTotal)} از هزینه‌های دوره).` });
  }
  if (r.budget && r.budget.rows.length) {
    const over = r.budget.over;
    out.push(over.length
      ? { tone: 'warn', icon: 'alert-triangle', text: `در ${count(over.length)} بودجه از ${count(r.budget.rows.length)} بودجه این دوره، هزینه واقعی از سقف بیشتر شده است: ${over.map((b) => `«${b.category}» در ${b.monthLabel}`).join('، ')}.` }
      : { tone: 'info', icon: 'check-circle-2', text: `هزینه واقعی در همه ${count(r.budget.rows.length)} بودجه این دوره در محدوده سقف بوده است.` });
  }
  return out;
}

export default function Reports() {
  const { transactions, budgets, categoriesFor } = useData();
  const { toast } = useUI();
  const [searchParams, setSearchParams] = useSearchParams();

  const [st, setSt] = useState(() => ({ ...reportsMemory }));
  const [searchText, setSearchText] = useState(() => reportsMemory.search);
  const [customOpen, setCustomOpen] = useState(false);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [customErr, setCustomErr] = useState('');
  const [fromInvalid, setFromInvalid] = useState(false);
  const [toInvalid, setToInvalid] = useState(false);

  const rootRef = useRef(null);
  const ledgerRef = useRef(null);
  const listRef = useRef(null);
  const monthChartRef = useRef(null);
  const catChartRef = useRef(null);
  const rateChartRef = useRef(null);
  const lastRef = useRef(null);
  const printingRef = useRef(false);
  const detailsRef = useRef([]);

  const paramsKey = searchParams.toString();

  const names = useMemo(() => {
    const set = new Set(categoriesFor('expense').map((c) => c.name));
    transactions.forEach((x) => { if (x.type === 'expense' && x.category) set.add(x.category); });
    return [...set];
  }, [categoriesFor, transactions]);
  const namesRef = useRef(names);
  namesRef.current = names;

  const category = st.category && names.includes(st.category) ? st.category : '';

  /* ---------- دوره ---------- */
  const P = useMemo(() => {
    let p = RP.periodFor(st.preset, st.preset === 'custom' ? { from: st.from, to: st.to } : {});
    if (p.error) p = RP.periodFor(DEFAULTS.preset);
    return p;
  }, [st.preset, st.from, st.to]);

  const r = useMemo(
    () => RP.fromData(transactions, budgets, P, {
      type: st.type, category, search: st.search, sort: st.sort,
    }),
    [transactions, budgets, P, st.type, category, st.search, st.sort],
  );
  lastRef.current = r;

  /* ---------- همگام‌سازی با نشانی ---------- */
  useEffect(() => {
    const keys = [...searchParams.keys()];
    if (!keys.length) return;
    if (keys.length === 1 && keys[0] === 'q') {
      const q = searchParams.get('q') || '';
      setSt((prev) => ({ ...prev, search: q.trim(), page: 1 }));
      return;
    }
    const next = { ...DEFAULTS };
    const p = searchParams.get('p');
    if (p && RP.PRESETS.includes(p)) next.preset = p;
    if (next.preset === 'custom') {
      const f = jToIso(searchParams.get('from'));
      const t = jToIso(searchParams.get('to'));
      if (f && t && f <= t) { next.from = f; next.to = t; }
      else { next.preset = DEFAULTS.preset; toast('بازه تاریخ نشانی صفحه معتبر نبود؛ «۶ ماه اخیر» نمایش داده شد.', 'info'); }
    }
    const type = searchParams.get('type');
    if (['income', 'expense'].includes(type)) next.type = type;
    const cat = searchParams.get('cat');
    if (cat && namesRef.current.includes(cat)) { next.category = cat; next.type = 'expense'; }
    const q = searchParams.get('q');
    if (q) next.search = q.trim();
    const sort = searchParams.get('sort');
    if (RP.SORTS.includes(sort)) next.sort = sort;
    setSt(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  useEffect(() => {
    reportsMemory = { ...reportsMemory, ...st };
  }, [st]);

  useEffect(() => {
    if (st.preset === 'custom' && (!st.from || !st.to)) return;
    const qs = serialize({ ...st, category });
    if (qs !== paramsKey) setSearchParams(qs, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, category, paramsKey]);

  useEffect(() => { setSearchText(st.search); }, [st.search]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSt((prev) => (prev.search === searchText.trim() ? prev : { ...prev, search: searchText.trim(), page: 1 }));
    }, 150);
    return () => clearTimeout(t);
  }, [searchText]);

  const pages = Math.max(1, Math.ceil(r.rows.length / PAGE));
  const safePage = Math.min(st.page, pages);
  useEffect(() => { if (st.page > pages) setSt((prev) => ({ ...prev, page: pages })); }, [st.page, pages]);

  const update = (patch) => setSt((prev) => ({ ...prev, ...patch }));

  const hasFilters = st.preset !== DEFAULTS.preset || st.type !== 'all' || !!category
    || !!st.search || st.sort !== DEFAULTS.sort;

  /* ---------- فیلترها ---------- */
  const setFilter = (key, value) => {
    if (key === 'category') {
      const forceExpense = value && st.type !== 'expense';
      update({ category: value, type: forceExpense ? 'expense' : st.type, page: 1 });
      if (forceExpense) toast('فیلتر دسته‌بندی فقط برای هزینه‌هاست؛ نوع تراکنش روی «فقط هزینه» قرار گرفت.', 'info');
    } else if (key === 'type') {
      const clearCat = value !== 'expense' && !!category;
      update({ type: value, category: clearCat ? '' : category, page: 1 });
      if (clearCat) toast('فیلتر دسته هزینه برداشته شد، چون نوع تراکنش تغییر کرد.', 'info');
    }
  };

  const clearFilters = () => {
    setSt({ ...DEFAULTS });
    setSearchText('');
    setCustomOpen(false);
    toast('فیلترهای گزارش پاک شدند.', 'info');
  };

  const openCustom = () => {
    const per = lastRef.current ? lastRef.current.period : P;
    setFromText(fmt.dateInput(per.from));
    setToText(fmt.dateInput(per.to));
    setCustomErr('');
    setFromInvalid(false);
    setToInvalid(false);
    setCustomOpen(true);
    setTimeout(() => {
      const el = document.getElementById('rpFrom');
      el?.focus();
      el?.select();
    }, 0);
  };

  const closeCustom = () => setCustomOpen(false);

  const applyCustom = (e) => {
    e.preventDefault();
    const f = util.parseJalali(fromText, 'تاریخ شروع را وارد کنید.');
    const t = util.parseJalali(toText, 'تاریخ پایان را وارد کنید.');
    setFromInvalid(!!f.error);
    setToInvalid(!!t.error);
    let err = f.error ? 'تاریخ شروع: ' + f.error : t.error ? 'تاریخ پایان: ' + t.error : '';
    if (!err && f.iso > t.iso) {
      err = 'تاریخ شروع نباید بعد از تاریخ پایان باشد.';
      setFromInvalid(true);
    }
    setCustomErr(err);
    if (err) {
      (f.error || !t.error ? document.getElementById('rpFrom') : document.getElementById('rpTo'))?.focus();
      return;
    }
    update({ preset: 'custom', from: f.iso, to: t.iso, page: 1 });
    closeCustom();
    toast(`گزارش برای بازه ${RP.periodFor('custom', { from: f.iso, to: t.iso }).label} به‌روز شد.`, 'info');
  };

  /* ---------- خروجی CSV ---------- */
  const exportCSV = () => {
    const cur = RP.fromData(transactions, budgets, P, { type: st.type, category, search: st.search, sort: st.sort });
    if (!cur.rows.length) {
      toast('در گزارش فعلی تراکنشی برای دریافت وجود ندارد؛ دوره یا فیلترها را تغییر دهید.', 'info');
      return;
    }
    const csv = '\uFEFF' + RP.toCSV(cur.rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = RP.fileName(cur.period);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`فایل گزارش با ${count(cur.rows.length)} تراکنش (${cur.period.label}) آماده دریافت شد.`);
  };

  /* ---------- چاپ ---------- */
  const preparePrint = useCallback(() => {
    if (!rootRef.current || printingRef.current) return;
    printingRef.current = true;
    const root = rootRef.current;
    root.querySelectorAll('th .th-sort').forEach((button) => {
      const label = document.createElement('span');
      label.className = 'rp-print-label';
      label.textContent = button.textContent;
      button.after(label);
    });
    detailsRef.current = [...root.querySelectorAll('details')].map((el) => ({ el, open: el.open }));
    detailsRef.current.forEach(({ el }) => { el.open = true; });
    [
      { ref: monthChartRef, pie: false },
      { ref: catChartRef, pie: true },
      { ref: rateChartRef, pie: false },
    ].forEach(({ ref, pie }) => {
      const chart = ref.current?.chart;
      if (!chart) return;
      const width = pie ? 260 : 680;
      const height = pie ? 260 : 240;
      chart.$screenDpr = chart.options.devicePixelRatio;
      chart.options.devicePixelRatio = 2;
      chart.resize(width, height);
      chart.update('none');
      const img = document.createElement('img');
      img.className = 'rp-print-image';
      img.alt = chart.canvas.getAttribute('aria-label') || 'نمودار گزارش';
      img.width = width;
      img.height = height;
      img.src = chart.toBase64Image('image/png', 1);
      chart.canvas.after(img);
    });
  }, []);

  const restorePrint = useCallback(() => {
    if (!printingRef.current) return;
    printingRef.current = false;
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll('.rp-print-image').forEach((el) => el.remove());
    root.querySelectorAll('.rp-print-label').forEach((el) => el.remove());
    detailsRef.current.forEach(({ el, open }) => { el.open = open; });
    detailsRef.current = [];
    [
      { ref: monthChartRef },
      { ref: catChartRef },
      { ref: rateChartRef },
    ].forEach(({ ref }) => {
      const chart = ref.current?.chart;
      if (!chart) return;
      chart.options.devicePixelRatio = chart.$screenDpr;
      delete chart.$screenDpr;
      chart.resize();
      chart.update('none');
    });
  }, []);

  useEffect(() => {
    window.addEventListener('beforeprint', preparePrint);
    window.addEventListener('afterprint', restorePrint);
    return () => {
      window.removeEventListener('beforeprint', preparePrint);
      window.removeEventListener('afterprint', restorePrint);
    };
  }, [preparePrint, restorePrint]);

  const doPrint = async () => {
    await document.fonts.ready;
    try {
      preparePrint();
      window.print();
    } catch (e) {
      toast('باز کردن چاپ ممکن نشد؛ گزارش را در مرورگر مستقل باز کنید.', 'error');
    } finally {
      restorePrint();
    }
  };

  /* ---------- داده‌های نمایش ---------- */
  const s = r.summary;
  const c = r.comparison;
  const prevLbl = c ? c.period.label : '';
  const chg = (k) => {
    if (!c || !c[k]) return null;
    const x = c[k];
    if (k === 'rate') return { chg: points(x.abs), title: `تغییر نسبت به ${prevLbl}: ${points(x.abs)}` };
    const txt = x.pct !== null ? signedPct(x.pct) : signedMoney(x.abs);
    return { chg: txt, title: `تغییر نسبت به ${prevLbl}: ${signedMoney(x.abs)} تومان${x.pct !== null ? ` (${signedPct(x.pct)})` : ''}` };
  };
  const filteredNote = 'با فیلتر فعلی شمرده نمی‌شود';

  const incChg = chg('income');
  const expChg = chg('expense');
  const netChg = chg('net');
  const rateChg = chg('rate');

  /* ---------- نوار دوره و اعلان ---------- */
  const bannerTags = [];
  if (st.type !== 'all') bannerTags.push({ key: 'type', text: `نوع: ${TYPE_LABEL[st.type]}`, aria: 'برداشتن فیلتر نوع تراکنش' });
  if (category) bannerTags.push({ key: 'category', text: `دسته: ${category}`, aria: `برداشتن فیلتر دسته ${category}` });
  if (st.search) bannerTags.push({ key: 'search', text: `جست‌وجو در جدول: «${st.search}»`, aria: 'پاک کردن جست‌وجو' });

  const removeTag = (key) => {
    if (key === 'search') { setSearchText(''); update({ search: '', page: 1 }); return; }
    if (key === 'type') { update({ category: '', type: 'all', page: 1 }); return; }
    setFilter('category', '');
  };

  const noticeLines = [];
  if (!r.records.length) noticeLines.push(`در این دوره تراکنشی ${st.type === 'all' && !category ? '' : 'مطابق فیلترها '}ثبت نشده است`);
  if (r.unavailableMonths.length) noticeLines.push(`بدون داده: ${r.unavailableMonths.map((k) => budgetCalc.monthLabel(k)).join('، ')} پیش از نخستین تراکنش ثبت‌شده در Finova است؛ این ${r.unavailableMonths.length > 1 ? 'ماه‌ها' : 'ماه'} صفر فرض نشده و در نمودارها خالی نمایش داده می‌شود.`);
  if (r.futureMonths.length) noticeLines.push(`هنوز نرسیده: ${r.futureMonths.map((k) => budgetCalc.monthLabel(k)).join('، ')} بعد از امروز است و تراکنشی برای آن وجود ندارد.`);
  if (P.preset === 'custom' && P.future && !r.futureMonths.length) noticeLines.push('بخشی از بازه انتخاب‌شده بعد از امروز است و فقط تراکنش‌های ثبت‌شده تا امروز شمرده می‌شوند.');
  if (r.skipped) noticeLines.push(`${count(r.skipped)} رکورد با تاریخ یا مبلغ نامعتبر در محاسبه شرکت داده نشد.`);

  /* ---------- نمودار درآمد و هزینه ماهانه ---------- */
  const monthlyEmpty = !r.records.length;
  const monthChartData = useMemo(() => {
    const inc = r.include;
    const labels = r.monthly.map((m) => monthLabel(m, r));
    const datasets = [];
    if (inc.income) datasets.push({ label: 'درآمد ثبت‌شده', data: r.monthly.map((m) => (m.income === null ? null : m.income / 1e6)), backgroundColor: '#2563eb', borderRadius: 7, maxBarThickness: 34, order: 2 });
    if (inc.expense) datasets.push({ label: category ? `هزینه ثبت‌شده «${category}»` : 'هزینه ثبت‌شده', data: r.monthly.map((m) => (m.expense === null ? null : m.expense / 1e6)), backgroundColor: '#f87171', borderRadius: 7, maxBarThickness: 34, order: 2 });
    if (inc.income && inc.expense) datasets.push({ type: 'line', label: 'خالص جریان نقدی', data: r.monthly.map((m) => (m.net === null ? null : m.net / 1e6)), borderColor: '#8b5cf6', backgroundColor: '#8b5cf6', borderWidth: 2, pointRadius: 4, pointBackgroundColor: () => chartSurface(), pointBorderWidth: 2, tension: 0.25, spanGaps: false, order: 1 });
    return { labels, datasets };
  }, [r, category]);

  const monthChartOptions = useMemo(() => ({
    maintainAspectRatio: false,
    animation: { duration: 500 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...RP_TIP,
        filter: (i) => i.raw !== null,
        callbacks: {
          title: (items) => [].concat(items[0].label).join(' '),
          label: (c) => ` ${c.dataset.label}: ${dec(c.raw, 2)} میلیون تومان`,
        },
      },
    },
    scales: {
      x: { reverse: true, grid: { display: false }, border: { display: false }, ticks: { font: FONT } },
      y: { position: 'right', grid: { color: '#eef2f7' }, border: { display: false }, ticks: { callback: (v) => fmt.digits(v), font: FONT }, title: { display: true, text: 'میلیون تومان', font: { family: 'Vazirmatn' } } },
    },
  }), []);

  const monthChartAria = useMemo(() => {
    const summary = r.monthly.map((m) => {
      const parts = [];
      if (r.include.income) parts.push('درآمد ' + (m.income === null ? 'بدون داده' : mil(m.income) + ' میلیون'));
      if (r.include.expense) parts.push('هزینه ' + (m.expense === null ? 'بدون داده' : mil(m.expense) + ' میلیون'));
      if (m.net !== null) parts.push('خالص ' + mil(m.net) + ' میلیون');
      return `${m.label}: ${parts.join('، ')}`;
    }).join('؛ ');
    return 'نمودار درآمد و هزینه ماهانه به میلیون تومان. ' + summary;
  }, [r]);

  const monthNotes = ['مقادیر، جمع تراکنش‌های ثبت‌شده در هر ماه شمسی‌اند.'];
  if (r.unavailableMonths.length) monthNotes.push('ماه‌های «بدون داده» پیش از نخستین تراکنش ثبت‌شده‌اند و صفر فرض نشده‌اند.');
  if (P.toDate) monthNotes.push('ماه جاری هنوز تمام نشده و فقط تا امروز شمرده شده است.');
  if (P.months.some((m) => m.partial && !(m.key === stats.periodKey(0) && P.toDate))) monthNotes.push('در ماه‌های «بخشی از ماه» فقط روزهای داخل بازه شمرده شده‌اند.');

  /* ---------- تحلیل دسته‌ها ---------- */
  const catsVisible = r.include.expense && r.categories.length > 0;
  const catChartData = useMemo(() => ({
    labels: r.categories.map((x) => x.name),
    datasets: [{
      data: r.categories.map((x) => x.amount / 1e6),
      backgroundColor: r.categories.map((x) => catMeta('expense', x.name).color),
      borderWidth: 3, borderColor: () => chartSurface(), hoverOffset: 6, borderRadius: 4,
    }],
  }), [r.categories]);

  const catChartOptions = useMemo(() => ({
    maintainAspectRatio: false,
    cutout: '72%',
    plugins: {
      legend: { display: false },
      tooltip: {
        ...RP_TIP,
        callbacks: {
          label: (x) => {
            const total = x.dataset.data.reduce((a, b) => a + (b || 0), 0) || 1;
            return ` ${x.label}: ${dec(x.raw, 2)} میلیون تومان (${pctAbs(x.raw / total)})`;
          },
        },
      },
    },
  }), []);

  const catChartAria = 'نمودار سهم دسته‌های هزینه: ' + r.categories.map((x) => `${x.name} ${pctAbs(x.share)}`).join('، ');

  /* ---------- روند پس‌انداز ---------- */
  const rateOk = r.include.income && r.include.expense;
  const ratePointsRaw = r.monthly.map((m) => (m.rate === null ? null : +(m.rate * 100).toFixed(2)));
  const rateAny = ratePointsRaw.some((v) => v !== null);
  const rateVisible = rateOk && rateAny;
  const rateChartData = useMemo(() => ({
    labels: r.monthly.map((m) => monthLabel(m, r)),
    datasets: [{
      label: 'نرخ پس‌انداز', data: ratePointsRaw,
      borderColor: '#0d9488', backgroundColor: 'rgba(13,148,136,.12)', fill: 'origin',
      tension: 0.3, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: () => chartSurface(), pointBorderWidth: 2, spanGaps: false,
    }],
  }), [r, ratePointsRaw]);

  const rateChartOptions = useMemo(() => ({
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...RP_TIP,
        filter: (i) => i.raw !== null,
        callbacks: {
          title: (items) => [].concat(items[0].label).join(' '),
          label: (c) => ` نرخ پس‌انداز: ${dec(c.raw, 1)}٪`,
        },
      },
    },
    scales: {
      x: { reverse: true, grid: { display: false }, border: { display: false }, ticks: { font: FONT } },
      y: {
        position: 'right',
        grid: { color: (ctx) => (ctx.tick.value === 0 ? '#94a3b8' : '#eef2f7') },
        border: { display: false },
        ticks: { callback: (v) => fmt.digits(v) + '٪', font: FONT },
      },
    },
  }), []);

  const rateChartAria = 'نمودار نرخ پس‌انداز ماهانه: ' + r.monthly.map((m) => `${m.label} ${m.rate === null ? 'قابل محاسبه نیست' : ratePct(m.rate)}`).join('، ');

  /* ---------- جدول تفصیلی ---------- */
  const rows = r.rows;
  const incSum = rows.filter((x) => x.type === 'income').reduce((a, x) => a + x.amount, 0);
  const expSum = rows.filter((x) => x.type === 'expense').reduce((a, x) => a + x.amount, 0);
  const summaryParts = [];
  if (r.include.income) summaryParts.push(`درآمد ${money(incSum)} تومان`);
  if (r.include.expense) summaryParts.push(`هزینه ${money(expSum)} تومان`);

  const [sortKey, sortDir] = st.sort.split('-');
  const sortIcon = (key) => (sortKey === key ? (sortDir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down');
  const sortByColumn = (key) => {
    update({ sort: sortKey === key ? `${key}-${sortDir === 'asc' ? 'desc' : 'asc'}` : `${key}-desc`, page: 1 });
  };

  const insights = buildInsights(r, category);
  const bud = r.budget;
  const budPartial = r.period.months.some((m) => m.partial);
  const budSub = !bud ? ''
    : bud.filtered ? 'غیرفعال با فیلتر «فقط درآمد»'
      : !bud.rows.length ? `ماه‌های دوره: ${r.period.months.map((m) => m.label).join('، ')}`
        : `بودجه‌های ${bud.monthsWithBudget.map((k) => budgetCalc.monthLabel(k)).join('، ')} ـ هزینه واقعی هر بودجه برای کل همان ماه است، مانند صفحه بودجه‌بندی${budPartial ? '؛ ماه‌هایی که تمام نشده‌اند تا امروز شمرده شده‌اند' : ''}`;

  return (
    <div className="app-view" id="view-reports" ref={rootRef}>
      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <ol>
          <li><Link to="/"><Icon name="home" />داشبورد</Link></li>
          <li aria-hidden="true" className="sep">/</li>
          <li aria-current="page">گزارش‌ها</li>
        </ol>
      </nav>

      <div className="page-head">
        <div>
          <h1 tabIndex="-1">گزارش‌ها و تحلیل مالی</h1>
          <p>تصویر دقیق‌تری از درآمد، هزینه، پس‌انداز و روند تغییرات مالی خود داشته باشید.</p>
        </div>
        <div className="head-actions rp-actions">
          <button type="button" className="btn ghost" id="rpPrint" onClick={doPrint}><Icon name="printer" />چاپ یا ذخیره پی‌دی‌اف</button>
          <button type="button" className="btn primary" id="rpExport" onClick={exportCSV}><Icon name="download" />دریافت گزارش</button>
        </div>
      </div>

      <section className="card rp-filters" aria-labelledby="rpFiltersTitle">
        <h2 className="sr-only" id="rpFiltersTitle">فیلترهای گزارش</h2>
        <div className="rp-frow">
          <div className="sel rp-period">
            <span className="fc-lbl" id="rpPeriodLbl">دوره گزارش</span>
            <div className="seg rp-seg" role="group" aria-labelledby="rpPeriodLbl">
              {PRESETS.map(([key, label]) => (
                <button
                  key={key} type="button" data-rp={key} className={st.preset === key ? 'on' : ''}
                  aria-pressed={st.preset === key}
                  aria-controls={key === 'custom' ? 'rpCustom' : undefined}
                  aria-expanded={key === 'custom' ? customOpen : undefined}
                  onClick={() => {
                    if (key === 'custom') { customOpen ? closeCustom() : openCustom(); return; }
                    closeCustom();
                    update({ preset: key, page: 1 });
                  }}
                >{label}</button>
              ))}
            </div>
          </div>
          <div className="sel">
            <label htmlFor="rpType">نوع تراکنش</label>
            <select id="rpType" data-sync="type" value={st.type} onChange={(e) => setFilter('type', e.target.value)}>
              <option value="all">همه تراکنش‌ها</option>
              <option value="income">فقط درآمد</option>
              <option value="expense">فقط هزینه</option>
            </select>
          </div>
          <div className="sel">
            <label htmlFor="rpCat">دسته هزینه</label>
            <select id="rpCat" data-sync="category" value={category} onChange={(e) => setFilter('category', e.target.value)}>
              <option value="">همه دسته‌ها</option>
              {names.map((c2) => <option key={c2} value={c2}>{c2}</option>)}
            </select>
          </div>
          <button type="button" className="btn ghost clear-btn" id="rpClear" disabled={!hasFilters} onClick={clearFilters}>
            <Icon name="filter-x" />پاک کردن فیلترها
          </button>
        </div>
        <form className="rp-custom" id="rpCustom" hidden={!customOpen} noValidate onSubmit={applyCustom}>
          <div className="rp-date">
            <label htmlFor="rpFrom">از تاریخ</label>
            <input type="text" id="rpFrom" inputMode="numeric" autoComplete="off" placeholder="۱۴۰۵/۰۶/۰۱"
              aria-describedby="rpCustomHint rpCustomErr" aria-invalid={fromInvalid ? 'true' : undefined}
              value={fromText} onChange={(e) => { setFromText(e.target.value); if (fromInvalid) setFromInvalid(false); }} />
          </div>
          <div className="rp-date">
            <label htmlFor="rpTo">تا تاریخ</label>
            <input type="text" id="rpTo" inputMode="numeric" autoComplete="off" placeholder="۱۴۰۵/۰۷/۲۷"
              aria-describedby="rpCustomHint rpCustomErr" aria-invalid={toInvalid ? 'true' : undefined}
              value={toText} onChange={(e) => { setToText(e.target.value); if (toInvalid) setToInvalid(false); }} />
          </div>
          <button type="submit" className="btn primary"><Icon name="check" />اعمال بازه</button>
          <p className="rp-hint" id="rpCustomHint">تاریخ‌ها را به شمسی و به شکل سال/ماه/روز وارد کنید؛ روز آغاز و پایان هر دو در گزارش شمرده می‌شوند.</p>
          <p className="rp-err" id="rpCustomErr" role="alert">{customErr}</p>
        </form>
        <div className="rp-banner" id="rpBanner" aria-live="polite">
          <Icon name="calendar-range" />
          <span>
            دوره گزارش: <b>{P.label}</b> ـ {PRESET_LABEL[P.preset]}
            {P.toDate ? `، ماه جاری تا امروز (${fmt.dateLong(RP.asOf())})` : ''} ـ {count(P.days)} روز
          </span>
          {bannerTags.map((t) => (
            <span className="rp-tag" key={t.key}>
              {t.text}
              <button type="button" data-untag={t.key} aria-label={t.aria} onClick={() => removeTag(t.key)}><Icon name="x" /></button>
            </span>
          ))}
        </div>
      </section>

      {noticeLines.length > 0 && (
        <div className="fc-notice" id="rpNotice" role="status">
          <Icon name="info" />
          <div>
            {!r.records.length && (
              <>
                <strong>{noticeLines[0]}</strong>
                <p>اعداد صفر به معنای ثبت‌نشدن تراکنش در Finova است، نه لزوماً نبودِ درآمد یا هزینه. دوره دیگری انتخاب کنید یا تراکنش‌های خود را ثبت کنید.</p>
              </>
            )}
            {noticeLines.slice(r.records.length ? 0 : 1).map((line, i) => <p key={i}>{line}</p>)}
          </div>
        </div>
      )}

      <div className="kpis rp-kpis" id="rpKpis">
        <article className="kpi card">
          <div className="kpi-top">
            <span className="kpi-ic green"><Icon name="arrow-down-left" /></span>
            {incChg && <span className="chg rp-chg" id="rpIncChg" title={incChg.title} aria-label={incChg.title}>{incChg.chg}</span>}
          </div>
          <span className="kpi-label">مجموع درآمد</span>
          <div className="kpi-val">
            <b id="rpInc">{s.income === null ? 'ـ' : money(s.income)}</b>
            {s.income !== null && <small id="rpIncUnit">تومان</small>}
          </div>
          <div className="kpi-foot">
            <span id="rpIncNote">{s.income === null
              ? `${filteredNote} (${category ? 'فیلتر دسته هزینه' : 'فیلتر «فقط هزینه»'})`
              : s.incomeCount ? `${count(s.incomeCount)} تراکنش درآمد در این دوره` : 'درآمدی در این دوره ثبت نشده است'}</span>
          </div>
        </article>

        <article className="kpi card">
          <div className="kpi-top">
            <span className="kpi-ic red"><Icon name="arrow-up-right" /></span>
            {expChg && <span className="chg rp-chg" id="rpExpChg" title={expChg.title} aria-label={expChg.title}>{expChg.chg}</span>}
          </div>
          <span className="kpi-label">مجموع هزینه</span>
          <div className="kpi-val">
            <b id="rpExp">{s.expense === null ? 'ـ' : money(s.expense)}</b>
            {s.expense !== null && <small id="rpExpUnit">تومان</small>}
          </div>
          <div className="kpi-foot">
            <span id="rpExpNote">{s.expense === null
              ? `${filteredNote} (فیلتر «فقط درآمد»)`
              : s.expenseCount ? `${count(s.expenseCount)} تراکنش هزینه${category ? ` در دسته «${category}»` : ''}` : 'هزینه‌ای در این دوره ثبت نشده است'}</span>
          </div>
        </article>

        <article className="kpi card">
          <div className="kpi-top">
            <span className="kpi-ic blue"><Icon name="scale" /></span>
            {netChg && <span className="chg rp-chg" id="rpNetChg" title={netChg.title} aria-label={netChg.title}>{netChg.chg}</span>}
          </div>
          <span className="kpi-label">خالص جریان نقدی</span>
          <div className="kpi-val">
            <b id="rpNet" className={s.net !== null && s.net < 0 ? 'neg' : ''}>{s.net === null ? 'ـ' : netMoney(s.net)}</b>
            {s.net !== null && <small id="rpNetUnit">تومان</small>}
          </div>
          <div className="kpi-foot">
            <span id="rpNetNote">{s.net === null
              ? 'به درآمد و هزینه هر دو نیاز دارد؛ نوع «همه تراکنش‌ها» و «همه دسته‌ها» را انتخاب کنید'
              : !s.count ? 'تراکنشی در این دوره ثبت نشده است'
                : s.net < 0 ? 'هزینه‌های ثبت‌شده بیشتر از درآمدهای ثبت‌شده است' : 'مجموع درآمد منهای مجموع هزینه'}</span>
          </div>
        </article>

        <article className="kpi card">
          <div className="kpi-top">
            <span className="kpi-ic teal"><Icon name="piggy-bank" /></span>
            {rateChg && <span className="chg rp-chg" id="rpRateChg" title={rateChg.title} aria-label={rateChg.title}>{rateChg.chg}</span>}
          </div>
          <span className="kpi-label">نرخ پس‌انداز</span>
          <div className="kpi-val"><b id="rpRate" className={s.rate !== null && s.rate < 0 ? 'neg' : ''}>{s.rate === null ? 'ـ' : ratePct(s.rate)}</b></div>
          <div className="kpi-foot">
            <span id="rpRateNote">{s.net === null
              ? 'به درآمد و هزینه هر دو نیاز دارد'
              : s.rate === null ? 'درآمدی ثبت نشده است؛ نرخ پس‌انداز قابل محاسبه نیست' : 'خالص جریان نقدی ÷ مجموع درآمد'}</span>
          </div>
        </article>
      </div>

      <article className="card rp-chart-card" aria-labelledby="rpMonthTitle">
        <div className="card-head">
          <div><h2 id="rpMonthTitle">درآمد و هزینه ماهانه</h2><p id="rpMonthSub">{`${count(P.months.length)} ماه شمسی در «${P.label}» ـ مبالغ به میلیون تومان`}</p></div>
          <ul className="fc-legend rp-legend" aria-label="راهنمای نمودار">
            {r.include.income && <li><i className="lg lg-inc" aria-hidden="true" />درآمد ثبت‌شده</li>}
            {r.include.expense && <li><i className="lg lg-exp" aria-hidden="true" />هزینه ثبت‌شده</li>}
            {r.include.income && r.include.expense && <li><i className="lg lg-net" aria-hidden="true" />خالص جریان نقدی</li>}
          </ul>
        </div>
        {monthlyEmpty ? (
          <div className="empty-state" id="rpMonthEmpty">
            <div className="es-ic"><Icon name="bar-chart-3" /></div>
            <strong>داده‌ای برای نمودار وجود ندارد</strong>
            <p>در «{P.label}» تراکنشی{st.type !== 'all' || category ? ' مطابق فیلترها' : ''} ثبت نشده است. دوره طولانی‌تری انتخاب کنید یا تراکنش‌های خود را در صفحه‌های درآمد و هزینه ثبت کنید.</p>
          </div>
        ) : (
          <div className="chart-box rp-chart" id="rpMonthBox">
            <ChartCanvas ref={monthChartRef} type="bar" data={monthChartData} options={monthChartOptions} ariaLabel={monthChartAria} />
          </div>
        )}
        <p className="fc-chart-note" id="rpMonthNote">{monthNotes.join(' ')}</p>
        <details className="fc-month-details hs-details">
          <summary><Icon name="table" />جدول ماهانه نمودار</summary>
          <div className="table-wrap">
            <table className="tx rp-month-table">
              <caption className="sr-only">درآمد، هزینه، خالص جریان نقدی و نرخ پس‌انداز هر ماه</caption>
              <thead><tr><th scope="col">ماه</th><th scope="col">درآمد</th><th scope="col">هزینه</th><th scope="col">خالص جریان نقدی</th><th scope="col">نرخ پس‌انداز</th><th scope="col">تعداد تراکنش</th></tr></thead>
              <tbody id="rpMonthBody">
                {r.monthly.slice().reverse().map((m) => {
                  const tag = monthTag(m, r);
                  return (
                    <tr key={m.key}>
                      <th scope="row">{m.label}{tag && <> <small className="rp-na">{tag}</small></>}</th>
                      <td>{cellFor(m, 'income')}</td>
                      <td>{cellFor(m, 'expense')}</td>
                      <td>{m.net === null ? <span className="rp-na">ـ</span>
                        : <><span className={m.net < 0 ? 'rp-neg' : ''}>{netMoney(m.net)}</span> <small className="rp-na">تومان</small></>}</td>
                      <td>{m.rate === null ? <span className="rp-na">ـ</span> : ratePct(m.rate)}</td>
                      <td>{count(m.incomeCount + m.expenseCount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </article>

      <div className="rp-grid2">
        <article className="card rp-cat-card" aria-labelledby="rpCatTitle">
          <div className="card-head">
            <div>
              <h2 id="rpCatTitle">تحلیل هزینه‌ها بر اساس دسته‌بندی</h2>
              <p id="rpCatSub">{catsVisible
                ? `مجموع ${money(r.expenseTotal)} تومان در ${count(r.categories.length)} دسته ـ برای فیلتر کردن گزارش روی هر دسته بزنید`
                : r.include.expense ? 'بدون هزینه ثبت‌شده' : 'غیرفعال با فیلتر فعلی'}</p>
            </div>
          </div>
          {catsVisible ? (
            <div className="rp-cat-body" id="rpCatBody">
              <div className="chart-box donut rp-donut">
                <ChartCanvas ref={catChartRef} type="doughnut" data={catChartData} options={catChartOptions} ariaLabel={catChartAria} />
                <div className="donut-center"><span>مجموع هزینه</span><b id="rpCatTotal">{mil(r.expenseTotal)}</b><small>میلیون تومان</small></div>
              </div>
              <ul className="rp-cat-list" id="rpCatList" aria-label="سهم هر دسته از هزینه‌ها">
                {r.categories.map((x) => {
                  const m = catMeta('expense', x.name);
                  const on = category === x.name;
                  return (
                    <li key={x.name}>
                      <button type="button" className="rp-cat-btn" data-cat={x.name} aria-pressed={on}
                        aria-label={`${x.name}: ${money(x.amount)} تومان، ${pctAbs(x.share)} از هزینه‌ها، ${count(x.count)} تراکنش. ${on ? 'برداشتن فیلتر این دسته' : 'نمایش تراکنش‌های این دسته'}`}
                        onClick={() => {
                          setFilter('category', on ? '' : x.name);
                          if (!on) listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}>
                        <span className="rp-cat-top">
                          <i style={{ background: m.color }} />
                          <span className="rp-cat-name">{x.name}</span>
                          <span className="rp-cat-amt">{money(x.amount)} <small className="rp-na">تومان</small></span>
                          <span className="rp-cat-pct">{pctAbs(x.share)}</span>
                        </span>
                        <span className="rp-cat-meta">{count(x.count)} تراکنش ـ میانگین هر تراکنش {money(x.avg)} تومان</span>
                        <span className="rp-cat-bar"><span style={{ width: `${(x.share * 100).toFixed(1)}%`, background: m.color }} /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="empty-state" id="rpCatEmpty">
              <div className="es-ic"><Icon name="pie-chart" /></div>
              <strong>{!r.include.expense ? 'تحلیل دسته‌ها مربوط به هزینه‌هاست' : 'هزینه‌ای در این دوره ثبت نشده است'}</strong>
              <p>{!r.include.expense
                ? 'فیلتر «فقط درآمد» فعال است. برای دیدن سهم دسته‌های هزینه، نوع تراکنش را «همه تراکنش‌ها» یا «فقط هزینه» انتخاب کنید.'
                : `در «${r.period.label}» تراکنش هزینه‌ای${category ? ` در دسته «${category}»` : ''} ثبت نشده، بنابراین سهمی برای دسته‌ها نمایش داده نمی‌شود.`}</p>
            </div>
          )}
        </article>

        <article className="card rp-cmp-card" aria-labelledby="rpCmpTitle">
          <div className="card-head">
            <div>
              <h2 id="rpCmpTitle">مقایسه با دوره مشابه قبل</h2>
              <p id="rpCmpSub">{c ? `${r.period.label} در برابر ${c.period.label}` : 'ـ'}</p>
            </div>
          </div>
          <div id="rpCmp">
            {c && !c.available && (() => {
              const reason = ['expense', 'income'].map((t) => c.reason[t]).find((x) => x && x !== 'filtered') || 'filtered';
              const t = c.reason.expense && c.reason.expense !== 'filtered' ? 'expense' : 'income';
              return (
                <div className="rp-cmp-empty">
                  <Icon name="info" />
                  <p><b>مقایسه برای این دوره در دسترس نیست.</b> {REASON[reason](c, t)}.{reason === 'history' ? ' دوره کوتاه‌تری مثل «ماه جاری» یا «ماه گذشته» را انتخاب کنید.' : ''}</p>
                </div>
              );
            })()}
            {c && c.available && (() => {
              const m = (v) => <>{netMoney(v)} <small className="rp-na">تومان</small></>;
              const cmpRow = (title, k, fmtVal, t) => {
                const x = c[k];
                if (!x) {
                  const reasonFn = REASON[c.reason[k]] || REASON.filtered;
                  return <div className="rp-cmp-row" key={k}><b>{title}</b><span className="rp-cmp-na">{reasonFn(c, t || (k === 'income' ? 'income' : 'expense'))}</span></div>;
                }
                const chgTxt = k === 'rate'
                  ? points(x.abs)
                  : <>{signedMoney(x.abs)} <small>{x.pct !== null ? signedPct(x.pct) : 'درصد تغییر: پایه صفر یا منفی'}</small></>;
                return (
                  <div className="rp-cmp-row" key={k}>
                    <b>{title}</b><span>{fmtVal(x.cur)}</span><span>{fmtVal(x.prev)}</span><span className="rp-cmp-chg">{chgTxt}</span>
                  </div>
                );
              };
              return (
                <>
                  <div className="rp-cmp" role="table" aria-label="مقایسه دوره فعلی با دوره قبل">
                    <div className="rp-cmp-row rp-cmp-head" role="row"><span>معیار</span><span>دوره فعلی</span><span>دوره قبل</span><span>تغییر</span></div>
                    {cmpRow('مجموع درآمد', 'income', m)}
                    {cmpRow('مجموع هزینه', 'expense', m)}
                    {cmpRow('خالص جریان نقدی', 'net', m)}
                    {cmpRow('نرخ پس‌انداز', 'rate', ratePct)}
                  </div>
                  <p className="rp-cmp-note">{r.period.toDate ? 'چون ماه جاری هنوز تمام نشده، دوره قبل هم تا همان روز ماه شمرده شده است. ' : ''}تغییرها فقط افزایش یا کاهشِ مبالغ ثبت‌شده را نشان می‌دهند؛ خوب یا بد بودن آن به شرایط و برنامه مالی شما بستگی دارد.</p>
                </>
              );
            })()}
          </div>
        </article>
      </div>

      <div className="rp-grid2">
        <article className="card" aria-labelledby="rpRateTitle">
          <div className="card-head">
            <div>
              <h2 id="rpRateTitle">روند پس‌انداز</h2>
              <p id="rpRateSub">نرخ پس‌انداز هر ماه = خالص جریان نقدی ÷ درآمد همان ماه{rateVisible && s.rate !== null ? ` ـ کل دوره: ${ratePct(s.rate)}` : ''}</p>
            </div>
          </div>
          {rateVisible ? (
            <div className="chart-box rp-chart-sm" id="rpRateBox">
              <ChartCanvas ref={rateChartRef} type="line" data={rateChartData} options={rateChartOptions} ariaLabel={rateChartAria} />
            </div>
          ) : (
            <div className="empty-state" id="rpRateEmpty">
              <div className="es-ic"><Icon name="piggy-bank" /></div>
              <strong>روند پس‌انداز قابل نمایش نیست</strong>
              <p>{!rateOk
                ? 'نرخ پس‌انداز به درآمد و هزینه هر دو نیاز دارد؛ نوع تراکنش را «همه تراکنش‌ها» و دسته را «همه دسته‌ها» انتخاب کنید.'
                : 'در ماه‌های این دوره درآمدی ثبت نشده است، بنابراین نرخ پس‌انداز قابل محاسبه نیست.'}</p>
            </div>
          )}
        </article>

        <article className="card" aria-labelledby="rpTopTitle">
          <div className="card-head">
            <div>
              <h2 id="rpTopTitle">بزرگ‌ترین هزینه‌های ثبت‌شده</h2>
              <p id="rpTopSub">{r.include.expense ? `${count(r.topExpenses.length)} هزینه با بیشترین مبلغ در «${r.period.label}»` : 'غیرفعال با فیلتر «فقط درآمد»'}</p>
            </div>
          </div>
          <ol className="rp-top" id="rpTop">
            {!r.include.expense ? (
              <li className="rp-top-empty">این بخش مربوط به هزینه‌هاست و با فیلتر «فقط درآمد» نمایش داده نمی‌شود.</li>
            ) : !r.topExpenses.length ? (
              <li className="rp-top-empty">هزینه‌ای در این دوره ثبت نشده است.</li>
            ) : r.topExpenses.map((x, i) => (
              <li key={x.id}>
                <span className="rp-rank">{count(i + 1)}</span>
                <span className="rp-top-txt">
                  <b>{x.title}</b>
                  <small>{x.category} ـ {fmt.date(x.date)}{r.expenseTotal ? ` ـ ${pctAbs(x.amount / r.expenseTotal)} از هزینه‌های دوره` : ''}</small>
                </span>
                <span className="rp-top-amt">{money(x.amount)} <small>تومان</small></span>
              </li>
            ))}
          </ol>
        </article>
      </div>

      <article className="card rp-ins-card" aria-labelledby="rpInsTitle">
        <div className="card-head">
          <div>
            <h2 id="rpInsTitle">یافته‌های گزارش</h2>
            <p>برداشت‌هایی که مستقیماً از تراکنش‌های ثبت‌شده همین دوره محاسبه شده‌اند</p>
          </div>
        </div>
        <ul className="fc-insights" id="rpInsights">
          {insights.map((x, i) => (
            <li className={`fc-ins fc-ins-${x.tone}`} key={i}>
              <span className="fc-ins-ic" aria-hidden="true"><Icon name={x.icon} /></span>
              <p><span className="sr-only">{x.tone === 'warn' ? 'قابل توجه' : 'نکته'}: </span>{x.text}</p>
            </li>
          ))}
        </ul>
      </article>

      <article className="card rp-bud-card" aria-labelledby="rpBudTitle">
        <div className="card-head">
          <div><h2 id="rpBudTitle">عملکرد بودجه</h2><p id="rpBudSub">{budSub}</p></div>
          <Link className="link-btn" to="/budgets">مدیریت بودجه‌ها<Icon name="chevron-left" /></Link>
        </div>
        {bud && !bud.filtered && bud.rows.length > 0 && (
          <div className="rp-bud-sum" id="rpBudSum">
            <div className="rp-bs"><span>مجموع سقف بودجه</span><b>{money(bud.limit)} <small>تومان</small></b></div>
            <div className="rp-bs"><span>هزینه واقعی دسته‌های دارای بودجه</span><b>{money(bud.spent)} <small>تومان</small></b></div>
            <div className="rp-bs"><span>مانده بودجه</span><b className={bud.remaining < 0 ? 'neg' : ''}>{netMoney(bud.remaining)} <small>تومان</small></b></div>
            <div className="rp-bs"><span>عبور از سقف بودجه</span><b>{count(bud.over.length)} <small>از {count(bud.rows.length)} بودجه</small></b></div>
          </div>
        )}
        {bud && !bud.filtered && bud.rows.length > 0 && (
          <div className="table-wrap" id="rpBudWrap">
            <table className="tx rp-bud-table">
              <caption className="sr-only">سقف بودجه، هزینه واقعی، مانده و درصد مصرف هر بودجه در دوره گزارش</caption>
              <thead><tr><th scope="col">ماه</th><th scope="col">دسته‌بندی</th><th scope="col">سقف بودجه</th><th scope="col">هزینه واقعی</th><th scope="col">مانده بودجه</th><th scope="col">درصد مصرف</th><th scope="col">وضعیت</th></tr></thead>
              <tbody id="rpBudBody">
                {bud.rows.slice().sort((x, y) => (y.monthKey.localeCompare(x.monthKey)) || (y.pct - x.pct)).map((x) => {
                  const stx = budgetCalc.STATUS[x.status];
                  const m = catMeta('expense', x.category);
                  return (
                    <tr key={`${x.monthKey}-${x.id}`}>
                      <td>{x.monthLabel}</td>
                      <td><span className="badge" style={{ background: m.bg, color: m.color }}>{x.category}</span></td>
                      <td>{money(x.limit)}</td>
                      <td>{money(x.spent)}</td>
                      <td className={x.remaining < 0 ? 'rp-neg' : ''}>{netMoney(x.remaining)}</td>
                      <td><span className="rp-usage"><i aria-hidden="true"><span style={{ width: `${x.barPct}%`, background: stx.bar }} /></i>{dec(x.pct, 1)}٪</span></td>
                      <td><span className="fc-pill" style={{ background: stx.bg, color: stx.color }}><Icon name={stx.icon} />{stx.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot id="rpBudFoot">
                <tr>
                  <th scope="row" colSpan={2}>جمع {count(bud.rows.length)} بودجه</th>
                  <td>{money(bud.limit)}</td>
                  <td>{money(bud.spent)}</td>
                  <td className={bud.remaining < 0 ? 'rp-neg' : ''}>{netMoney(bud.remaining)}</td>
                  <td>{bud.pct === null ? 'ـ' : dec(bud.pct * 100, 1) + '٪'}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {bud && !bud.filtered && !bud.rows.length && (
          <div className="empty-state" id="rpBudEmpty">
            <div className="es-ic"><Icon name="wallet" /></div>
            <strong>{budgets.length ? 'برای این دوره بودجه‌ای تعریف نشده است' : 'هنوز بودجه‌ای تعریف نکرده‌اید'}</strong>
            <p>{budgets.length
              ? `برای ${r.period.months.map((m) => m.label).join('، ')}${category ? ` در دسته «${category}»` : ''} بودجه‌ای ثبت نشده است. با تعریف بودجه، این تحلیل فعال می‌شود.`
              : 'با ساخت بودجه ماهانه برای دسته‌های هزینه، سقف بودجه، هزینه واقعی و مانده هر دسته اینجا مقایسه می‌شود.'}</p>
            <Link className="btn primary" to="/budgets"><Icon name="plus" />رفتن به بودجه‌بندی</Link>
          </div>
        )}
        {bud && bud.filtered && (
          <div className="empty-state" id="rpBudEmpty">
            <div className="es-ic"><Icon name="wallet" /></div>
            <strong>عملکرد بودجه مربوط به هزینه‌هاست</strong>
            <p>برای مقایسه سقف بودجه با هزینه واقعی، نوع تراکنش را «همه تراکنش‌ها» یا «فقط هزینه» انتخاب کنید.</p>
          </div>
        )}
      </article>

      <article className="card ledger-card rp-ledger" id="rpLedger" aria-labelledby="rpTxTitle" ref={ledgerRef}>
        <div className="card-head">
          <div>
            <h2 id="rpTxTitle">گزارش تفصیلی تراکنش‌ها</h2>
            <p id="rpTxSummary" aria-live="polite">{rows.length
              ? `${count(rows.length)} تراکنش${st.search ? ' مطابق جست‌وجو' : ''} در «${r.period.label}» ـ ${summaryParts.join('، ')}`
              : 'موردی برای نمایش وجود ندارد'}</p>
          </div>
          <button type="button" className="btn ghost" id="rpExport2" onClick={exportCSV}><Icon name="file-spreadsheet" />دریافت همین فهرست (فایل اکسل‌پذیر)</button>
        </div>
        <div className="toolbar rp-toolbar" role="group" aria-label="جست‌وجو، فیلتر و مرتب‌سازی تراکنش‌ها">
          <div className="search field-search">
            <Icon name="search" />
            <label className="sr-only" htmlFor="rpSearch">جست‌وجو در عنوان یا توضیحات تراکنش</label>
            <input type="search" id="rpSearch" placeholder="جست‌وجو در عنوان یا توضیحات…" autoComplete="off"
              value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </div>
          <div className="sel">
            <label htmlFor="rpType2">نوع تراکنش</label>
            <select id="rpType2" data-sync="type" value={st.type} onChange={(e) => setFilter('type', e.target.value)}>
              <option value="all">همه تراکنش‌ها</option>
              <option value="income">فقط درآمد</option>
              <option value="expense">فقط هزینه</option>
            </select>
          </div>
          <div className="sel">
            <label htmlFor="rpCat2">دسته هزینه</label>
            <select id="rpCat2" data-sync="category" value={category} onChange={(e) => setFilter('category', e.target.value)}>
              <option value="">همه دسته‌ها</option>
              {names.map((c2) => <option key={c2} value={c2}>{c2}</option>)}
            </select>
          </div>
          <div className="sel">
            <label htmlFor="rpSort">مرتب‌سازی</label>
            <select id="rpSort" value={st.sort} onChange={(e) => update({ sort: e.target.value, page: 1 })}>
              <option value="date-desc">جدیدترین</option>
              <option value="date-asc">قدیمی‌ترین</option>
              <option value="amount-desc">بیشترین مبلغ</option>
              <option value="amount-asc">کمترین مبلغ</option>
            </select>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="tx ledger-table rp-tx-table">
              <caption className="sr-only">تراکنش‌های دوره گزارش مطابق فیلترها</caption>
              <thead>
                <tr>
                  <th scope="col" aria-sort={sortKey === 'date' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} data-sortcol="date" className={sortKey === 'date' ? 'sorted' : ''}>
                    <button type="button" className="th-sort" data-sort="date" onClick={() => sortByColumn('date')}>
                      تاریخ<Icon name={sortIcon('date')} />
                    </button>
                  </th>
                  <th scope="col">عنوان تراکنش</th>
                  <th scope="col">نوع تراکنش</th>
                  <th scope="col">دسته‌بندی</th>
                  <th scope="col" aria-sort={sortKey === 'amount' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} data-sortcol="amount" className={sortKey === 'amount' ? 'sorted' : ''}>
                    <button type="button" className="th-sort" data-sort="amount" onClick={() => sortByColumn('amount')}>
                      مبلغ<Icon name={sortIcon('amount')} />
                    </button>
                  </th>
                  <th scope="col">روش پرداخت</th>
                  <th scope="col">توضیحات</th>
                </tr>
              </thead>
              <tbody id="rpTxBody">
                {rows.map((x, idx) => {
                  const onPage = idx >= (safePage - 1) * PAGE && idx < safePage * PAGE;
                  const isInc = x.type === 'income';
                  const m = catMeta(x.type, x.category);
                  return (
                    <tr key={x.id} style={onPage ? undefined : { display: 'none' }}>
                      <td data-label="تاریخ" className="date">{fmt.date(x.date)}</td>
                      <td data-label="عنوان تراکنش" className="t-title">
                        <span className="cat">
                          <em style={{ background: m.bg, color: m.color }}><Icon name={m.icon} /></em>
                          <b><Highlight text={x.title} query={st.search} /></b>
                        </span>
                      </td>
                      <td data-label="نوع تراکنش">
                        <span className={`type ${isInc ? 'in' : 'out'}`}>
                          <Icon name={isInc ? 'arrow-down-left' : 'arrow-up-right'} />{isInc ? 'درآمد' : 'هزینه'}
                        </span>
                      </td>
                      <td data-label="دسته‌بندی"><span className="badge" style={{ background: m.bg, color: m.color }}>{x.category || '—'}</span></td>
                      <td data-label="مبلغ" className={`amt ${isInc ? 'in' : 'out'}`}><span>{money(x.amount)} <small>تومان</small></span></td>
                      <td data-label="روش پرداخت" className="method">{x.method || '—'}</td>
                      <td data-label="توضیحات" className="desc">
                        <span>{x.description ? <Highlight text={x.description} query={st.search} /> : <span className="muted">—</span>}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length === 0 && (
          <div className="empty-state" id="rpTxEmpty">
            {!r.records.length ? (
              <>
                <div className="es-ic"><Icon name="file-search" /></div>
                <strong>در این دوره تراکنشی{st.type !== 'all' || category ? ' مطابق فیلترها' : ''} ثبت نشده است</strong>
                <p>دوره دیگری انتخاب کنید یا تراکنش‌های خود را ثبت کنید تا گزارش تفصیلی اینجا نمایش داده شود.</p>
                <div className="rp-empty-acts">
                  <Link className="btn ghost" to="/income"><Icon name="hand-coins" />ثبت درآمد</Link>
                  <Link className="btn ghost" to="/expenses"><Icon name="receipt" />ثبت هزینه</Link>
                </div>
              </>
            ) : (
              <>
                <div className="es-ic"><Icon name="search-x" /></div>
                <strong>تراکنشی با این جست‌وجو پیدا نشد</strong>
                <p>عبارت «{st.search}» در عنوان یا توضیحات تراکنش‌های این دوره پیدا نشد.</p>
                <button type="button" className="btn ghost" data-empty="search"
                  onClick={() => { setSearchText(''); update({ search: '', page: 1 }); document.getElementById('rpSearch')?.focus(); }}>
                  <Icon name="x" />پاک کردن جست‌وجو
                </button>
              </>
            )}
          </div>
        )}

        <div id="rpPager">
          {rows.length > 0 && (
            <Pager page={safePage} pages={pages} total={rows.length} size={PAGE} unit="تراکنش" collapse
              label="صفحه‌بندی گزارش تراکنش‌ها"
              onPage={(p) => { update({ page: p }); ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
          )}
        </div>
      </article>

      <article className="card hs-about rp-about" aria-labelledby="rpAboutTitle">
        <div className="card-head">
          <div>
            <h2 id="rpAboutTitle">روش محاسبه گزارش‌ها</h2>
            <p>همه اعداد این صفحه از تراکنش‌ها و بودجه‌های ثبت‌شده در Finova محاسبه می‌شوند</p>
          </div>
        </div>
        <ul className="hs-about-list">
          <li><b>مجموع درآمد و هزینه:</b> جمع مبلغ تراکنش‌های درآمد و جمع مبلغ تراکنش‌های هزینه‌ای که تاریخشان در دوره گزارش است؛ این دو هرگز با هم جمع نمی‌شوند. این اعداد جمع تراکنش‌های ثبت‌شده‌اند، نه مانده حساب بانکی.</li>
          <li><b>خالص جریان نقدی:</b> مجموع درآمد منهای مجموع هزینه. عدد منفی یعنی هزینه‌های ثبت‌شده بیشتر از درآمدهای ثبت‌شده بوده است.</li>
          <li><b>نرخ پس‌انداز:</b> خالص جریان نقدی تقسیم بر مجموع درآمد؛ اگر درآمدی ثبت نشده باشد، محاسبه نمی‌شود.</li>
          <li><b>فیلترها:</b> با انتخاب «فقط درآمد»، «فقط هزینه» یا یک دسته هزینه، معیارهایی که به هر دو نوع تراکنش نیاز دارند (خالص و نرخ پس‌انداز) نمایش داده نمی‌شوند تا عدد گمراه‌کننده‌ای ساخته نشود.</li>
          <li><b>دوره مشابه قبل:</b> همان تعداد ماهِ بلافاصله قبل؛ اگر دوره تا امروز است، ماه آخرِ دوره قبل هم تا همان روز ماه شمرده می‌شود. برای «سال جاری» همان بازه سال قبل و برای بازه دلخواه همان تعداد روزِ قبل از آن.</li>
          <li><b>داده ناموجود:</b> ماه‌های پیش از نخستین تراکنش ثبت‌شده «بدون داده» هستند و صفر فرض نمی‌شوند؛ ماهی بعد از آن که تراکنشی ندارد «تراکنشی ثبت نشده» نمایش داده می‌شود. اگر سابقه کافی نباشد، مقایسه انجام نمی‌شود.</li>
          <li><b>بودجه:</b> بودجه‌های ماه‌هایی که در دوره گزارش قرار دارند، با همان محاسبه صفحه بودجه‌بندی (هزینه واقعی کل همان ماه در همان دسته).</li>
          <li><b>خروجی:</b> فایل جدولی (قابل باز شدن در اکسل) دقیقاً همان تراکنش‌های جدول تفصیلی را با همان فیلتر، جست‌وجو و ترتیب دارد و حروف فارسی در آن درست نمایش داده می‌شود. نسخه چاپی یا پی‌دی‌اف از طریق پنجره چاپ مرورگر ساخته می‌شود.</li>
        </ul>
      </article>
    </div>
  );
}
