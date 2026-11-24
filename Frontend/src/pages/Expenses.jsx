import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ChartCanvas from '../components/ChartCanvas.jsx';
import { Highlight, Pager } from '../components/common.jsx';
import TransactionModal from '../components/TransactionModal.jsx';
import { useData } from '../context/DataContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { config, stats, util } from '../lib/calc.js';
import { catMeta, expenseMethods } from '../lib/categories.js';
import { fmt } from '../lib/format.js';
import { jalali as J } from '../lib/jalali.js';
import { chartSurface, chartTip } from '../lib/chart.js';

const dec = (n, d = 2) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: d }).format(n);
const periodName = (key) => { const [y, m] = key.split('-'); return `${J.monthNames[+m - 1]} ${fmt.digits(y)}`; };

const RANGE_LABELS = {
  all: 'همه زمان‌ها', this: 'ماه جاری', last: 'ماه گذشته', '3m': 'سه ماه اخیر', '6m': 'شش ماه اخیر',
};

export default function Expenses() {
  const { transactions, categoriesFor, removeTransaction } = useData();
  const { toast, confirm } = useUI();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [method, setMethod] = useState('');
  const [range, setRange] = useState('all');
  const [sort, setSort] = useState('date-desc');
  const [page, setPage] = useState(1);
  const [chartRange, setChartRange] = useState('this');
  const [form, setForm] = useState(null);
  const listRef = useRef(null);

  const expenseNames = useMemo(() => categoriesFor('expense').map((c) => c.name), [categoriesFor]);
  const all = useMemo(() => transactions.filter((x) => x.type === 'expense'), [transactions]);

  /* ---------- URL params ---------- */
  useEffect(() => {
    const q = searchParams.get('q');
    const cat = searchParams.get('cat');
    const rng = searchParams.get('range');
    if (q !== null) { setSearch(q); setPage(1); }
    if (cat !== null || rng !== null) {
      if (cat !== null) setCategory(expenseNames.includes(cat) ? cat : '');
      if (rng !== null) setRange(rng);
      setPage(1);
    }
  }, [searchParams, expenseNames]);

  /* ---------- KPI ---------- */
  const kpi = useMemo(() => {
    const curKey = stats.periodKey(0);
    const prevKey = stats.periodKey(1);
    const month = all.filter((x) => J.monthKey(x.date) === curKey);
    const sum = (list) => list.reduce((s, x) => s + x.amount, 0);
    const total = sum(month);
    const prev = sum(all.filter((x) => J.monthKey(x.date) === prevKey));
    const max = all.length ? all.reduce((a, b) => (b.amount > a.amount ? b : a)) : null;
    const avg = all.length ? sum(all) / all.length : 0;
    const monthAvg = month.length ? total / month.length : 0;
    return {
      curKey, prevKey, total, prev, count: month.length, all: all.length, max, avg, monthAvg,
      change: prev ? ((total - prev) / prev) * 100 : null,
    };
  }, [all]);

  /* ---------- chart data ---------- */
  const chart = useMemo(
    () => stats.expenseByCategory(all.filter((x) => util.inRange(x.date, chartRange))),
    [all, chartRange],
  );
  const chartLabel = chartRange === 'this' ? periodName(stats.periodKey(0)) : chartRange === '3m' ? 'سه ماه اخیر' : 'شش ماه اخیر';

  const pieData = useMemo(() => ({
    labels: chart.rows.map((r) => r.name),
    datasets: [{
      data: chart.rows.map((r) => r.amount),
      backgroundColor: chart.rows.map((r) => catMeta('expense', r.name).color),
      borderWidth: 3, borderColor: () => chartSurface(), hoverOffset: 8, borderRadius: 4,
    }],
  }), [chart.rows]);

  const pieOptions = useMemo(() => ({
    maintainAspectRatio: false,
    cutout: '70%',
    animation: { animateRotate: true, duration: 900 },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartTip,
        callbacks: {
          label: (c) => {
            const total = c.dataset.data.reduce((a, b) => a + b, 0) || 1;
            return ` ${c.label}: ${fmt.toman(c.raw)} (${fmt.percent(c.raw / total * 100)})`;
          },
        },
      },
    },
  }), []);

  /* ---------- table ---------- */
  const hasFilters = !!(search || category || method || range !== 'all' || sort !== 'date-desc');
  const rows = useMemo(() => {
    const q = util.norm(search);
    const list = all.filter((x) => (!q || util.norm(x.title).includes(q) || util.norm(x.description).includes(q))
      && (!category || x.category === category)
      && (!method || x.method === method)
      && util.inRange(x.date, range));
    const [key, dir] = sort.split('-');
    const s = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => (key === 'amount'
      ? (a.amount - b.amount) * s || b.date.localeCompare(a.date)
      : a.date.localeCompare(b.date) * s || (a.updatedAt || a.createdAt || '').localeCompare(b.updatedAt || b.createdAt || '') * s));
    return list;
  }, [all, search, category, method, range, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / config.pageSize));
  const safePage = Math.min(page, pages);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const slice = rows.slice((safePage - 1) * config.pageSize, safePage * config.pageSize);
  const totalSum = rows.reduce((s, x) => s + x.amount, 0);

  const monthOptions = useMemo(() => {
    const list = stats.lastMonths(6).reverse().map((m) => ({ value: `m:${m.key}`, label: `${m.label} ${fmt.digits(m.jy)}` }));
    if (range.startsWith('m:') && !list.some((o) => o.value === range)) {
      list.push({ value: range, label: periodName(range.slice(2)) });
    }
    return list;
  }, [range]);

  const [sortKey, sortDir] = sort.split('-');
  const sortIcon = (key) => (sortKey === key ? (sortDir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down');

  const sortByColumn = (key) => {
    setSort(sortKey === key ? `${key}-${sortDir === 'asc' ? 'desc' : 'asc'}` : `${key}-desc`);
    setPage(1);
  };

  const clearFilters = () => {
    setSearch(''); setCategory(''); setMethod(''); setRange('all'); setSort('date-desc'); setPage(1);
    toast('فیلترها پاک شدند.', 'info');
  };

  const selectCategoryFromChart = (name) => {
    setCategory(name);
    setRange(chartRange);
    setPage(1);
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const confirmDelete = async (rec) => {
    const ok = await confirm({
      title: 'حذف هزینه',
      message: `آیا از حذف هزینه «${rec.title}» مطمئن هستید؟ این عملیات قابل بازگشت نیست.`,
      confirmText: 'حذف هزینه',
    });
    if (!ok) return;
    try {
      await removeTransaction(rec.id);
      toast(`هزینه «${rec.title}» حذف شد.`);
    } catch (e) {
      toast(e.message || 'حذف هزینه انجام نشد. دوباره تلاش کنید.', 'error');
    }
  };

  const change = kpi.change;

  return (
    <div className="app-view" id="view-expenses">
      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <ol>
          <li><Link to="/"><Icon name="home" />داشبورد</Link></li>
          <li aria-hidden="true" className="sep">/</li>
          <li aria-current="page">مدیریت هزینه‌ها</li>
        </ol>
      </nav>

      <div className="page-head">
        <div>
          <h1 tabIndex="-1">مدیریت هزینه‌ها</h1>
          <p>هزینه‌های خود را ثبت کنید، دسته‌بندی کنید و الگوهای خرج‌کردن را بهتر بشناسید.</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" id="addExpenseBtn" type="button" onClick={() => setForm({ record: null })}>
            <Icon name="plus" />ثبت هزینه جدید
          </button>
        </div>
      </div>

      <div className="kpis" id="expenseKpis">
        <article className="kpi card">
          <div className="kpi-top">
            <span className="kpi-ic red"><Icon name="credit-card" /></span>
            {change !== null && (
              <span className={`chg ${change >= 0 ? 'down-bad' : 'up'}`}
                aria-label={`${change >= 0 ? 'افزایش' : 'کاهش'} ${fmt.percent(change)} نسبت به ${periodName(kpi.prevKey)}`}>
                <Icon name={change >= 0 ? 'arrow-up-right' : 'arrow-down-left'} />{fmt.percent(change)}
              </span>
            )}
          </div>
          <span className="kpi-label">مجموع هزینه‌های این ماه</span>
          <div className="kpi-val"><b>{fmt.money(kpi.total)}</b><small>تومان</small></div>
          <div className="kpi-foot">
            <span>{periodName(kpi.curKey)}{change !== null ? ` ـ نسبت به ${J.monthNames[+kpi.prevKey.split('-')[1] - 1]}` : ''}</span>
          </div>
        </article>

        <article className="kpi card">
          <div className="kpi-top">
            <span className="kpi-ic blue"><Icon name="receipt" /></span>
            <span className="chg neutral">{fmt.digits(kpi.all)} مورد در کل</span>
          </div>
          <span className="kpi-label">تعداد هزینه‌های این ماه</span>
          <div className="kpi-val"><b>{fmt.digits(kpi.count)}</b><small>مورد</small></div>
          <div className="kpi-foot">
            <span>{kpi.count ? `میانگین هر هزینه این ماه ${fmt.toman(kpi.monthAvg)}` : 'هزینه‌ای در این ماه ثبت نشده است'}</span>
          </div>
        </article>

        <article className="kpi card">
          <div className="kpi-top"><span className="kpi-ic amber"><Icon name="arrow-up-wide-narrow" /></span></div>
          <span className="kpi-label">بیشترین هزینه ثبت‌شده</span>
          <div className="kpi-val"><b>{fmt.money(kpi.max ? kpi.max.amount : 0)}</b><small>تومان</small></div>
          <div className="kpi-foot">
            <span className="ellipsis" title={kpi.max ? `${kpi.max.title} ـ ${fmt.dateLong(kpi.max.date)}` : undefined}>
              {kpi.max ? `${kpi.max.title} ـ ${fmt.dateLong(kpi.max.date)}` : 'هنوز هزینه‌ای ثبت نشده است'}
            </span>
          </div>
        </article>

        <article className="kpi card">
          <div className="kpi-top"><span className="kpi-ic teal"><Icon name="calculator" /></span></div>
          <span className="kpi-label">میانگین مبلغ هزینه‌ها</span>
          <div className="kpi-val"><b>{fmt.money(kpi.avg)}</b><small>تومان</small></div>
          <div className="kpi-foot">
            <span>{kpi.all ? `بر اساس ${fmt.digits(kpi.all)} هزینه ثبت‌شده` : 'هنوز هزینه‌ای ثبت نشده است'}</span>
          </div>
        </article>
      </div>

      <article className="card cat-card">
        <div className="card-head">
          <div>
            <h2>تفکیک هزینه‌ها بر اساس دسته‌بندی</h2>
            <p>
              {chart.rows.length
                ? `${chartLabel} ـ مجموع ${fmt.toman(chart.total)} در ${fmt.digits(chart.rows.length)} دسته‌بندی`
                : chartLabel}
            </p>
          </div>
          <div className="seg" role="group" aria-label="بازه نمودار دسته‌بندی">
            {[['this', 'ماه جاری'], ['3m', 'سه ماه اخیر'], ['6m', 'شش ماه اخیر']].map(([key, label]) => (
              <button key={key} type="button" data-cr={key} className={chartRange === key ? 'on' : ''}
                aria-pressed={chartRange === key} onClick={() => setChartRange(key)}>{label}</button>
            ))}
          </div>
        </div>

        {chart.rows.length > 0 ? (
          <div className="cat-body">
            <div className="chart-box donut ex-donut">
              <ChartCanvas type="doughnut" data={pieData} options={pieOptions} ariaLabel="نمودار سهم دسته‌بندی‌های هزینه" />
              <div className="donut-center">
                <span>مجموع هزینه</span><b>{dec(chart.total / 1e6)}</b><small>میلیون تومان</small>
              </div>
            </div>
            <ul className="cat-break" aria-label="سهم هر دسته‌بندی از هزینه‌ها">
              {chart.rows.map((r) => {
                const pct = r.share * 100;
                return (
                  <li key={r.name}>
                    <button type="button" className="cb-row" data-cat={r.name}
                      aria-label={`${r.name}: ${fmt.toman(r.amount)}، ${fmt.percent(pct)} از کل ـ نمایش در فهرست`}
                      onClick={() => selectCategoryFromChart(r.name)}>
                      <span className="cb-top">
                        <i style={{ background: catMeta('expense', r.name).color }} />
                        <span className="cb-name">{r.name}</span>
                        <b className="cb-amt">{fmt.toman(r.amount)}</b>
                        <span className="cb-pct">{fmt.percent(pct)}</span>
                      </span>
                      <span className="cb-bar">
                        <span style={{ width: `${Math.max(2, pct)}%`, background: catMeta('expense', r.name).color }} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="empty-state">
            <div className="es-ic"><Icon name="pie-chart" /></div>
            <strong>هزینه‌ای در این بازه ثبت نشده است</strong>
            <p>با ثبت هزینه‌ها، سهم هر دسته‌بندی از خرج‌های شما اینجا نمایش داده می‌شود.</p>
          </div>
        )}
      </article>

      <article className="card ledger-card expense-card" ref={listRef}>
        <div className="card-head">
          <div>
            <h2>فهرست هزینه‌ها</h2>
            <p aria-live="polite">
              {rows.length
                ? `${fmt.digits(rows.length)} هزینه${hasFilters ? ' مطابق فیلترها' : ''} ـ مجموع ${fmt.toman(totalSum)}`
                : 'موردی برای نمایش وجود ندارد'}
            </p>
          </div>
        </div>

        <div className="toolbar toolbar-5" role="group" aria-label="جست‌وجو و فیلتر هزینه‌ها">
          <div className="search field-search">
            <Icon name="search" />
            <label className="sr-only" htmlFor="exSearch">جست‌وجو در هزینه‌ها</label>
            <input type="search" id="exSearch" placeholder="جست‌وجو در عنوان یا توضیحات هزینه…" autoComplete="off"
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <div className="sel">
            <label htmlFor="exCategory">دسته‌بندی</label>
            <select id="exCategory" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
              <option value="">همه دسته‌بندی‌ها</option>
              {expenseNames.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sel">
            <label htmlFor="exMethod">روش پرداخت</label>
            <select id="exMethod" value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }}>
              <option value="">همه روش‌ها</option>
              {expenseMethods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="sel">
            <label htmlFor="exRange">بازه زمانی</label>
            <select id="exRange" value={range} onChange={(e) => { setRange(e.target.value); setPage(1); }}>
              {Object.entries(RANGE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              <optgroup label="ماه مشخص">
                {monthOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="sel">
            <label htmlFor="exSort">مرتب‌سازی</label>
            <select id="exSort" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
              <option value="date-desc">جدیدترین</option>
              <option value="date-asc">قدیمی‌ترین</option>
              <option value="amount-desc">بیشترین مبلغ</option>
              <option value="amount-asc">کمترین مبلغ</option>
            </select>
          </div>
          <button type="button" className="btn ghost clear-btn" id="exClear" disabled={!hasFilters} onClick={clearFilters}>
            <Icon name="filter-x" />پاک کردن فیلترها
          </button>
        </div>

        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="tx ledger-table expense-table">
              <caption className="sr-only">فهرست هزینه‌های ثبت‌شده</caption>
              <thead>
                <tr>
                  <th scope="col">عنوان هزینه</th>
                  <th scope="col">دسته‌بندی</th>
                  <th scope="col" aria-sort={sortKey === 'amount' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} data-sortcol="amount">
                    <button type="button" className="th-sort" data-sort="amount" onClick={() => sortByColumn('amount')}>
                      مبلغ<Icon name={sortIcon('amount')} />
                    </button>
                  </th>
                  <th scope="col" aria-sort={sortKey === 'date' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} data-sortcol="date">
                    <button type="button" className="th-sort" data-sort="date" onClick={() => sortByColumn('date')}>
                      تاریخ<Icon name={sortIcon('date')} />
                    </button>
                  </th>
                  <th scope="col">روش پرداخت</th>
                  <th scope="col">توضیحات</th>
                  <th scope="col">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((x) => {
                  const m = catMeta('expense', x.category);
                  return (
                    <tr key={x.id} data-id={x.id}>
                      <td data-label="عنوان هزینه" className="t-title">
                        <span className="cat">
                          <em style={{ background: m.bg, color: m.color }}><Icon name={m.icon} /></em>
                          <b><Highlight text={x.title} query={search.trim()} /></b>
                        </span>
                      </td>
                      <td data-label="دسته‌بندی">
                        <span className="badge" style={{ background: m.bg, color: m.color }}>{x.category}</span>
                      </td>
                      <td data-label="مبلغ" className="amt out"><span>{fmt.money(x.amount)} <small>تومان</small></span></td>
                      <td data-label="تاریخ" className="date">{fmt.date(x.date)}</td>
                      <td data-label="روش پرداخت" className="method">{x.method || '—'}</td>
                      <td data-label="توضیحات" className="desc">
                        <span>{x.description ? <Highlight text={x.description} query={search.trim()} /> : <span className="muted">—</span>}</span>
                      </td>
                      <td data-label="عملیات">
                        <div className="acts">
                          <button type="button" className="icon-act edit" aria-label={`ویرایش ${x.title}`} title="ویرایش" onClick={() => setForm({ record: x })}>
                            <Icon name="pencil" />
                          </button>
                          <button type="button" className="icon-act del" aria-label={`حذف ${x.title}`} title="حذف" onClick={() => confirmDelete(x)}>
                            <Icon name="trash-2" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length === 0 && (
          <div className="empty-state">
            {all.length === 0 ? (
              <>
                <div className="es-ic"><Icon name="receipt" /></div>
                <strong>هنوز هزینه‌ای ثبت نکرده‌اید</strong>
                <p>با ثبت اولین هزینه، خلاصه خرج‌ها و سهم هر دسته‌بندی اینجا نمایش داده می‌شود.</p>
                <button type="button" className="btn primary" onClick={() => setForm({ record: null })}>
                  <Icon name="plus" />ثبت هزینه جدید
                </button>
              </>
            ) : (
              <>
                <div className="es-ic"><Icon name="search-x" /></div>
                <strong>هزینه‌ای با این مشخصات پیدا نشد</strong>
                <p>عبارت جست‌وجو را تغییر دهید یا فیلترها را پاک کنید تا همه هزینه‌ها نمایش داده شوند.</p>
                <button type="button" className="btn ghost" onClick={clearFilters}>
                  <Icon name="filter-x" />پاک کردن فیلترها
                </button>
              </>
            )}
          </div>
        )}

        <Pager page={safePage} pages={pages} total={rows.length} size={config.pageSize} unit="مورد"
          label="صفحه‌بندی فهرست هزینه‌ها" collapse
          onPage={(p) => { setPage(p); listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
      </article>

      {form && <TransactionModal kind="expense" record={form.record} onClose={() => setForm(null)} />}
    </div>
  );
}
