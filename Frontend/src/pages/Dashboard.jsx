import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ChartCanvas from '../components/ChartCanvas.jsx';
import ProphetDashboardBadge from '../components/ProphetDashboardBadge.jsx';
import { Count } from '../components/common.jsx';
import QuickTransactionModal from '../components/QuickTransactionModal.jsx';
import TransactionModal from '../components/TransactionModal.jsx';
import { useData } from '../context/DataContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { budgetCalc, dashboardCalc, stats } from '../lib/calc.js';
import { catMeta } from '../lib/categories.js';
import { fmt } from '../lib/format.js';
import { forecast as FC } from '../lib/forecast.js';
import { health as H } from '../lib/health.js';
import { jalali as J } from '../lib/jalali.js';
import { chartGridY, chartSurface, chartTip, faDec } from '../lib/chart.js';

const dec = (n, d = 1) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: d }).format(n);
const PERIOD_NAMES = { week: 'هفته جاری', month: 'ماه جاری', year: 'سال جاری' };
const money = (n) => fmt.money(n);

/** نوار بودجه با انیمیشن پرشدن در نخستین نمایش */
function BudgetBar({ pctWidth, color, label, text }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(pctWidth), 200);
    return () => clearTimeout(t);
  }, [pctWidth]);
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(pctWidth)} aria-valuemin="0" aria-valuemax="100"
      aria-label={label} aria-valuetext={text}>
      <span style={{ width: `${Math.min(100, w)}%`, background: `linear-gradient(90deg,${color}cc,${color})` }} />
    </div>
  );
}

/** حلقه امتیاز سلامت با انیمیشن */
function HealthRing({ score, bandLabel }) {
  const [offset, setOffset] = useState(314.16);
  useEffect(() => {
    const t = setTimeout(() => setOffset(314.16 * (1 - (score || 0) / 100)), 120);
    return () => clearTimeout(t);
  }, [score]);
  return (
    <div className="ring">
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="50" className="ring-bg" />
        <circle cx="60" cy="60" r="50" className="ring-fg" style={{ strokeDashoffset: offset }} />
      </svg>
      <div className="ring-txt">
        <b>{score === null ? '؟' : fmt.digits(score)}</b>
        <span>{score === null ? 'داده ناکافی' : bandLabel}</span>
      </div>
    </div>
  );
}

function Spark({ color, data }) {
  const chartData = useMemo(() => ({
    labels: data.map((_, i) => i),
    datasets: [{
      data, borderColor: color, borderWidth: 2, tension: 0.45, pointRadius: 0, fill: true,
      backgroundColor: `${color}1f`,
    }],
  }), [data, color]);
  const options = useMemo(() => ({
    responsive: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: { x: { display: false, reverse: true }, y: { display: false } },
    animation: { duration: 1200 },
  }), []);
  return <ChartCanvas type="line" data={chartData} options={options} className="spark" />;
}

function ChangeChip({ cur, prev, goodWhenUp }) {
  if (!prev) {
    return <span className="chg" aria-label="دوره قبل مقدار پایه ندارد">مبنای مقایسه ندارد</span>;
  }
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  const up = p >= 0;
  const good = up === goodWhenUp;
  return (
    <span className={`chg ${good ? 'up' : 'down-bad'}`}
      aria-label={`${up ? 'افزایش' : 'کاهش'} ${fmt.percent(p)} نسبت به دوره مشابه قبل`}>
      <Icon name={up ? 'arrow-up-right' : 'arrow-down-left'} />{fmt.percent(p)}
    </span>
  );
}

export default function Dashboard() {
  const { transactions, budgets, displayName, removeTransaction } = useData();
  const { confirm, toast } = useUI();

  const [selectedPeriod, setSelectedPeriod] = useState('month');
  const [filter, setFilter] = useState('all');
  const [quick, setQuick] = useState(null); // { record } | null
  const [full, setFull] = useState(null); // { kind, record } | null

  const months = useMemo(() => stats.lastMonths(6), []);
  const labels = useMemo(() => months.map((m) => m.label), [months]);
  const curKey = months[5].key;
  const periodName = PERIOD_NAMES[selectedPeriod];

  const activePeriod = useMemo(() => dashboardCalc.period(selectedPeriod), [selectedPeriod]);
  const summary = useMemo(() => dashboardCalc.summary(transactions, activePeriod), [transactions, activePeriod]);

  const incomeSeries = useMemo(() => months.map((m) => stats.incomeByMonth(transactions, m.key)), [transactions, months]);
  const expenseSeries = useMemo(() => months.map((m) => stats.expenseByMonth(transactions, m.key)), [transactions, months]);

  const catData = useMemo(
    () => stats.expenseByCategory(summary.rows.filter((x) => x.type === 'expense')),
    [summary.rows],
  );

  const budgetRows = useMemo(
    () => budgetCalc.forMonth(transactions, budgets, curKey).sort((a, b) => b.pct - a.pct),
    [transactions, budgets, curKey],
  );

  const healthResult = useMemo(() => {
    const r = H.forPeriod(transactions, budgets, 'this');
    const prev = H.compute(H.inputFor(transactions, budgets, 'this', 1));
    return { r, prev };
  }, [transactions, budgets]);

  const fc = useMemo(() => FC.fromData(transactions, budgets, { horizon: 1 }), [transactions, budgets]);

  /* ---------- متن‌های محاسبه‌شده ---------- */
  const rangeText = `${fmt.date(activePeriod.from)} تا ${fmt.date(activePeriod.to)}`;

  const budgetSub = useMemo(() => {
    const [cy, cm] = curKey.split('-').map(Number);
    const today = J.fromISO(J.todayISO());
    const left = today.jy === cy && today.jm === cm ? J.monthLength(cy, cm) - today.jd : null;
    return `${J.monthNames[cm - 1]}ماه ${fmt.digits(cy)}`
      + (left === null ? '' : left > 0 ? ` ـ ${fmt.digits(left)} روز تا پایان ماه` : ' ـ آخرین روز ماه');
  }, [curKey]);

  const nextLabel = J.monthNames[+FC.shiftMonth(stats.periodKey(0), 1).split('-')[1] - 1];
  const avgExpense = expenseSeries.length ? expenseSeries.reduce((a, b) => a + b, 0) / expenseSeries.length : 0;
  const fNext = fc.ok ? fc.forecast / 1e6 : null;
  const iMax = expenseSeries.indexOf(Math.max(...expenseSeries));
  const iMin = expenseSeries.indexOf(Math.min(...expenseSeries));

  /* ---------- تحلیل‌های بازه ---------- */
  const insightTexts = useMemo(() => {
    const items = [];
    if (catData.rows.length) {
      items.push(`بیشترین هزینه ${periodName} مربوط به «${catData.rows[0].name}» با مبلغ ${money(catData.rows[0].amount)} تومان است.`);
    }
    if (summary.rows.length) {
      items.push(`خالص پس‌انداز ${periodName}: ${money(summary.totals.net)} تومان؛ برابر درآمد منهای هزینه‌های ثبت‌شده.`);
    }
    if (summary.previous.expense > 0) {
      const delta = summary.totals.expense - summary.previous.expense;
      items.push(`هزینه نسبت به دوره مشابه قبل ${fmt.percent(Math.abs(delta) / summary.previous.expense * 100)} ${delta > 0 ? 'بیشتر' : delta < 0 ? 'کمتر' : 'بدون تغییر'} است.`);
    }
    return items.length ? items : ['در این بازه تراکنشی برای تحلیل ثبت نشده است.'];
  }, [catData.rows, summary, periodName]);

  /* ---------- هشدارها ---------- */
  const alerts = useMemo(() => {
    const list = [];
    budgetRows.filter((b) => b.status !== 'ok').forEach((b) => {
      if (b.status === 'over') {
        list.push({ icon: 'alert-octagon', strong: 'عبور از سقف بودجه', text: `هزینه‌های بخش ${b.title} از سقف بودجه این ماه بیشتر شده است.` });
      } else if (b.status === 'full') {
        list.push({ icon: 'alert-octagon', strong: 'بودجه تکمیل شده', text: `کل بودجه ${b.title} در این ماه مصرف شده است.` });
      } else {
        list.push({ icon: 'alert-octagon', strong: 'نزدیک شدن به سقف بودجه', text: `شما به سقف بودجه ${b.title} نزدیک شده‌اید.` });
      }
    });
    const prevAvg = expenseSeries.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    if (prevAvg && expenseSeries[5] > prevAvg) {
      list.push({ icon: 'trending-up', tone: 'amber', strong: 'افزایش روند هزینه', text: 'روند هزینه‌های شما در حال افزایش است.' });
    }
    const sav = incomeSeries[5] - expenseSeries[5];
    if (incomeSeries[5] > 0 && sav / incomeSeries[5] < 0.2) {
      list.push({ icon: 'piggy-bank', tone: 'blue', strong: 'پس‌انداز کمتر از حد مطلوب', text: 'میزان پس‌انداز کمتر از حد پیشنهادی (۲۰ درصد درآمد) است.' });
    }
    return list;
  }, [budgetRows, expenseSeries, incomeSeries]);

  /* ---------- آخرین تراکنش‌ها ---------- */
  const txRows = useMemo(() => {
    return summary.rows
      .filter((x) => filter === 'all' || x.type === filter)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date)
        || (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
        || b.id.localeCompare(a.id))
      .slice(0, 8);
  }, [summary.rows, filter]);

  const handleEdit = (rec) => {
    if (rec.type === 'income') setFull({ kind: 'income', record: rec });
    else setQuick({ record: rec });
  };

  const handleDelete = async (rec) => {
    const inc = rec.type === 'income';
    const ok = await confirm({
      title: inc ? 'حذف درآمد' : 'حذف هزینه',
      message: inc
        ? 'آیا از حذف این درآمد مطمئن هستید؟ این عملیات قابل بازگشت نیست.'
        : 'آیا از حذف این هزینه مطمئن هستید؟ این عملیات قابل بازگشت نیست.',
      confirmText: inc ? 'حذف درآمد' : 'حذف هزینه',
    });
    if (!ok) return;
    try {
      await removeTransaction(rec.id);
      toast(inc ? 'درآمد با موفقیت حذف شد.' : 'هزینه با موفقیت حذف شد.');
    } catch (e) {
      toast(e.message || 'حذف تراکنش انجام نشد.', 'error');
    }
  };

  /* ---------- نمودار میله‌ای ---------- */
  const barData = useMemo(() => ({
    labels: summary.series.map((b) => b.label),
    datasets: [
      {
        label: 'درآمد', data: summary.series.map((b) => b.income / 1e6), backgroundColor: '#2563eb',
        borderRadius: 8, barPercentage: 0.7, categoryPercentage: 0.62,
      },
      {
        label: 'هزینه', data: summary.series.map((b) => b.expense / 1e6), backgroundColor: '#10b981',
        borderRadius: 8, barPercentage: 0.7, categoryPercentage: 0.62,
      },
    ],
  }), [summary.series]);

  const barOptions = useMemo(() => ({
    maintainAspectRatio: false,
    animation: { duration: 1200, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: false },
      tooltip: { ...chartTip, callbacks: { label: (c) => ` ${c.dataset.label}: ${faDec(c.raw, 2)} میلیون تومان` } },
    },
    scales: {
      x: { reverse: true, grid: { display: false }, border: { display: false } },
      y: { position: 'right', beginAtZero: true, grid: chartGridY, border: { display: false }, ticks: { padding: 10, callback: (v) => fmt.digits(v) } },
    },
  }), []);

  /* ---------- نمودار دونات ---------- */
  const pieData = useMemo(() => ({
    labels: catData.rows.map((c) => c.name),
    datasets: [{
      data: catData.rows.map((c) => c.amount / 1e6),
      backgroundColor: catData.rows.map((c) => catMeta('expense', c.name).color),
      borderWidth: 3, borderColor: () => chartSurface(), hoverOffset: 8, borderRadius: 4,
    }],
  }), [catData.rows]);

  const pieOptions = useMemo(() => ({
    maintainAspectRatio: false,
    cutout: '70%',
    animation: { animateRotate: true, duration: 1400 },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartTip,
        callbacks: {
          label: (c) => {
            const total = c.dataset.data.reduce((a, b) => a + b, 0) || 1;
            return ` ${c.label}: ${faDec(c.raw, 2)} میلیون تومان (${fmt.digits(Math.round(c.raw / total * 100))}٪)`;
          },
        },
      },
    },
  }), []);

  /* ---------- نمودار خطی ---------- */
  const lineData = useMemo(() => ({
    labels: [...labels, nextLabel],
    datasets: [
      {
        label: 'هزینه واقعی', data: [...expenseSeries.map((v) => v / 1e6), null],
        borderColor: '#2563eb', fill: true, tension: 0.4, borderWidth: 3, pointRadius: 5, pointHoverRadius: 7,
        pointBackgroundColor: () => chartSurface(), pointBorderWidth: 3,
        backgroundColor: (context) => {
          const { ctx, chartArea } = context.chart;
          if (!chartArea) return 'rgba(37,99,235,.12)';
          const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(37,99,235,.22)');
          gradient.addColorStop(1, 'rgba(37,99,235,0)');
          return gradient;
        },
      },
      {
        label: 'پیش‌بینی', data: [null, null, null, null, null, fNext === null ? null : expenseSeries[5] / 1e6, fNext],
        borderColor: '#10b981', borderDash: [6, 6], borderWidth: 3, tension: 0.4,
        pointRadius: [0, 0, 0, 0, 0, 0, 6], pointBackgroundColor: '#10b981', pointBorderColor: () => chartSurface(),
        pointBorderWidth: 3, fill: false,
      },
      {
        label: 'میانگین', data: Array(7).fill(avgExpense / 1e6),
        borderColor: '#cbd5e1', borderWidth: 1.5, borderDash: [3, 4], pointRadius: 0, fill: false,
      },
    ],
  }), [labels, nextLabel, expenseSeries, fNext, avgExpense]);

  const lineOptions = useMemo(() => ({
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 1400 },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartTip,
        filter: (i) => i.raw !== null,
        callbacks: { label: (c) => ` ${c.dataset.label}: ${faDec(c.raw, 2)} میلیون تومان` },
      },
    },
    scales: {
      x: { reverse: true, grid: { display: false }, border: { display: false } },
      y: { position: 'right', suggestedMin: 24, grid: chartGridY, border: { display: false }, ticks: { padding: 10, callback: (v) => fmt.digits(v) } },
    },
  }), []);

  const score = healthResult.r.score;
  const band = healthResult.r.band;
  const prevScore = healthResult.prev.score;
  const scoreDelta = score !== null && prevScore !== null ? score - prevScore : 0;
  const showScoreChg = score !== null && prevScore !== null && score !== prevScore;

  const kpis = [
    { key: 'income', suffix: 'Income', title: 'درآمد', icon: 'trending-up', cls: 'blue', spark: 'income', color: '#2563eb' },
    { key: 'expense', suffix: 'Expense', title: 'هزینه', icon: 'credit-card', cls: 'red', spark: 'expense', color: '#ef4444' },
    { key: 'net', suffix: 'Saving', title: 'پس‌انداز', icon: 'piggy-bank', cls: 'green', spark: 'net', color: '#10b981' },
  ];

  return (
    <div className="app-view" id="view-dashboard">
      <div className="page-head">
        <div>
          <h1 tabIndex="-1">داشبورد مالی</h1>
          <p>
            <span id="dashGreet">سلام {displayName || 'کاربر Finova'}</span>،{' '}
            <span id="dashPeriodText">خلاصه {periodName}، {rangeText} (تا امروز).</span>
          </p>
          <p className="preview-notice">اطلاعات این نسخه به‌صورت امن در حساب کاربری شما ذخیره می‌شود.</p>
        </div>
        <div className="head-actions">
          <div className="seg">
            {['week', 'month', 'year'].map((p) => (
              <button key={p} type="button" data-period={p} className={selectedPeriod === p ? 'on' : ''}
                aria-pressed={selectedPeriod === p}
                onClick={() => setSelectedPeriod(p)}>
                {p === 'week' ? 'هفتگی' : p === 'month' ? 'ماهانه' : 'سالانه'}
              </button>
            ))}
          </div>
          <Link className="btn ghost" to="/reports"><Icon name="download" />خروجی گزارش</Link>
          <button className="btn primary" id="addBtn" type="button" onClick={() => setQuick({ record: null })}>
            <Icon name="plus" />ثبت تراکنش
          </button>
        </div>
      </div>

      <div className="kpis">
        {kpis.map((k) => (
          <article className="kpi card" key={k.key}>
            <div className="kpi-top">
              <span className={`kpi-ic ${k.cls}`}><Icon name={k.icon} /></span>
              <ChangeChip cur={summary.totals[k.key]} prev={summary.previous[k.key]} goodWhenUp={k.key !== 'expense'} />
            </div>
            <span className="kpi-label">{k.title} {periodName}</span>
            <div className="kpi-val"><Count value={summary.totals[k.key]} /><small>تومان</small></div>
            <div className="kpi-foot">
              <span className="prev-label">نسبت به دوره مشابه قبل</span>
              <Spark color={k.color} data={summary.series.map((b) => b[k.spark] / 1e6)} />
            </div>
          </article>
        ))}

        <article className="kpi card health">
          <div className="health-row">
            <div>
              <div className="kpi-top">
                <span className="kpi-ic teal"><Icon name="heart-pulse" /></span>
                {showScoreChg && (
                  <span className={`chg ${scoreDelta > 0 ? 'up' : 'down-bad'}`}
                    aria-label={`${scoreDelta > 0 ? 'افزایش' : 'کاهش'} ${fmt.digits(Math.abs(scoreDelta))} امتیاز نسبت به ماه قبل`}>
                    <Icon name={scoreDelta > 0 ? 'arrow-up-right' : 'arrow-down-left'} />
                    {fmt.digits(Math.abs(scoreDelta))} امتیاز
                  </span>
                )}
              </div>
              <span className="kpi-label">امتیاز سلامت مالی ماه جاری</span>
              <div className="kpi-val">
                <Count value={score ?? 0} na={score === null} format={fmt.digits} />
                <small id="hsDashOf">{score === null ? '' : 'از ۱۰۰'}</small>
              </div>
              <Link className="grade" id="hsDashGrade" to="/financial-health">
                {score === null ? 'اطلاعات کافی نیست' : `وضعیت: ${band.label}`}
              </Link>
            </div>
            <HealthRing score={score} bandLabel={band?.label} />
          </div>
        </article>
      </div>

      <div className="grid g-2-1">
        <article className="card chart-card">
          <div className="card-head">
            <div>
              <h2>مقایسه درآمد و هزینه</h2>
              <p>{rangeText} (میلیون تومان)</p>
            </div>
            <div className="legend">
              <span><i style={{ background: '#2563eb' }} />درآمد</span>
              <span><i style={{ background: '#10b981' }} />هزینه</span>
            </div>
          </div>
          <div className="chart-box h300"><ChartCanvas type="bar" data={barData} options={barOptions} ariaLabel="نمودار مقایسه درآمد و هزینه" /></div>
        </article>

        <article className="card chart-card">
          <div className="card-head">
            <div>
              <h2>توزیع هزینه‌ها بر اساس دسته‌بندی</h2>
              <p>{rangeText} ـ <Link className="inline-link" to="/expenses">مدیریت هزینه‌ها</Link></p>
            </div>
          </div>
          <div className="donut-wrap">
            <div className="chart-box donut">
              <ChartCanvas type="doughnut" data={pieData} options={pieOptions} ariaLabel="نمودار توزیع هزینه‌ها بر اساس دسته‌بندی" />
              <div className="donut-center"><span>مجموع هزینه</span><b>{dec(catData.total / 1e6, 2)}</b><small>میلیون تومان</small></div>
            </div>
            <ul className="cat-list">
              {catData.rows.length
                ? catData.rows.map((c) => (
                  <li key={c.name}>
                    <i style={{ background: catMeta('expense', c.name).color }} />
                    {c.name}
                    <b>{fmt.digits(Math.round(c.share * 100))}٪</b>
                  </li>
                ))
                : <li className="muted">هزینه‌ای در این بازه ثبت نشده است.</li>}
            </ul>
          </div>
        </article>
      </div>

      <div className="grid g-2-1">
        <article className="card chart-card grow">
          <div className="card-head">
            <div>
              <h2>روند هزینه‌ها در شش ماه گذشته</h2>
              <p>روند تاریخی و خط پایه WMA؛ مقدار Prophet در کارت پیش‌بینی نمایش داده می‌شود (میلیون تومان)</p>
            </div>
            <div className="legend dash">
              <span><i className="ln" style={{ borderColor: '#2563eb' }} />هزینه واقعی</span>
              <span><i className="ln d" style={{ borderColor: '#10b981' }} />پیش‌بینی</span>
              <span><i className="ln d" style={{ borderColor: '#cbd5e1' }} />میانگین</span>
            </div>
            <ProphetDashboardBadge />
          </div>
          <div className="chart-box"><ChartCanvas type="line" data={lineData} options={lineOptions} ariaLabel="نمودار روند هزینه‌ها و پیش‌بینی" /></div>
          <div className="trend-stats">
            <div><span>میانگین ماهانه</span><b>{dec(avgExpense / 1e6, 2)} میلیون</b></div>
            <div><span>بیشترین هزینه</span><b>{labels[iMax]} ـ {dec(expenseSeries[iMax] / 1e6, 2)} میلیون</b></div>
            <div><span>کمترین هزینه</span><b>{labels[iMin]} ـ {dec(expenseSeries[iMin] / 1e6, 2)} میلیون</b></div>
            <div><span>مبنای پیش‌بینی</span><b className="g">{fc.ok ? `${fmt.digits(fc.baseline.length)} ماه کامل اخیر` : 'داده ناکافی'}</b></div>
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <div>
              <h2>وضعیت بودجه‌ها</h2>
              <p>{budgetSub}</p>
            </div>
            <Link className="link-btn" to="/budgets">مدیریت<Icon name="chevron-left" /></Link>
          </div>
          <div className="budgets">
            {!budgetRows.length ? (
              <div className="bud-empty">
                <p>برای این ماه بودجه‌ای تعریف نشده است.</p>
                <Link className="btn ghost" to="/budgets"><Icon name="plus" />ایجاد بودجه</Link>
              </div>
            ) : (
              <>
                {budgetRows.slice(0, 4).map((b) => {
                  const st = budgetCalc.STATUS[b.status];
                  const m = catMeta('expense', b.category);
                  const p = Math.round(b.pct);
                  const over = b.remaining < 0;
                  return (
                    <div className="bud" key={b.id}>
                      <div className="bud-top">
                        <span className="bud-ic" style={{ background: st.bg, color: st.color }}><Icon name={m.icon} /></span>
                        <strong>{b.title}</strong>
                        <span className="bud-pct" style={{ color: st.color }} title={st.label}>{fmt.digits(p)}٪</span>
                      </div>
                      <BudgetBar pctWidth={b.barPct} color={st.bar}
                        label={`مصرف بودجه ${b.title}`} text={`${fmt.digits(p)} درصد ـ ${st.label}`} />
                      <div className="bud-meta">
                        <div>سقف بودجه<b>{money(b.limit)}</b></div>
                        <div>مصرف‌شده<b>{money(b.spent)}</b></div>
                        <div>{over ? 'مازاد' : 'باقی‌مانده'}<b style={{ color: st.color }}>{money(Math.abs(b.remaining))}</b></div>
                      </div>
                    </div>
                  );
                })}
                {budgetRows.length > 4 && (
                  <Link className="link-btn bud-more" to="/budgets">
                    {fmt.digits(budgetRows.length - 4)} بودجه دیگر<Icon name="chevron-left" />
                  </Link>
                )}
              </>
            )}
          </div>
        </article>
      </div>

      <div className="grid g-2-1">
        <article className="card">
          <div className="card-head">
            <div>
              <h2>آخرین تراکنش‌ها</h2>
              <p>هشت تراکنش اخیر ثبت‌شده ـ <Link className="inline-link" to="/income">همه درآمدها</Link> ـ <Link className="inline-link" to="/expenses">همه هزینه‌ها</Link></p>
            </div>
            <div className="filters">
              {[['all', 'همه'], ['income', 'درآمد'], ['expense', 'هزینه']].map(([key, label]) => (
                <button key={key} type="button" className={`chip${filter === key ? ' on' : ''}`}
                  data-f={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="table-wrap">
            <table className="tx">
              <thead>
                <tr>
                  <th>تاریخ</th><th>دسته‌بندی</th><th>عنوان / توضیحات</th><th>مبلغ (تومان)</th><th>نوع تراکنش</th><th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {!txRows.length ? (
                  <tr><td colSpan={6} className="empty">تراکنشی برای نمایش وجود ندارد.</td></tr>
                ) : txRows.map((x) => {
                  const m = catMeta(x.type, x.category);
                  const inc = x.type === 'income';
                  return (
                    <tr key={x.id} data-id={x.id}>
                      <td className="date">{fmt.date(x.date)}</td>
                      <td>
                        <span className="cat">
                          <em style={{ background: m.bg, color: m.color }}><Icon name={m.icon} /></em>
                          {x.category}
                        </span>
                      </td>
                      <td className="desc">{x.title}</td>
                      <td className={`amt ${inc ? 'in' : 'out'}`}>{inc ? '+' : '−'}{money(x.amount)}</td>
                      <td>
                        <span className={`type ${inc ? 'in' : 'out'}`}>
                          <Icon name={inc ? 'arrow-down-left' : 'arrow-up-right'} />{inc ? 'درآمد' : 'هزینه'}
                        </span>
                      </td>
                      <td>
                        <div className="acts">
                          <button className="act edit" type="button" aria-label={`ویرایش ${x.title}`} onClick={() => handleEdit(x)}>
                            <Icon name="pencil" />ویرایش
                          </button>
                          <button className="act del" type="button" aria-label={`حذف ${x.title}`} onClick={() => handleDelete(x)}>
                            <Icon name="trash-2" />حذف
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>

        <div className="stack">
          <article className="card insights">
            <div className="card-head">
              <div>
                <h2><Icon name="brain-circuit" className="h-ic" />تحلیل هوشمند مالی</h2>
                <p>بر اساس الگوی هزینه‌های شما</p>
              </div>
            </div>
            <ul className="ins-list">
              {insightTexts.map((text, i) => (
                <li key={i}>
                  <span className="ins-ic info"><Icon name="info" /></span>
                  <p>{text}</p>
                </li>
              ))}
            </ul>
          </article>

          <article className="card alerts">
            <div className="card-head">
              <div>
                <h2><Icon name="shield-alert" className="h-ic r" />هشدارهای مالی</h2>
                <p>{alerts.length ? `${fmt.digits(alerts.length)} هشدار فعال` : 'بدون هشدار فعال'} ـ ماه جاری</p>
              </div>
            </div>
            <div>
              {alerts.length ? alerts.map((a, i) => (
                <div className={`al al-${a.tone || 'red'}`} key={`${a.strong}-${i}`}>
                  <Icon name={a.icon} />
                  <div><strong>{a.strong}</strong><p>{a.text}</p></div>
                </div>
              )) : (
                <div className="al al-blue">
                  <Icon name="check-circle-2" />
                  <div><strong>وضعیت مناسب</strong><p>در حال حاضر هشدار فعالی وجود ندارد.</p></div>
                </div>
              )}
            </div>
          </article>
        </div>
      </div>

      {quick && (
        <QuickTransactionModal
          record={quick.record}
          onClose={() => setQuick(null)}
          onSwitchToIncome={() => setFull({ kind: 'income', record: null })}
        />
      )}
      {full && (
        <TransactionModal
          kind={full.kind}
          record={full.record}
          onClose={() => setFull(null)}
        />
      )}
    </div>
  );
}
