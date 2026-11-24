import { jalali as J } from './jalali.js';
import { stats, budgetCalc } from './calc.js';
import { fmt } from './format.js';

const WEIGHTS = { savings: 35, budget: 30, ratio: 25, consistency: 10 };
const MIN_WEIGHT = 50;
const RULES = {
  savingsGood: 0.20, savingsFull: 0.30, savingsGoodShare: 0.8,
  ratioFull: 0.50, ratioZero: 1.00,
  cvFull: 0.10, cvZero: 0.40, minMonths: 3, minActiveMonths: 2,
};
const BANDS = [
  { min: 80, key: 'excellent', label: 'عالی' },
  { min: 60, key: 'good', label: 'خوب' },
  { min: 40, key: 'fair', label: 'متوسط' },
  { min: 0, key: 'poor', label: 'نیازمند بهبود' },
];
const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const num = (x) => (Number.isFinite(+x) && +x > 0 ? +x : 0);
const round1 = (x) => Math.round(x * 10) / 10;

function savingsShare(s) {
  if (!Number.isFinite(s) || s <= 0) return 0;
  const { savingsGood: g, savingsFull: f, savingsGoodShare: k } = RULES;
  if (s < g) return (s / g) * k;
  if (s < f) return k + ((s - g) / (f - g)) * (1 - k);
  return 1;
}
function ratioShare(r) {
  if (!Number.isFinite(r)) return 0;
  const { ratioFull: a, ratioZero: z } = RULES;
  return clamp01((z - r) / (z - a));
}
function budgetItemShare(spent, limit) {
  if (!(limit > 0)) return null;
  if (spent <= limit) return 1;
  return clamp01(1 - (spent - limit) / limit);
}
function cvShare(cv) {
  if (!Number.isFinite(cv)) return 0;
  const { cvFull: a, cvZero: z } = RULES;
  return clamp01((z - cv) / (z - a));
}
function band(score) { return BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1]; }

function compute(input) {
  const months = (input && Array.isArray(input.months) ? input.months : []).map((m) => ({
    ...m, income: num(m.income), expense: num(m.expense), incomeCount: m.incomeCount | 0, expenseCount: m.expenseCount | 0,
  }));
  const budgets = (input && Array.isArray(input.budgets) ? input.budgets : []).filter((b) => num(b.limit) > 0)
    .map((b) => ({ ...b, limit: num(b.limit), spent: num(b.spent) }));

  const income = months.reduce((a, m) => a + m.income, 0);
  const expense = months.reduce((a, m) => a + m.expense, 0);
  const net = income - expense;
  const hasIncome = income > 0;
  const savingsRate = hasIncome ? net / income : null;
  const ratio = hasIncome ? expense / income : null;
  const activeMonths = months.filter((m) => m.incomeCount + m.expenseCount > 0);
  const emptyMonths = months.filter((m) => m.incomeCount + m.expenseCount === 0);
  const comps = {};

  comps.savings = hasIncome
    ? { available: true, share: savingsShare(savingsRate), metrics: { income, expense, net, savingsRate } }
    : { available: false, share: 0, reason: expense > 0 ? 'در این دوره درآمدی ثبت نشده است؛ نرخ پس‌انداز بدون درآمد قابل محاسبه نیست.' : 'در این دوره درآمدی ثبت نشده است.', metrics: { income, expense, net } };

  if (budgets.length) {
    let wSum = 0, sSum = 0; const over = [], near = [];
    budgets.forEach((b) => {
      const s = budgetItemShare(b.spent, b.limit); wSum += b.limit; sSum += s * b.limit;
      if (b.spent > b.limit) over.push(b); else if (b.spent / b.limit >= 0.8) near.push(b);
    });
    const limitTotal = budgets.reduce((a, b) => a + b.limit, 0), spentTotal = budgets.reduce((a, b) => a + b.spent, 0);
    const budgetedMonths = new Set(budgets.map((b) => b.month)).size;
    comps.budget = { available: true, share: wSum ? sSum / wSum : 0, metrics: { count: budgets.length, over, near, limitTotal, spentTotal, budgetedMonths, months: months.length } };
  } else comps.budget = { available: false, share: 0, reason: 'برای ماه‌های این دوره هیچ بودجه‌ای تعریف نشده است؛ امتیاز کامل فرض نمی‌شود.', metrics: { count: 0 } };

  comps.ratio = hasIncome
    ? { available: true, share: ratioShare(ratio), metrics: { income, expense, ratio } }
    : { available: false, share: 0, reason: 'درآمد این دوره صفر است؛ تقسیم بر صفر انجام نمی‌شود.', metrics: { income, expense } };

  if (months.length < RULES.minMonths) {
    comps.consistency = { available: false, share: 0, reason: `ارزیابی ثبات به دست‌کم ${fmt.digits(RULES.minMonths)} ماه نیاز دارد؛ بازه سه یا شش ماهه را انتخاب کنید.`, metrics: { months: months.length, active: activeMonths.length } };
  } else if (activeMonths.length < RULES.minActiveMonths) {
    comps.consistency = { available: false, share: 0, reason: 'در این دوره کمتر از دو ماه تراکنش ثبت شده است.', metrics: { months: months.length, active: activeMonths.length } };
  } else {
    const covered = months.filter((m) => m.incomeCount > 0 && m.expenseCount > 0);
    const coverage = covered.length / months.length;
    const positive = activeMonths.filter((m) => m.income - m.expense >= 0).length / activeMonths.length;
    const exps = activeMonths.map((m) => m.expense), mean = exps.reduce((a, b) => a + b, 0) / exps.length;
    const cv = mean > 0 ? Math.sqrt(exps.reduce((a, b) => a + (b - mean) ** 2, 0) / exps.length) / mean : null;
    const stab = cv === null ? 0 : cvShare(cv);
    comps.consistency = {
      available: true, share: 0.4 * coverage + 0.3 * positive + 0.3 * stab,
      metrics: { months: months.length, active: activeMonths.length, covered: covered.length, coverage, positive, cv, parts: { coverage: 4 * coverage, positive: 3 * positive, stability: 3 * stab } },
    };
  }

  Object.entries(comps).forEach(([k, c]) => { c.key = k; c.weight = WEIGHTS[k]; c.points = c.available ? round1(c.share * c.weight) : 0; });
  const avail = Object.values(comps).filter((c) => c.available);
  const availableWeight = avail.reduce((a, c) => a + c.weight, 0);
  const earned = avail.reduce((a, c) => a + c.share * c.weight, 0);
  const sufficient = availableWeight >= MIN_WEIGHT && activeMonths.length > 0;
  const score = sufficient ? Math.round((earned / availableWeight) * 100) : null;
  return {
    score, band: score === null ? null : band(score), sufficient,
    sufficiency: !sufficient ? 'insufficient' : availableWeight === 100 ? 'full' : 'partial',
    availableWeight, earned: round1(earned), components: comps,
    totals: { income, expense, net, savingsRate, ratio },
    months, emptyMonths, activeMonths: activeMonths.length,
  };
}

/** جمع‌آوری ورودی از تراکنش‌ها و بودجه‌ها برای دوره: 'this' | '3m' | '6m' */
function inputFor(transactions, budgets, period, offset = 0) {
  const n = period === '6m' ? 6 : period === '3m' ? 3 : 1;
  const keys = stats.lastMonths(n + offset).slice(0, n);
  const byKey = new Map(keys.map((m) => [m.key, { key: m.key, label: m.label, jy: m.jy, jm: m.jm, income: 0, expense: 0, incomeCount: 0, expenseCount: 0 }]));
  transactions.forEach((x) => {
    if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !(x.amount > 0)) return;
    const m = byKey.get(J.monthKey(x.date)); if (!m) return;
    if (x.type === 'income') { m.income += x.amount; m.incomeCount++; }
    else if (x.type === 'expense') { m.expense += x.amount; m.expenseCount++; }
  });
  const list = keys.flatMap((m) => budgetCalc.forMonth(transactions, budgets, m.key));
  return { period, months: [...byKey.values()], budgets: list };
}

export const health = {
  WEIGHTS, RULES, BANDS, MIN_WEIGHT, compute, inputFor,
  savingsShare, ratioShare, budgetItemShare, cvShare, band,
  forPeriod: (transactions, budgets, period) => ({ period, ...compute(inputFor(transactions, budgets, period)) }),
};
