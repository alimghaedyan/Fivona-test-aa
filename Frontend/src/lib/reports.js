/* محاسبات صفحه گزارش‌ها و تحلیل مالی */
import { jalali as J } from './jalali.js';
import { stats, budgetCalc, util } from './calc.js';
import { defaultExpenseNames } from './categories.js';

const pad = (n) => String(n).padStart(2, '0');
const FA = '۰۱۲۳۴۵۶۷۸۹';
const digits = (s) => String(s).replace(/\d/g, (d) => FA[d]);
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const TYPE_LABEL = { income: 'درآمد', expense: 'هزینه' };
const PRESETS = ['this', 'last', '3m', '6m', 'year', 'custom'];
const SORTS = ['date-desc', 'date-asc', 'amount-desc', 'amount-asc'];
const TOP_N = 5;

function validISO(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number), dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number), dt = new Date(Date.UTC(y, m - 1, d + n)); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const shiftJM = (jy, jm, n) => { jm += n; while (jm < 1) { jm += 12; jy--; } while (jm > 12) { jm -= 12; jy++; } return { jy, jm }; };
const ratioOf = (a, b) => (b > 0 && isFinite(a) && isFinite(b) ? a / b : null);
const isValidTx = (x) => !!x && (x.type === 'income' || x.type === 'expense') && validISO(x.date) && typeof x.amount === 'number' && isFinite(x.amount) && x.amount > 0;

function monthEnd(jy, jm) { return J.toISO(jy, jm, J.monthLength(jy, jm)); }

function rangeLabel(from, to) {
  const a = J.fromISO(from), b = J.fromISO(to);
  const full = a.jd === 1 && b.jd === J.monthLength(b.jy, b.jm);
  if (a.jy === b.jy && a.jm === b.jm) return digits(full ? `${MONTHS[a.jm - 1]} ${a.jy}` : `${a.jd} تا ${b.jd} ${MONTHS[a.jm - 1]} ${a.jy}`);
  if (full) return digits(a.jy === b.jy ? `${MONTHS[a.jm - 1]} تا ${MONTHS[b.jm - 1]} ${b.jy}` : `${MONTHS[a.jm - 1]} ${a.jy} تا ${MONTHS[b.jm - 1]} ${b.jy}`);
  return digits(a.jy === b.jy ? `${a.jd} ${MONTHS[a.jm - 1]} تا ${b.jd} ${MONTHS[b.jm - 1]} ${b.jy}` : `${a.jd} ${MONTHS[a.jm - 1]} ${a.jy} تا ${b.jd} ${MONTHS[b.jm - 1]} ${b.jy}`);
}

function monthsIn(from, to) {
  const a = J.fromISO(from), b = J.fromISO(to), out = [];
  let { jy, jm } = a;
  while ((jy < b.jy || (jy === b.jy && jm <= b.jm)) && out.length < 240) {
    const ms = J.toISO(jy, jm, 1), me = monthEnd(jy, jm);
    const s = from > ms ? from : ms, e = to < me ? to : me;
    out.push({ key: `${jy}-${pad(jm)}`, jy, jm, label: digits(`${MONTHS[jm - 1]} ${jy}`), short: MONTHS[jm - 1], from: s, to: e, partial: s !== ms || e !== me });
    ({ jy, jm } = shiftJM(jy, jm, 1));
  }
  return out;
}

function build(from, to, extra) {
  return { from, to, label: rangeLabel(from, to), days: daysBetween(from, to) + 1, months: monthsIn(from, to), ...extra };
}

function period(preset, ctx) {
  if (!PRESETS.includes(preset)) preset = 'this';
  const [cy, cm] = ctx.currentKey.split('-').map(Number);
  const curEnd = monthEnd(cy, cm);
  const capTo = ctx.asOf && ctx.asOf < curEnd ? ctx.asOf : curEnd;
  const toDate = capTo < curEnd;
  const dayOfMonth = J.fromISO(capTo).jd;

  if (preset === 'custom') {
    const { from, to } = ctx;
    if (!validISO(from) || !validISO(to)) return { preset, error: 'invalid' };
    if (from > to) return { preset, error: 'order' };
    const days = daysBetween(from, to) + 1;
    const prev = build(addDays(from, -days), addDays(from, -1), {});
    return build(from, to, { preset, toDate: false, future: ctx.asOf && to > ctx.asOf, prev });
  }
  if (preset === 'year') {
    const to = capTo, pj = J.fromISO(to);
    const prevTo = J.toISO(cy - 1, pj.jm, Math.min(pj.jd, J.monthLength(cy - 1, pj.jm)));
    return build(J.toISO(cy, 1, 1), to, { preset, toDate, prev: build(J.toISO(cy - 1, 1, 1), prevTo, {}) });
  }
  const spec = { this: [0, 0], last: [1, 1], '3m': [2, 0], '6m': [5, 0] }[preset];
  const [startBack, endBack] = spec, n = startBack - endBack + 1;
  const s = shiftJM(cy, cm, -startBack), e = shiftJM(cy, cm, -endBack);
  const endsNow = endBack === 0;
  const from = J.toISO(s.jy, s.jm, 1), to = endsNow ? capTo : monthEnd(e.jy, e.jm);
  const ps = shiftJM(s.jy, s.jm, -n), pe = shiftJM(e.jy, e.jm, -n);
  const prevTo = endsNow && toDate ? J.toISO(pe.jy, pe.jm, Math.min(dayOfMonth, J.monthLength(pe.jy, pe.jm))) : monthEnd(pe.jy, pe.jm);
  return build(from, to, { preset, toDate: endsNow && toDate, prev: build(J.toISO(ps.jy, ps.jm, 1), prevTo, {}) });
}

function summarize(list, inc) {
  let income = 0, expense = 0, incomeCount = 0, expenseCount = 0;
  list.forEach((x) => { if (x.type === 'income') { income += x.amount; incomeCount++; } else { expense += x.amount; expenseCount++; } });
  const both = inc.income && inc.expense;
  const net = both ? income - expense : null;
  return {
    income: inc.income ? income : null, incomeCount, expense: inc.expense ? expense : null, expenseCount,
    net, rate: both ? ratioOf(net, income) : null, count: list.length,
  };
}

function change(cur, prev) {
  if (cur === null || prev === null) return null;
  const abs = cur - prev;
  return { cur, prev, abs, pct: prev > 0 ? abs / prev : null };
}

const sorters = {
  'date-desc': (a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0) || (b.amount - a.amount) || String(a.id).localeCompare(String(b.id)),
  'date-asc': (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.amount - b.amount) || String(a.id).localeCompare(String(b.id)),
  'amount-desc': (a, b) => (b.amount - a.amount) || (b.date < a.date ? -1 : b.date > a.date ? 1 : 0) || String(a.id).localeCompare(String(b.id)),
  'amount-asc': (a, b) => (a.amount - b.amount) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || String(a.id).localeCompare(String(b.id)),
};
const defaultNorm = (s) => String(s || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function compute(o) {
  const P = o.period, type = ['income', 'expense'].includes(o.type) ? o.type : 'all';
  const category = o.category || '';
  const inc = { income: type !== 'expense' && !category, expense: type !== 'income' };
  const norm = o.norm || defaultNorm;
  const all = Array.isArray(o.transactions) ? o.transactions : [];
  const valid = all.filter(isValidTx), skipped = all.length - valid.length;

  const start = { income: null, expense: null };
  valid.forEach((x) => { if (!start[x.type] || x.date < start[x.type]) start[x.type] = x.date; });
  const anyStart = [start.income, start.expense].filter(Boolean).sort()[0] || null;

  const matches = (x) => (x.type === 'income' ? inc.income : inc.expense && (!category || x.category === category));
  const inP = (x, p) => x.date >= p.from && x.date <= p.to;
  const records = valid.filter((x) => inP(x, P) && matches(x));
  const summary = summarize(records, inc);

  const asOf = o.asOf || null;
  const statusOf = (t, m, count) => {
    if (asOf && m.from > asOf) return 'future';
    if (!start[t] || m.to < start[t]) return 'unavailable';
    return count > 0 ? 'recorded' : 'none';
  };
  const monthly = P.months.map((m) => {
    const list = records.filter((x) => x.date >= m.from && x.date <= m.to);
    const s = summarize(list, inc);
    const st = { income: inc.income ? statusOf('income', m, s.incomeCount) : 'filtered', expense: inc.expense ? statusOf('expense', m, s.expenseCount) : 'filtered' };
    const known = (k) => st[k] === 'recorded' || st[k] === 'none';
    const income = known('income') ? s.income : null, expense = known('expense') ? s.expense : null;
    const net = known('income') && known('expense') && (s.incomeCount + s.expenseCount) > 0 ? s.income - s.expense : null;
    const rate = net !== null ? ratioOf(net, s.income) : null;
    return { ...m, income, expense, incomeCount: s.incomeCount, expenseCount: s.expenseCount, net, rate, status: st };
  });
  const allStatus = (m, v) => { const s = ['income', 'expense'].filter((t) => inc[t]).map((t) => m.status[t]); return s.length > 0 && s.every((x) => x === v); };
  const unavailableMonths = monthly.filter((m) => allStatus(m, 'unavailable')).map((m) => m.key);
  const futureMonths = monthly.filter((m) => allStatus(m, 'future')).map((m) => m.key);

  const order = o.categories || [];
  const catMap = new Map();
  records.filter((x) => x.type === 'expense').forEach((x) => {
    const c = catMap.get(x.category) || { name: x.category, amount: 0, count: 0, largest: 0 };
    c.amount += x.amount; c.count++; c.largest = Math.max(c.largest, x.amount); catMap.set(x.category, c);
  });
  const expTotal = [...catMap.values()].reduce((a, c) => a + c.amount, 0);
  const categories = [...catMap.values()]
    .map((c) => ({ ...c, share: ratioOf(c.amount, expTotal), avg: c.amount / c.count }))
    .sort((a, b) => (b.amount - a.amount) || (order.indexOf(a.name) - order.indexOf(b.name)));

  const topExpenses = records.filter((x) => x.type === 'expense').sort(sorters['amount-desc']).slice(0, TOP_N);

  let comparison = null;
  if (P.prev) {
    const prevRecords = valid.filter((x) => inP(x, P.prev) && matches(x));
    const ps = summarize(prevRecords, inc);
    const histFrom = (tt) => { if (!start[tt]) return null; const j = J.fromISO(start[tt]); return J.toISO(j.jy, j.jm, 1); };
    const why = (t) => (!inc[t] ? 'filtered' : !start[t] || P.prev.from < histFrom(t) ? 'history' : (t === 'income' ? ps.incomeCount : ps.expenseCount) === 0 ? 'empty' : null);
    const reason = { income: why('income'), expense: why('expense') };
    reason.net = reason.income || reason.expense;
    reason.rate = reason.net || (!(ps.income > 0) || !(summary.income > 0) ? 'base' : null);
    comparison = {
      period: P.prev, summary: ps, reason,
      income: reason.income ? null : change(summary.income, ps.income),
      expense: reason.expense ? null : change(summary.expense, ps.expense),
      net: reason.net ? null : change(summary.net, ps.net),
      rate: reason.rate ? null : { cur: summary.rate, prev: ps.rate, abs: summary.rate - ps.rate, pct: null },
      categories: inc.expense && !reason.expense ? categories.map((c) => {
        const prevAmt = prevRecords.filter((x) => x.type === 'expense' && x.category === c.name).reduce((a, x) => a + x.amount, 0);
        return { name: c.name, ...change(c.amount, prevAmt) };
      }) : [],
    };
    comparison.available = ['income', 'expense', 'net'].some((k) => comparison[k]);
  }

  const q = norm(o.search || '');
  const sort = SORTS.includes(o.sort) ? o.sort : 'date-desc';
  const rows = records.filter((x) => !q || norm(x.title).includes(q) || norm(x.description).includes(q)).sort(sorters[sort]);

  let budget = null;
  if (o.budgetForMonth) {
    const list = inc.expense ? P.months.flatMap((m) => (o.budgetForMonth(m.key) || [])
      .filter((b) => !category || b.category === category)
      .map((b) => ({ ...b, monthKey: m.key, monthLabel: m.label, monthPartial: m.partial }))) : [];
    const limit = list.reduce((a, b) => a + b.limit, 0), spent = list.reduce((a, b) => a + b.spent, 0);
    budget = {
      rows: list, limit, spent, remaining: limit - spent, pct: ratioOf(spent, limit),
      over: list.filter((b) => b.spent > b.limit), monthsWithBudget: [...new Set(list.map((b) => b.monthKey))],
      filtered: !inc.expense,
    };
  }

  return {
    period: P, type, category, include: inc, records, rows, sort, summary, monthly, categories, expenseTotal: expTotal,
    topExpenses, comparison, budget, skipped, dataStart: start, anyStart, unavailableMonths, futureMonths,
    demoCount: records.filter((x) => x.demo).length,
  };
}

const CSV_HEAD = ['تاریخ', 'عنوان تراکنش', 'نوع تراکنش', 'دسته‌بندی', 'مبلغ (تومان)', 'روش پرداخت', 'توضیحات'];
function cell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const jDate = (iso) => { const j = J.fromISO(iso); return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`; };
function toCSV(rows) {
  const lines = [CSV_HEAD.map(cell).join(',')];
  rows.forEach((x) => lines.push([jDate(x.date), x.title, TYPE_LABEL[x.type], x.category, String(Math.round(x.amount)), x.method || '', x.description || ''].map(cell).join(',')));
  return lines.join('\r\n') + '\r\n';
}
function fileName(P, ext = 'csv') {
  const f = (iso) => jDate(iso).replace(/\//g, '-');
  return `گزارش-مالی-Finova_${f(P.from)}_تا_${f(P.to)}.${ext}`;
}

/** «امروز» برای گزارش: اگر تاریخ سیستم در ماه دوره برنامه است همان، وگرنه پایان آن ماه */
export function reportAsOf() {
  const t = J.todayISO(), cur = stats.periodKey(0);
  if (J.monthKey(t) === cur) return t;
  const [y, m] = cur.split('-').map(Number);
  return J.toISO(y, m, J.monthLength(y, m));
}

export function periodFor(preset, custom = {}) {
  return period(preset, { currentKey: stats.periodKey(0), asOf: reportAsOf(), ...custom });
}

/** گزارش از تراکنش‌ها و بودجه‌های واقعی */
export function reportsFromData(transactions, budgets, periodValue, f = {}) {
  return compute({
    transactions,
    period: periodValue,
    asOf: reportAsOf(),
    type: f.type,
    category: f.category,
    search: f.search,
    sort: f.sort,
    norm: util.norm,
    budgetForMonth: (key) => budgetCalc.forMonth(transactions, budgets, key),
    categories: defaultExpenseNames,
  });
}

export const reports = {
  make: () => ({ period, compute, summarize, change, rangeLabel, monthsIn, toCSV, fileName, CSV_HEAD }),
  period, compute, summarize, change, rangeLabel, monthsIn, toCSV, fileName, CSV_HEAD,
  validISO, isValidTx, ratio: ratioOf, addDays, PRESETS, SORTS, TYPE_LABEL,
  asOf: reportAsOf, periodFor, fromData: reportsFromData,
};
