/* پیش‌بینی پایه هزینه‌ها با میانگین متحرک وزنی */
import { jalali as J } from './jalali.js';
import { stats } from './calc.js';
import { defaultExpenseNames } from './categories.js';

const RULES = {
  window: 3,
  minMonths: 2,
  lookback: 6,
  nearPct: 0.8,
  increasePct: 0.15, increaseMin: 300000,
  steadyPct: 0.05,
  highCv: 0.25,
};
const pad = (n) => String(n).padStart(2, '0');
function shiftMonth(key, n) {
  let [y, m] = key.split('-').map(Number); m += n;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${pad(m)}`;
}
const weights = (k) => Array.from({ length: k }, (_, i) => i + 1);
function wma(values) {
  if (!values.length) return null;
  const w = weights(values.length), sw = w.reduce((a, b) => a + b, 0);
  return values.reduce((a, v, i) => a + w[i] * v, 0) / sw;
}
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
function cv(v) {
  const m = mean(v); if (!m || v.length < 2) return null;
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length) / m;
}
const isValidExpense = (x) => x && x.type === 'expense' && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) &&
  typeof x.amount === 'number' && Number.isFinite(x.amount) && x.amount > 0;

function aggregate(transactions, monthOf) {
  const byMonth = new Map(); let skipped = 0, used = 0;
  (transactions || []).forEach((x) => {
    if (!x || x.type !== 'expense') return;
    if (!isValidExpense(x)) { skipped++; return; }
    let key; try { key = monthOf(x.date); } catch (e) { key = null; }
    if (!key || !/^\d{4}-\d{2}$/.test(key)) { skipped++; return; }
    const cat = typeof x.category === 'string' && x.category ? x.category : 'سایر هزینه‌ها';
    const m = byMonth.get(key) || { total: 0, count: 0, cats: new Map() };
    m.total += x.amount; m.count++; m.cats.set(cat, (m.cats.get(cat) || 0) + x.amount);
    byMonth.set(key, m); used++;
  });
  return { byMonth, skipped, used };
}

function budgetStatus(f, limit) {
  if (!(limit > 0) || f === null) return null;
  if (f > limit) return 'over';
  if (f >= RULES.nearPct * limit) return 'near';
  return 'ok';
}

function compute(input) {
  const horizon = [1, 3, 6].includes(+input.horizon) ? +input.horizon : 1;
  const category = input.category && input.category !== 'all' ? input.category : 'all';
  const cur = input.currentKey, next = shiftMonth(cur, 1);
  const { byMonth, skipped, used } = aggregate(input.transactions, input.monthOf);
  const valOf = (m, cat) => (cat === 'all' ? m.total : m.cats.get(cat) || 0);

  const history = [];
  for (let i = RULES.lookback; i >= 1; i--) {
    const key = shiftMonth(cur, -i), m = byMonth.get(key);
    history.push({ key, valid: !!m, count: m ? m.count : 0, total: m ? m.total : 0, value: m ? valOf(m, category) : null });
  }
  const curM = byMonth.get(cur);
  const current = { key: cur, partial: true, count: curM ? curM.count : 0, total: curM ? curM.total : 0, value: curM ? valOf(curM, category) : 0 };
  const validMonths = history.filter((h) => h.valid);
  const baseline = validMonths.slice(-RULES.window).map((h, i, arr) => ({ ...h, weight: i + 1, of: arr.length }));
  const weightSum = baseline.reduce((a, b) => a + b.weight, 0);

  const catNames = [...new Set([...(input.categories || []), ...[...byMonth.values()].flatMap((m) => [...m.cats.keys()])])];
  const budgets = (input.budgets || []).filter((b) => b && b.limit > 0);
  const budgetFor = (c) => {
    const b = budgets.find((x) => x.category === c && x.month === next) || budgets.find((x) => x.category === c && x.month === cur);
    return b ? { limit: b.limit, month: b.month, title: b.title || c, source: b.month === next ? 'next' : 'current' } : null;
  };
  const enough = baseline.length >= RULES.minMonths;
  const categories = catNames.map((name) => {
    const series = baseline.map((h) => valOf(byMonth.get(h.key), name));
    const active = series.filter((v) => v > 0).length;
    const raw = enough ? wma(series) : null;
    const sufficient = enough && active >= RULES.minMonths;
    const histVals = validMonths.map((h) => valOf(byMonth.get(h.key), name));
    const avg = histVals.some((v) => v > 0) ? mean(histVals) : 0;
    const budget = budgetFor(name);
    const forecast = sufficient ? raw : null;
    const st = sufficient ? budgetStatus(forecast, budget && budget.limit) : null;
    const inc = sufficient && avg > 0 ? (forecast - avg) / avg : null;
    return {
      name, avg, forecast, raw: raw || 0, activeMonths: active, sufficient, budget,
      diff: forecast !== null && budget ? budget.limit - forecast : null,
      budgetStatus: st, change: inc,
      increase: inc !== null && inc >= RULES.increasePct && forecast - avg >= RULES.increaseMin,
      currentToDate: curM ? curM.cats.get(name) || 0 : 0,
      status: !sufficient ? 'insufficient' : st || 'nobudget',
    };
  }).filter((c) => c.raw > 0 || c.avg > 0 || c.budget || c.currentToDate > 0)
    .sort((a, b) => (b.forecast ?? -1) - (a.forecast ?? -1) || b.avg - a.avg);

  const sel = category === 'all' ? null : categories.find((c) => c.name === category) || { name: category, sufficient: false, activeMonths: 0, avg: 0, forecast: null, budget: budgetFor(category), status: 'insufficient', currentToDate: 0 };
  const baseVals = baseline.map((h) => h.value);
  let ok = enough, reason = null;
  if (!used) { ok = false; reason = 'none'; }
  else if (!enough) { ok = false; reason = 'months'; }
  else if (sel && !sel.sufficient) { ok = false; reason = 'category'; }
  else if (baseVals.every((v) => v === 0)) { ok = false; reason = 'zero'; }
  const forecast = ok ? wma(baseVals) : null;
  const histVals = validMonths.map((h) => h.value);
  const historicalAvg = histVals.length ? mean(histVals) : null;
  const last = baseline.length ? baseline[baseline.length - 1] : null;
  const change = ok && last && last.value > 0 ? { abs: forecast - last.value, pct: (forecast - last.value) / last.value, vsKey: last.key } :
    ok && last ? { abs: forecast - last.value, pct: null, vsKey: last.key } : null;
  const variation = cv(baseVals);

  const scope = sel ? [sel] : categories;
  const budgeted = scope.filter((c) => c.budget);
  const budgetTotals = {
    count: budgeted.length,
    limits: budgeted.reduce((a, c) => a + c.budget.limit, 0),
    forecastBudgeted: ok ? budgeted.reduce((a, c) => a + (sel ? forecast : c.raw), 0) : null,
    forecastUnbudgeted: ok && !sel ? categories.filter((c) => !c.budget).reduce((a, c) => a + c.raw, 0) : null,
  };

  return {
    ok, reason, category, horizon, currentKey: cur, nextKey: next, rules: RULES,
    history, current, baseline, weightSum, forecast,
    horizonMonths: Array.from({ length: horizon }, (_, i) => ({ key: shiftMonth(cur, i + 1), value: forecast })),
    horizonTotal: ok ? forecast * horizon : null,
    range: ok ? { low: Math.min(...baseVals), high: Math.max(...baseVals) } : null,
    historicalAvg, avgMonths: validMonths.length, validCount: validMonths.length,
    missing: history.filter((h) => !h.valid).map((h) => h.key),
    last, change, variation, highVariation: variation !== null && variation > RULES.highCv,
    reliability: !ok ? 'none' : baseline.length >= RULES.window ? 'standard' : 'limited',
    categories, selected: sel, budgetTotals, skipped, used,
    insufficientCats: categories.filter((c) => !c.sufficient),
  };
}

/** محاسبه از تراکنش‌ها و بودجه‌های واقعی */
function fromData(transactions, budgets, opts = {}) {
  return compute({
    transactions: transactions.filter((x) => x.type === 'expense'),
    monthOf: (iso) => J.monthKey(iso),
    currentKey: stats.periodKey(0),
    horizon: opts.horizon || 1,
    category: opts.category || 'all',
    budgets,
    categories: opts.categories || defaultExpenseNames,
  });
}

export const forecast = { RULES, compute, wma, weights, mean, cv, shiftMonth, aggregate, budgetStatus, fromData };
