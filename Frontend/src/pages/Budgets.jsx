import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import BudgetModal from '../components/BudgetModal.jsx';
import { Highlight } from '../components/common.jsx';
import { useData } from '../context/DataContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { budgetCalc, stats, util } from '../lib/calc.js';
import { catMeta } from '../lib/categories.js';
import { fmt } from '../lib/format.js';

const pctText = (n) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: n >= 10 ? 0 : 1 }).format(n) + '٪';
const signed = (n) => (n < 0 ? '−' : '') + fmt.money(Math.abs(n));

function KpiBar({ percent, color }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(Math.min(100, percent)), 200);
    return () => clearTimeout(t);
  }, [percent]);
  return (
    <div className="bar kpi-bar" role="progressbar" aria-label="درصد مصرف کل بودجه این ماه"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(Math.min(100, percent))}
      aria-valuetext={`${pctText(percent)} از کل بودجه مصرف شده است`}>
      <span style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

export default function Budgets() {
  const { budgets, transactions, categoriesFor, removeBudget } = useData();
  const { toast, confirm } = useUI();
  const [searchParams] = useSearchParams();

  const [month, setMonth] = useState(stats.periodKey(0));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(null); // { record, preset } | null
  const listSection = useRef(null);

  const expenseNames = useMemo(() => categoriesFor('expense').map((c) => c.name), [categoriesFor]);
  const hasFilters = !!(search || category || status);

  const monthOptions = useMemo(() => {
    const opts = budgetCalc.monthOptions(budgets);
    if (!opts.some((o) => o.key === month)) opts.push({ key: month, label: budgetCalc.monthLabel(month) });
    return opts;
  }, [budgets, month]);

  useEffect(() => {
    const q = searchParams.get('q');
    const m = searchParams.get('month');
    if (q !== null) setSearch(q);
    if (m && /^\d{4}-\d{2}$/.test(m)) setMonth(m);
  }, [searchParams]);

  const summary = useMemo(() => budgetCalc.summary(transactions, budgets, month), [transactions, budgets, month]);
  const monthName = budgetCalc.monthLabel(summary.month);

  const rows = useMemo(() => {
    const q = util.norm(search);
    return summary.rows
      .filter((r) => (!q || util.norm(r.title).includes(q))
        && (!category || r.category === category)
        && (!status || r.status === status))
      .sort((a, b) => b.pct - a.pct || a.title.localeCompare(b.title, 'fa'));
  }, [summary.rows, search, category, status]);

  const selectedIndex = monthOptions.findIndex((o) => o.key === month);

  const clearFilters = () => {
    setSearch(''); setCategory(''); setStatus('');
    toast('فیلترها پاک شدند.', 'info');
  };

  const confirmDelete = async (rec) => {
    const ok = await confirm({
      title: 'حذف بودجه',
      message: `آیا از حذف بودجه «${rec.title}» (${budgetCalc.monthLabel(rec.month)}) مطمئن هستید؟ هزینه‌های ثبت‌شده حذف نمی‌شوند؛ فقط سقف بودجه برداشته می‌شود.`,
      confirmText: 'حذف بودجه',
    });
    if (!ok) return;
    try {
      await removeBudget(rec.id);
      toast(`بودجه «${rec.title}» حذف شد.`);
    } catch (e) {
      toast(e.message || 'حذف بودجه انجام نشد. دوباره تلاش کنید.', 'error');
    }
  };

  const over = summary.remaining < 0;
  const pctValue = summary.pct;
  const pctStatusKey = !summary.rows.length ? 'ok' : budgetCalc.status(summary.actual, summary.total);
  const pctStatus = budgetCalc.STATUS[pctStatusKey];

  return (
    <div className="app-view" id="view-budgets">
      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <ol>
          <li><Link to="/"><Icon name="home" />داشبورد</Link></li>
          <li aria-hidden="true" className="sep">/</li>
          <li aria-current="page">بودجه‌بندی</li>
        </ol>
      </nav>

      <div className="page-head">
        <div>
          <h1 tabIndex="-1">بودجه‌بندی</h1>
          <p>برای هزینه‌های خود برنامه‌ریزی کنید و میزان پایبندی به بودجه را زیر نظر بگیرید.</p>
        </div>
        <div className="head-actions">
          <div className="month-pick" role="group" aria-label="انتخاب ماه بودجه">
            <button type="button" className="icon-btn" id="bPrev" aria-label="ماه قبل"
              disabled={selectedIndex >= monthOptions.length - 1}
              onClick={() => { if (selectedIndex < monthOptions.length - 1) setMonth(monthOptions[selectedIndex + 1].key); }}>
              <Icon name="chevron-right" />
            </button>
            <label className="sr-only" htmlFor="bMonth">ماه بودجه</label>
            <select id="bMonth" value={month} onChange={(e) => setMonth(e.target.value)}>
              {monthOptions.map((o) => (
                <option key={o.key} value={o.key}>{o.label}{o.current ? ' (ماه جاری)' : ''}</option>
              ))}
            </select>
            <button type="button" className="icon-btn" id="bNext" aria-label="ماه بعد"
              disabled={selectedIndex <= 0}
              onClick={() => { if (selectedIndex > 0) setMonth(monthOptions[selectedIndex - 1].key); }}>
              <Icon name="chevron-left" />
            </button>
          </div>
          <button className="btn primary" id="addBudgetBtn" type="button" onClick={() => setForm({ record: null, preset: {} })}>
            <Icon name="plus" />ایجاد بودجه جدید
          </button>
        </div>
      </div>

      <div className="kpis" id="budgetKpis">
        <article className="kpi card">
          <div className="kpi-top">
            <span className="kpi-ic blue"><Icon name="wallet" /></span>
            <span className="chg neutral">{fmt.digits(summary.rows.length)} بودجه</span>
          </div>
          <span className="kpi-label">مجموع بودجه این ماه</span>
          <div className="kpi-val"><b>{fmt.money(summary.total)}</b><small>تومان</small></div>
          <div className="kpi-foot">
            <span>
              {summary.rows.length
                ? `${monthName} ـ ${fmt.digits(new Set(summary.rows.map((r) => r.category)).size)} دسته‌بندی`
                : `برای ${monthName} بودجه‌ای تعریف نشده است`}
            </span>
          </div>
        </article>

        <article className="kpi card">
          <div className="kpi-top"><span className="kpi-ic red"><Icon name="receipt" /></span></div>
          <span className="kpi-label">مجموع هزینه‌های ثبت‌شده</span>
          <div className="kpi-val"><b>{fmt.money(summary.actual)}</b><small>تومان</small></div>
          <div className="kpi-foot">
            <span>
              {summary.unbudgetedTotal > 0
                ? `${fmt.toman(summary.unbudgetedTotal)} هزینه دیگر در دسته‌های بدون بودجه`
                : (summary.monthTotal ? 'همه هزینه‌های این ماه زیر پوشش بودجه هستند' : 'هزینه‌ای در این ماه ثبت نشده است')}
            </span>
          </div>
        </article>

        <article className={`kpi card${over ? ' kpi-over' : ''}`}>
          <div className="kpi-top">
            <span className={`kpi-ic ${over ? 'red' : 'green'}`}><Icon name="piggy-bank" /></span>
            {over && (
              <span className="chg down-bad"><Icon name="alert-octagon" />کسری بودجه</span>
            )}
          </div>
          <span className="kpi-label">بودجه باقی‌مانده</span>
          <div className="kpi-val"><b className={over ? 'neg' : ''}>{signed(summary.remaining)}</b><small>تومان</small></div>
          <div className="kpi-foot">
            <span>
              {!summary.rows.length
                ? 'ابتدا برای این ماه بودجه تعریف کنید'
                : over
                  ? `هزینه‌ها ${fmt.toman(-summary.remaining)} بیشتر از کل بودجه است`
                  : `از ${fmt.toman(summary.total)} بودجه این ماه`}
            </span>
          </div>
        </article>

        <article className="kpi card">
          <div className="kpi-top">
            <span className="kpi-ic amber"><Icon name="gauge" /></span>
            {summary.rows.length > 0 && (
              <span className="chg st-pill" style={{ background: pctStatus.bg, color: pctStatus.color }}>
                <Icon name={pctStatus.icon} />{pctStatus.label}
              </span>
            )}
          </div>
          <span className="kpi-label">درصد مصرف بودجه</span>
          <div className="kpi-val"><b>{pctText(pctValue)}</b></div>
          <KpiBar percent={pctValue} color={pctStatus.bar} />
          <div className="kpi-foot">
            <span>
              {summary.rows.length
                ? `${fmt.digits(summary.counts.over)} بودجه بیش از سقف، ${fmt.digits(summary.counts.warn + summary.counts.full)} نزدیک یا در سقف`
                : 'بدون بودجه، درصد مصرف صفر است'}
            </span>
          </div>
        </article>
      </div>

      <article className="card budget-card" ref={listSection}>
        <div className="card-head">
          <div>
            <h2>بودجه‌های {monthName}</h2>
            <p aria-live="polite">
              {!summary.rows.length
                ? 'بودجه‌ای برای این ماه تعریف نشده است'
                : rows.length
                  ? `${fmt.digits(rows.length)} بودجه${hasFilters ? ' مطابق فیلترها' : ''} از ${fmt.digits(summary.rows.length)} ـ ${fmt.digits(summary.counts.ok)} در محدوده، ${fmt.digits(summary.counts.warn)} نزدیک به سقف، ${fmt.digits(summary.counts.full)} تکمیل‌شده، ${fmt.digits(summary.counts.over)} عبور از سقف`
                  : 'موردی مطابق فیلترها پیدا نشد'}
            </p>
          </div>
        </div>

        <div className="toolbar toolbar-b" role="group" aria-label="جست‌وجو و فیلتر بودجه‌ها">
          <div className="search field-search">
            <Icon name="search" />
            <label className="sr-only" htmlFor="bSearch">جست‌وجو در بودجه‌ها</label>
            <input type="search" id="bSearch" placeholder="جست‌وجو در نام بودجه…" autoComplete="off"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="sel">
            <label htmlFor="bCategory">دسته‌بندی هزینه</label>
            <select id="bCategory" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">همه دسته‌بندی‌ها</option>
              {expenseNames.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sel">
            <label htmlFor="bStatus">وضعیت</label>
            <select id="bStatus" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">همه وضعیت‌ها</option>
              {Object.entries(budgetCalc.STATUS).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
            </select>
          </div>
          <button type="button" className="btn ghost clear-btn" id="bClear" disabled={!hasFilters} onClick={clearFilters}>
            <Icon name="filter-x" />پاک کردن فیلترها
          </button>
        </div>

        {rows.length > 0 ? (
          <ul className="bud-grid" aria-label="فهرست بودجه‌ها">
            {rows.map((r) => {
              const m = catMeta('expense', r.category);
              const st = budgetCalc.STATUS[r.status];
              const isOver = r.remaining < 0;
              const link = `/expenses?cat=${encodeURIComponent(r.category)}&range=${encodeURIComponent(`m:${r.month}`)}`;
              return (
                <li className={`bcard st-${r.status}`} key={r.id} data-id={r.id}>
                  <div className="bc-head">
                    <span className="bc-ic" style={{ background: m.bg, color: m.color }}><Icon name={m.icon} /></span>
                    <div className="bc-name">
                      <h3><span><Highlight text={r.title} query={search} /></span></h3>
                      <span className="badge" style={{ background: m.bg, color: m.color }}>{r.category}</span>
                    </div>
                    <div className="acts">
                      <button type="button" className="icon-act edit" aria-label={`ویرایش بودجه ${r.title}`} title="ویرایش"
                        onClick={() => setForm({ record: r, preset: {} })}>
                        <Icon name="pencil" />
                      </button>
                      <button type="button" className="icon-act del" aria-label={`حذف بودجه ${r.title}`} title="حذف"
                        onClick={() => confirmDelete(r)}>
                        <Icon name="trash-2" />
                      </button>
                    </div>
                  </div>
                  <div className="bc-prog">
                    <span className="st-pill" style={{ background: st.bg, color: st.color }}><Icon name={st.icon} />{st.label}</span>
                    <b className="bc-pct" style={{ color: st.color }}>{pctText(r.pct)}</b>
                  </div>
                  <div className="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(r.barPct)}
                    aria-label={`مصرف بودجه ${r.title}`} aria-valuetext={`${pctText(r.pct)} مصرف‌شده ـ ${st.label}`}>
                    <span style={{ width: `${r.barPct}%`, background: st.bar }} />
                  </div>
                  <dl className="bc-meta">
                    <div><dt>سقف بودجه</dt><dd>{fmt.money(r.limit)}<small>تومان</small></dd></div>
                    <div><dt>هزینه واقعی</dt><dd>{fmt.money(r.spent)}<small>تومان</small></dd></div>
                    <div className={isOver ? 'neg' : ''}>
                      <dt>{isOver ? 'مازاد بر سقف' : 'باقی‌مانده'}</dt>
                      <dd>{isOver ? '−' : ''}{fmt.money(Math.abs(r.remaining))}<small>تومان</small></dd>
                    </div>
                  </dl>
                  {isOver && (
                    <p className="bc-over"><Icon name="alert-octagon" />{fmt.toman(-r.remaining)} بیش از سقف بودجه هزینه شده است.</p>
                  )}
                  {r.description && <p className="bc-desc">{r.description}</p>}
                  <div className="bc-foot">
                    <span>{r.count ? `${fmt.digits(r.count)} هزینه ثبت‌شده در ${budgetCalc.monthLabel(r.month)}` : 'هنوز هزینه‌ای ثبت نشده'}</span>
                    {r.count > 0 && (
                      <Link to={link} className="link-btn">مشاهده هزینه‌ها<Icon name="chevron-left" /></Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty-state">
            {!summary.rows.length ? (
              <>
                <div className="es-ic"><Icon name="pie-chart" /></div>
                <strong>برای {monthName} هنوز بودجه‌ای ندارید</strong>
                <p>برای دسته‌بندی‌های پرهزینه سقف تعیین کنید تا میزان مصرف و هشدار نزدیک شدن به سقف را اینجا ببینید.</p>
                <button type="button" className="btn primary" onClick={() => setForm({ record: null, preset: {} })}>
                  <Icon name="plus" />ایجاد اولین بودجه
                </button>
              </>
            ) : (
              <>
                <div className="es-ic"><Icon name="search-x" /></div>
                <strong>بودجه‌ای با این مشخصات پیدا نشد</strong>
                <p>عبارت جست‌وجو را تغییر دهید یا فیلترها را پاک کنید تا همه بودجه‌های این ماه نمایش داده شوند.</p>
                <button type="button" className="btn ghost" onClick={clearFilters}>
                  <Icon name="filter-x" />پاک کردن فیلترها
                </button>
              </>
            )}
          </div>
        )}
      </article>

      {summary.unbudgeted.length > 0 && (
        <article className="card unbudgeted-card">
          <div className="card-head">
            <div>
              <h2>هزینه‌های بدون بودجه</h2>
              <p>
                {fmt.toman(summary.unbudgetedTotal)} از هزینه‌های {monthName} در دسته‌هایی است که بودجه ندارند.
                این هزینه‌ها در مدیریت هزینه‌ها و داشبورد محاسبه می‌شوند.
              </p>
            </div>
          </div>
          <ul className="unb-list">
            {summary.unbudgeted.map((u) => {
              const m = catMeta('expense', u.category);
              return (
                <li key={u.category}>
                  <span className="bc-ic sm" style={{ background: m.bg, color: m.color }}><Icon name={m.icon} /></span>
                  <span className="unb-name">{u.category}<small>{fmt.digits(u.count)} هزینه</small></span>
                  <b>{fmt.toman(u.amount)}</b>
                  <button type="button" className="btn ghost sm"
                    onClick={() => setForm({ record: null, preset: { category: u.category, month } })}>
                    <Icon name="plus" />تعیین بودجه
                  </button>
                </li>
              );
            })}
          </ul>
        </article>
      )}

      {form && (
        <BudgetModal
          record={form.record}
          preset={form.preset}
          month={month}
          onClose={() => setForm(null)}
          onSaved={(m) => { if (m !== month) setMonth(m); }}
        />
      )}
    </div>
  );
}
