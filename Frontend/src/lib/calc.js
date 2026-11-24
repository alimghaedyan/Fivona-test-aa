import { fmt } from './format.js';
import { jalali as J } from './jalali.js';

/** دوره جاری برنامه بر اساس تاریخ واقعی امروز (شمسی) */
export function currentPeriod() {
  const j = J.fromISO(J.todayISO());
  return { jy: j.jy, jm: j.jm };
}

/** دوره جاری به‌صورت پویا؛ با تغییر ماه، بدون بازنویسی کد به‌روز می‌شود */
export const config = { get period() { return currentPeriod(); }, pageSize: 8 };

/** آمار و بازه‌های زمانی مشترک */
export const stats = {
  /** کلید ماه‌های اخیر تا دوره گزارش */
  lastMonths(count = 6) {
    let { jy, jm } = config.period;
    const out = [];
    for (let i = 0; i < count; i++) {
      out.unshift({ key: `${jy}-${String(jm).padStart(2, '0')}`, jy, jm, label: J.monthNames[jm - 1] });
      jm--; if (jm === 0) { jm = 12; jy--; }
    }
    return out;
  },
  sumByMonth(rows, type, key) {
    return rows.filter((x) => x.type === type && J.monthKey(x.date) === key).reduce((s, x) => s + x.amount, 0);
  },
  incomeByMonth(rows, key) { return this.sumByMonth(rows, 'income', key); },
  expenseByMonth(rows, key) { return this.sumByMonth(rows, 'expense', key); },
  periodKey(offset = 0) {
    let { jy, jm } = config.period;
    jm -= offset;
    while (jm < 1) { jm += 12; jy--; }
    return `${jy}-${String(jm).padStart(2, '0')}`;
  },
  monthDiff(iso) {
    const { jy, jm } = config.period, j = J.fromISO(iso);
    return (jy - j.jy) * 12 + (jm - j.jm);
  },
  expenseByCategory(list) {
    const map = new Map();
    list.filter((x) => x.type === 'expense').forEach((x) => map.set(x.category || '—', (map.get(x.category || '—') || 0) + x.amount));
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    return {
      total,
      rows: [...map]
        .map(([name, amount]) => ({ name, amount, share: total ? amount / total : 0 }))
        .filter((r) => r.amount > 0)
        .sort((a, b) => b.amount - a.amount),
    };
  },
};

/** محاسبات بودجه */
const STATUS = {
  ok: { label: 'در محدوده بودجه', icon: 'check-circle-2', color: 'var(--green)', bg: 'var(--green-50)', bar: 'var(--green)' },
  warn: { label: 'نزدیک به سقف بودجه', icon: 'alert-triangle', color: 'var(--amber)', bg: 'var(--amber-50)', bar: 'var(--amber)' },
  full: { label: 'بودجه تکمیل شده', icon: 'circle-check-big', color: 'var(--orange-ink)', bg: 'var(--orange-50)', bar: 'var(--orange)' },
  over: { label: 'عبور از سقف بودجه', icon: 'alert-octagon', color: 'var(--red)', bg: 'var(--red-50)', bar: 'var(--red)' },
};
const WARN_AT = 80;

function monthSpend(rows, month) {
  const map = new Map();
  rows.filter((x) => x.type === 'expense').forEach((x) => {
    if (J.monthKey(x.date) !== month) return;
    const c = map.get(x.category) || { amount: 0, count: 0 };
    c.amount += x.amount; c.count++; map.set(x.category, c);
  });
  return map;
}
function budgetStatus(spent, limit) {
  if (spent > limit) return 'over';
  if (limit > 0 && spent === limit) return 'full';
  if (limit > 0 && (spent / limit) * 100 >= WARN_AT) return 'warn';
  return 'ok';
}
function evaluate(b, spend) {
  const s = spend.get(b.category) || { amount: 0, count: 0 };
  const pct = b.limit > 0 ? (s.amount / b.limit) * 100 : 0;
  return {
    ...b,
    spent: s.amount,
    count: s.count,
    remaining: b.limit - s.amount,
    pct,
    barPct: Math.min(100, Math.max(0, pct)),
    status: budgetStatus(s.amount, b.limit),
  };
}

export const budgetCalc = {
  STATUS,
  WARN_AT,
  status: budgetStatus,
  monthSpend: (rows, month) => monthSpend(rows, month),
  shiftMonth(key, n) {
    let [y, m] = key.split('-').map(Number);
    m += n;
    while (m < 1) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    return `${y}-${String(m).padStart(2, '0')}`;
  },
  monthLabel(key) {
    const [y, m] = key.split('-');
    return `${J.monthNames[+m - 1]} ${fmt.digits(y)}`;
  },
  forMonth(rows, budgets, month) {
    const spend = monthSpend(rows, month);
    return budgets.filter((b) => b.month === month).map((b) => evaluate(b, spend));
  },
  summary(rows, budgets, month) {
    const spend = monthSpend(rows, month);
    const rowsB = budgets.filter((b) => b.month === month).map((b) => evaluate(b, spend));
    const cats = new Set(rowsB.map((r) => r.category));
    const total = rowsB.reduce((a, r) => a + r.limit, 0);
    const actual = [...cats].reduce((a, c) => a + (spend.get(c)?.amount || 0), 0);
    const monthTotal = [...spend.values()].reduce((a, c) => a + c.amount, 0);
    const unbudgeted = [...spend]
      .filter(([c]) => !cats.has(c))
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.amount - a.amount);
    const counts = { ok: 0, warn: 0, full: 0, over: 0 };
    rowsB.forEach((r) => counts[r.status]++);
    return {
      month, rows: rowsB, total, actual,
      remaining: total - actual,
      pct: total > 0 ? (actual / total) * 100 : 0,
      monthTotal,
      unbudgeted,
      unbudgetedTotal: monthTotal - actual,
      counts,
    };
  },
  monthOptions(budgets) {
    const cur = stats.periodKey(0), set = new Set();
    for (let i = -6; i <= 3; i++) set.add(this.shiftMonth(cur, i));
    budgets.forEach((b) => set.add(b.month));
    return [...set].sort().reverse().map((key) => ({ key, label: this.monthLabel(key), current: key === cur }));
  },
};

/** دوره‌های داشبورد */
const sum = (rows, type) => rows.filter((x) => x.type === type).reduce((n, x) => n + x.amount, 0);
const within = (rows, p) => rows.filter((x) => x.date >= p.from && x.date <= p.to);

export const dashboardCalc = {
  period(mode = 'month', today = J.todayISO()) {
    const j = J.fromISO(today);
    let from, prev;
    if (mode === 'week') {
      const day = new Date(today + 'T00:00:00Z').getUTCDay();
      from = J.addDaysISO(today, -((day + 1) % 7));
      prev = { from: J.addDaysISO(from, -7), to: J.addDaysISO(today, -7) };
    } else {
      from = J.toISO(j.jy, mode === 'year' ? 1 : j.jm, 1);
      const py = mode === 'year' || j.jm === 1 ? j.jy - 1 : j.jy;
      const pm = mode === 'year' ? j.jm : j.jm === 1 ? 12 : j.jm - 1;
      prev = {
        from: J.toISO(py, mode === 'year' ? 1 : pm, 1),
        to: J.toISO(py, pm, Math.min(j.jd, J.monthLength(py, pm))),
      };
    }
    const buckets = [];
    if (mode === 'year') {
      for (let m = 1; m <= j.jm; m++) buckets.push({
        from: J.toISO(j.jy, m, 1),
        to: m === j.jm ? today : J.toISO(j.jy, m, J.monthLength(j.jy, m)),
        label: J.monthNames[m - 1],
      });
    } else {
      for (let d = from; d <= today; d = J.addDaysISO(d, 1)) buckets.push({ from: d, to: d, label: fmt.dateInput(d).slice(5) });
    }
    return { mode, from, to: today, prev, buckets };
  },
  summary(rows, p) {
    const selected = within(rows, p), previous = within(rows, p.prev);
    const totals = (list) => {
      const income = sum(list, 'income'), expense = sum(list, 'expense');
      return { income, expense, net: income - expense };
    };
    return {
      rows: selected,
      totals: totals(selected),
      previous: totals(previous),
      series: p.buckets.map((b) => ({ ...b, ...totals(within(selected, b)) })),
    };
  },
  goal(rows, target, today = J.todayISO()) {
    const p = dashboardCalc.period('year', today);
    const net = dashboardCalc.summary(rows, p).totals.net;
    return {
      year: J.fromISO(today).jy, net, target,
      percent: target > 0 ? (Math.max(0, net) / target) * 100 : null,
      bar: target > 0 ? (Math.min(100, Math.max(0, net) / target) * 100) : 0,
    };
  },
};

/** ابزارهای فرم و فهرست */
export const util = {
  parseJalali(text, emptyMsg = 'لطفاً تاریخ را وارد کنید.') {
    const t = fmt.toLatin(text).trim().replace(/[-.\s]/g, '/');
    if (!t) return { error: emptyMsg };
    const m = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!m) return { error: 'تاریخ را به شکل سال/ماه/روز وارد کنید؛ مثلاً ۱۴۰۵/۰۷/۲۶.' };
    const [jy, jm, jd] = [+m[1], +m[2], +m[3]];
    if (jy < 1370 || jy > 1430) return { error: 'سال واردشده معتبر نیست.' };
    if (jm < 1 || jm > 12) return { error: 'ماه باید عددی بین ۱ تا ۱۲ باشد.' };
    const len = J.monthLength(jy, jm);
    if (jd < 1 || jd > len) return { error: `${J.monthNames[jm - 1]} ${fmt.digits(jy)} ${fmt.digits(len)} روز دارد.` };
    return { iso: J.toISO(jy, jm, jd) };
  },
  parseAmount(v) {
    const n = fmt.toLatin(v).replace(/[^\d]/g, '');
    return n ? Number(n) : NaN;
  },
  norm: (s) => fmt.toLatin(String(s || '')).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(),
  /** متن با برجسته‌سازی عبارت جست‌وجو ← آرایه‌ای از قطعات برای رندر React */
  highlightParts(s, q) {
    const text = String(s ?? '');
    const query = String(q || '').trim();
    if (!query) return [{ text, mark: false }];
    const idx = util.norm(text).indexOf(util.norm(query));
    if (idx < 0) return [{ text, mark: false }];
    const len = query.length;
    return [
      { text: text.slice(0, idx), mark: false },
      { text: text.slice(idx, idx + len), mark: true },
      { text: text.slice(idx + len), mark: false },
    ].filter((p) => p.text !== '');
  },
  inRange(iso, range) {
    if (!range || range === 'all') return true;
    if (range.startsWith('m:')) return J.monthKey(iso) === range.slice(2);
    const diff = stats.monthDiff(iso);
    if (range === 'this') return diff === 0;
    if (range === 'last') return diff === 1;
    if (range === '3m') return diff >= 0 && diff < 3;
    if (range === '6m') return diff >= 0 && diff < 6;
    if (range === 'year') return J.fromISO(iso).jy === config.period.jy;
    return true;
  },
};
