import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Highlight, Pager } from '../components/common.jsx';
import TransactionModal from '../components/TransactionModal.jsx';
import { Modal } from '../context/UIContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { config, util } from '../lib/calc.js';
import { catMeta } from '../lib/categories.js';
import { fmt } from '../lib/format.js';
import { jalali as J } from '../lib/jalali.js';

const RANGE_LABELS = {
  all: 'همه زمان‌ها', this: 'ماه جاری', last: 'ماه گذشته', '3m': 'سه ماه اخیر', '6m': 'شش ماه اخیر', year: 'سال جاری',
};

export default function Income() {
  const { transactions, categoriesFor, removeTransaction } = useData();
  const { toast, confirm } = useUI();
  const [searchParams] = useSearchParams();

  const { periodKey, periodLabel } = useMemo(() => {
    const p = config.period;
    return {
      periodKey: `${p.jy}-${String(p.jm).padStart(2, '0')}`,
      periodLabel: `${J.monthNames[p.jm - 1]} ${fmt.digits(p.jy)}`,
    };
  }, []);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [range, setRange] = useState('all');
  const [sort, setSort] = useState('date-desc');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(null); // { record } | null
  const [detail, setDetail] = useState(null);
  const listRef = useRef(null);

  const incomeCategories = useMemo(() => categoriesFor('income').map((c) => c.name), [categoriesFor]);
  const all = useMemo(() => transactions.filter((x) => x.type === 'income'), [transactions]);

  useEffect(() => {
    const q = searchParams.get('q');
    if (q !== null) { setSearch(q); setPage(1); }
  }, [searchParams]);

  const hasFilters = !!(search || category || range !== 'all' || sort !== 'date-desc');

  const rows = useMemo(() => {
    const q = util.norm(search);
    const list = all.filter((x) => (!q || util.norm(x.title).includes(q) || util.norm(x.description).includes(q))
      && (!category || x.category === category)
      && util.inRange(x.date, range));
    const [key, dir] = sort.split('-');
    const s = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => (key === 'amount'
      ? (a.amount - b.amount) * s || b.date.localeCompare(a.date)
      : a.date.localeCompare(b.date) * s || (a.updatedAt || a.createdAt || '').localeCompare(b.updatedAt || b.createdAt || '') * s));
    return list;
  }, [all, search, category, range, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / config.pageSize));
  const safePage = Math.min(page, pages);

  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);

  const slice = rows.slice((safePage - 1) * config.pageSize, safePage * config.pageSize);
  const total = rows.reduce((s, x) => s + x.amount, 0);

  /* ---------- KPI ---------- */
  const kpis = useMemo(() => {
    const thisMonth = all.filter((x) => J.monthKey(x.date) === periodKey);
    const monthTotal = thisMonth.reduce((s, x) => s + x.amount, 0);
    let { jy, jm } = config.period; jm -= 1; if (!jm) { jm = 12; jy -= 1; }
    const prevKey = `${jy}-${String(jm).padStart(2, '0')}`;
    const prev = all.filter((x) => J.monthKey(x.date) === prevKey).reduce((s, x) => s + x.amount, 0);
    const max = all.length ? all.reduce((a, b) => (b.amount > a.amount ? b : a)) : null;
    const avg = all.length ? all.reduce((s, x) => s + x.amount, 0) / all.length : 0;
    return { thisMonth, monthTotal, prev, prevMonthName: J.monthNames[jm - 1], max, avg };
  }, [all, periodKey]);

  const monthChg = kpis.prev
    ? ((kpis.monthTotal - kpis.prev) / kpis.prev) * 100
    : null;

  const clearFilters = () => {
    setSearch(''); setCategory(''); setRange('all'); setSort('date-desc'); setPage(1);
    toast('فیلترها پاک شدند.', 'info');
  };

  const sortByColumn = (key) => {
    const [curKey, dir] = sort.split('-');
    setSort(curKey === key ? `${key}-${dir === 'asc' ? 'desc' : 'asc'}` : `${key}-desc`);
    setPage(1);
  };

  const confirmDelete = async (rec) => {
    const ok = await confirm({
      title: 'حذف درآمد',
      message: 'آیا از حذف این درآمد مطمئن هستید؟ این عملیات قابل بازگشت نیست.',
      confirmText: 'حذف درآمد',
    });
    if (!ok) return;
    try {
      await removeTransaction(rec.id);
      toast(`درآمد «${rec.title}» حذف شد.`);
    } catch (e) {
      toast(e.message || 'حذف درآمد انجام نشد.', 'error');
    }
  };

  const [sortKey, sortDir] = sort.split('-');
  const sortIcon = (key) => (sortKey === key ? (sortDir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down');

  return (
    <div className="app-view" id="view-income">
      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <ol>
          <li><Link to="/"><Icon name="home" />داشبورد</Link></li>
          <li aria-hidden="true" className="sep">←</li>
          <li aria-current="page">مدیریت درآمدها</li>
        </ol>
      </nav>

      <div className="page-head">
        <div>
          <h1 tabIndex="-1">مدیریت درآمدها</h1>
          <p>تمام درآمدهای خود را ثبت و مدیریت کنید و وضعیت دریافتی‌های خود را زیر نظر داشته باشید.</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" id="addIncomeBtn" type="button" onClick={() => setForm({ record: null })}>
            <Icon name="plus" />ثبت درآمد جدید
          </button>
        </div>
      </div>

      <div className="kpis" id="incomeKpis">
        <article className="kpi card">
          <div className="kpi-top">
            <span className="kpi-ic blue"><Icon name="wallet" /></span>
            {monthChg !== null && (
              <span className={`chg ${monthChg >= 0 ? 'up' : 'down-bad'}`}
                aria-label={`${monthChg >= 0 ? 'افزایش' : 'کاهش'} ${fmt.percent(monthChg)} نسبت به ${kpis.prevMonthName}`}>
                <Icon name={monthChg >= 0 ? 'arrow-up-right' : 'arrow-down-left'} />{fmt.percent(monthChg)}
              </span>
            )}
          </div>
          <span className="kpi-label">مجموع درآمد این ماه</span>
          <div className="kpi-val"><b>{fmt.money(kpis.monthTotal)}</b><small>تومان</small></div>
          <div className="kpi-foot"><span>{periodLabel}{kpis.prev ? ` ـ نسبت به ${kpis.prevMonthName}` : ''}</span></div>
        </article>

        <article className="kpi card">
          <div className="kpi-top">
            <span className="kpi-ic green"><Icon name="list-checks" /></span>
            <span className="chg neutral">{fmt.digits(kpis.thisMonth.length)} مورد این ماه</span>
          </div>
          <span className="kpi-label">تعداد درآمدهای ثبت‌شده</span>
          <div className="kpi-val"><b>{fmt.digits(all.length)}</b><small>مورد</small></div>
          <div className="kpi-foot"><span>مجموع درآمدهای ثبت‌شده در سامانه</span></div>
        </article>

        <article className="kpi card">
          <div className="kpi-top"><span className="kpi-ic amber"><Icon name="trophy" /></span></div>
          <span className="kpi-label">بیشترین درآمد</span>
          <div className="kpi-val"><b>{fmt.money(kpis.max ? kpis.max.amount : 0)}</b><small>تومان</small></div>
          <div className="kpi-foot">
            <span className="ellipsis" title={kpis.max ? `${kpis.max.title} ـ ${fmt.dateLong(kpis.max.date)}` : undefined}>
              {kpis.max ? `${kpis.max.title} ـ ${fmt.dateLong(kpis.max.date)}` : 'هنوز درآمدی ثبت نشده است'}
            </span>
          </div>
        </article>

        <article className="kpi card">
          <div className="kpi-top"><span className="kpi-ic teal"><Icon name="calculator" /></span></div>
          <span className="kpi-label">میانگین درآمد</span>
          <div className="kpi-val"><b>{fmt.money(kpis.avg)}</b><small>تومان</small></div>
          <div className="kpi-foot"><span>میانگین مبلغ هر درآمد ثبت‌شده</span></div>
        </article>
      </div>

      <article className="card ledger-card income-card" ref={listRef}>
        <div className="card-head">
          <div>
            <h2>فهرست درآمدها</h2>
            <p aria-live="polite">
              {rows.length
                ? `${fmt.digits(rows.length)} مورد${hasFilters ? ' مطابق فیلترها' : ''} ـ مجموع ${fmt.toman(total)}`
                : 'موردی برای نمایش وجود ندارد'}
            </p>
          </div>
        </div>

        <div className="toolbar" role="group" aria-label="جست‌وجو و فیلتر درآمدها">
          <div className="search field-search">
            <Icon name="search" />
            <label className="sr-only" htmlFor="fSearch">جست‌وجو در درآمدها</label>
            <input type="search" id="fSearch" placeholder="جست‌وجو در عنوان یا توضیحات درآمد…" autoComplete="off"
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <div className="sel">
            <label htmlFor="fCategory">دسته‌بندی درآمد</label>
            <select id="fCategory" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
              <option value="">همه دسته‌بندی‌ها</option>
              {incomeCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sel">
            <label htmlFor="fRange">بازه زمانی</label>
            <select id="fRange" value={range} onChange={(e) => { setRange(e.target.value); setPage(1); }}>
              {Object.entries(RANGE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <div className="sel">
            <label htmlFor="fSort">مرتب‌سازی</label>
            <select id="fSort" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
              <optgroup label="مرتب‌سازی بر اساس تاریخ">
                <option value="date-desc">جدیدترین</option>
                <option value="date-asc">قدیمی‌ترین</option>
              </optgroup>
              <optgroup label="مرتب‌سازی بر اساس مبلغ">
                <option value="amount-desc">بیشترین مبلغ</option>
                <option value="amount-asc">کمترین مبلغ</option>
              </optgroup>
            </select>
          </div>
          <button type="button" className="btn ghost clear-btn" id="clearFilters" disabled={!hasFilters} onClick={clearFilters}>
            <Icon name="filter-x" />پاک کردن فیلترها
          </button>
        </div>

        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="tx ledger-table income-table">
              <caption className="sr-only">فهرست درآمدهای ثبت‌شده</caption>
              <thead>
                <tr>
                  <th scope="col">عنوان درآمد</th>
                  <th scope="col">دسته‌بندی</th>
                  <th scope="col" aria-sort={sortKey === 'amount' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} data-sortcol="amount">
                    <button type="button" className="th-sort" data-sort="amount" onClick={() => sortByColumn('amount')}>
                      مبلغ<Icon name={sortIcon('amount')} />
                    </button>
                  </th>
                  <th scope="col" aria-sort={sortKey === 'date' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} data-sortcol="date">
                    <button type="button" className="th-sort" data-sort="date" onClick={() => sortByColumn('date')}>
                      تاریخ دریافت<Icon name={sortIcon('date')} />
                    </button>
                  </th>
                  <th scope="col">روش دریافت</th>
                  <th scope="col">توضیحات</th>
                  <th scope="col">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((x) => {
                  const m = catMeta('income', x.category);
                  return (
                    <tr key={x.id} data-id={x.id}>
                      <td data-label="عنوان درآمد" className="t-title">
                        <span className="cat">
                          <em style={{ background: m.bg, color: m.color }}><Icon name={m.icon} /></em>
                          <b><Highlight text={x.title} query={search.trim()} /></b>
                        </span>
                      </td>
                      <td data-label="دسته‌بندی">
                        <span className="badge" style={{ background: m.bg, color: m.color }}>{x.category}</span>
                      </td>
                      <td data-label="مبلغ" className="amt in"><span>{fmt.money(x.amount)} <small>تومان</small></span></td>
                      <td data-label="تاریخ دریافت" className="date">{fmt.date(x.date)}</td>
                      <td data-label="روش دریافت" className="method">{x.method || '—'}</td>
                      <td data-label="توضیحات" className="desc">
                        <span>{x.description ? <Highlight text={x.description} query={search.trim()} /> : <span className="muted">—</span>}</span>
                      </td>
                      <td data-label="عملیات">
                        <div className="acts">
                          <button type="button" className="icon-act view" aria-label={`مشاهده جزئیات ${x.title}`} title="مشاهده جزئیات" onClick={() => setDetail(x)}>
                            <Icon name="eye" />
                          </button>
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
                <div className="es-ic"><Icon name="wallet" /></div>
                <strong>هنوز درآمدی ثبت نکرده‌اید</strong>
                <p>با ثبت اولین درآمد، خلاصه وضعیت دریافتی‌های شما اینجا نمایش داده می‌شود.</p>
                <button type="button" className="btn primary" onClick={() => setForm({ record: null })}>
                  <Icon name="plus" />ثبت درآمد جدید
                </button>
              </>
            ) : (
              <>
                <div className="es-ic"><Icon name="search-x" /></div>
                <strong>درآمدی با این مشخصات پیدا نشد</strong>
                <p>عبارت جست‌وجو را تغییر دهید یا فیلترها را پاک کنید تا همه درآمدها نمایش داده شوند.</p>
                <button type="button" className="btn ghost" onClick={clearFilters}>
                  <Icon name="filter-x" />پاک کردن فیلترها
                </button>
              </>
            )}
          </div>
        )}

        <Pager page={safePage} pages={pages} total={rows.length} size={config.pageSize} unit="مورد"
          label="صفحه‌بندی فهرست درآمدها"
          onPage={(p) => { setPage(p); listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
      </article>

      {form && (
        <TransactionModal kind="income" record={form.record} onClose={() => setForm(null)} />
      )}

      {detail && (
        <Modal id="detailModal" title="جزئیات درآمد" onClose={() => setDetail(null)}>
          <div>
            <div className="detail-hero">
              <span className="cat-ic lg" style={{ background: catMeta('income', detail.category).bg, color: catMeta('income', detail.category).color }}>
                <Icon name={catMeta('income', detail.category).icon} />
              </span>
              <div>
                <strong>{detail.title}</strong>
                <b className="detail-amt">{fmt.toman(detail.amount)}</b>
              </div>
            </div>
            <dl className="detail-list">
              <div><dt>دسته‌بندی</dt><dd>{detail.category}</dd></div>
              <div><dt>تاریخ دریافت</dt><dd>{fmt.dateLong(detail.date)}</dd></div>
              <div><dt>روش دریافت</dt><dd>{detail.method || 'ثبت نشده'}</dd></div>
              <div><dt>آخرین به‌روزرسانی</dt><dd>{fmt.dateLong((detail.updatedAt || detail.date).slice(0, 10))}</dd></div>
              <div className="full">
                <dt>توضیحات</dt>
                <dd>{detail.description ? detail.description : <span className="muted">توضیحاتی ثبت نشده است.</span>}</dd>
              </div>
            </dl>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setDetail(null)}>بستن</button>
            <button type="button" className="btn primary" id="detailEdit" onClick={() => { const r = detail; setDetail(null); setForm({ record: r }); }}>
              <Icon name="pencil" />ویرایش
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
