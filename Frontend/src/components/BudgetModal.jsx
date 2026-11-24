import { useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { useData } from '../context/DataContext.jsx';
import { Modal, useUI } from '../context/UIContext.jsx';
import { budgetCalc } from '../lib/calc.js';
import { util } from '../lib/calc.js';
import { fmt } from '../lib/format.js';
import { defaultExpenseNames } from '../lib/categories.js';

/** فرم ایجاد و ویرایش بودجه (همان قواعد و پیام‌های نسخه قبلی) */
export default function BudgetModal({ record, preset = {}, month, onClose, onSaved }) {
  const { categoriesFor, categoryIdFor, budgets, transactions, addBudget, updateBudget, removeBudget } = useData();
  const { toast } = useUI();

  const CATS = useMemo(() => {
    const list = categoriesFor('expense').map((x) => x.name);
    return list.length ? list : defaultExpenseNames;
  }, [categoriesFor]);

  const monthOptions = useMemo(() => {
    const opts = budgetCalc.monthOptions(budgets);
    const want = record ? record.month : (preset.month || month);
    if (want && !opts.some((o) => o.key === want)) opts.push({ key: want, label: budgetCalc.monthLabel(want) });
    return opts;
  }, [budgets, record, preset.month, month]);

  const [title, setTitle] = useState(
    record ? record.title : (preset.category || ''),
  );
  const [category, setCategory] = useState(
    record ? (CATS.includes(record.category) ? record.category : '') : (preset.category || ''),
  );
  const [budgetMonth, setBudgetMonth] = useState(
    record ? record.month : (preset.month || month),
  );
  const [limit, setLimit] = useState(record ? fmt.money(record.limit) : '');
  const [description, setDescription] = useState(record?.description || '');
  const [errors, setErrors] = useState({ title: '', category: '', month: '', limit: '' });
  const [busy, setBusy] = useState(false);

  const monthSpend = useMemo(() => {
    if (!category || !budgetMonth) return '';
    const spend = budgetCalc.monthSpend(transactions, budgetMonth).get(category);
    return spend
      ? `تا امروز ${fmt.toman(spend.amount)} در «${category}» برای ${budgetCalc.monthLabel(budgetMonth)} ثبت شده است.`
      : `هنوز هزینه‌ای در «${category}» برای ${budgetCalc.monthLabel(budgetMonth)} ثبت نشده است.`;
  }, [category, budgetMonth, transactions]);

  const limitHint = (() => {
    const n = util.parseAmount(limit);
    return n > 0 ? `معادل ${fmt.million(n, 3)} میلیون تومان` : '';
  })();

  const findDuplicate = (cat, mon) => budgets.find((b) => b.category === cat && b.month === mon && b.id !== record?.id);

  const setError = (key, msg) => setErrors((prev) => ({ ...prev, [key]: msg || '' }));

  const validate = () => {
    const e = {};
    const t = title.trim();
    if (!t) e.title = 'عنوان بودجه نمی‌تواند خالی باشد.';
    else if (t.length < 2) e.title = 'عنوان بودجه باید دست‌کم ۲ نویسه باشد.';
    if (!CATS.includes(category)) e.category = 'لطفاً دسته‌بندی هزینه را انتخاب کنید.';
    if (!/^\d{4}-\d{2}$/.test(budgetMonth)) e.month = 'لطفاً ماه بودجه را انتخاب کنید.';
    if (!e.category && !e.month) {
      const dup = findDuplicate(category, budgetMonth);
      if (dup) e.category = `برای «${category}» در ${budgetCalc.monthLabel(budgetMonth)} قبلاً بودجه «${dup.title}» تعریف شده است. همان بودجه را ویرایش کنید.`;
    }
    const lim = util.parseAmount(limit);
    if (!limit.trim()) e.limit = 'لطفاً سقف بودجه را وارد کنید.';
    else if (!(lim > 0)) e.limit = 'سقف بودجه باید عددی معتبر و بیشتر از صفر باشد.';
    else if (lim > 1e12) e.limit = 'سقف واردشده بیش از حد مجاز است.';
    setErrors({ title: e.title || '', category: e.category || '', month: e.month || '', limit: e.limit || '' });
    return { ok: !Object.keys(e).length, errors: e, data: { title: t, category, month: budgetMonth, limit: lim, description: description.trim() } };
  };

  const onCategoryOrMonth = (nextCat, nextMon) => {
    setCategory(nextCat);
    setBudgetMonth(nextMon);
    if (CATS.includes(nextCat) && nextMon) {
      const dup = findDuplicate(nextCat, nextMon);
      setError('category', dup ? `برای «${nextCat}» در ${budgetCalc.monthLabel(nextMon)} قبلاً بودجه «${dup.title}» تعریف شده است. همان بودجه را ویرایش کنید.` : '');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const { ok, errors: errs, data } = validate();
    if (!ok) {
      const first = ['title', 'category', 'month', 'limit'].find((k) => errs[k]);
      document.getElementById(`bf${first.charAt(0).toUpperCase()}${first.slice(1)}`)?.focus();
      toast('لطفاً خطاهای فرم را برطرف کنید.', 'error');
      return;
    }
    setBusy(true);
    try {
      const categoryId = categoryIdFor('expense', data.category);
      const moved = record && (record.category !== data.category || record.month !== data.month);
      if (record && moved) {
        // تغییر دسته‌بندی یا ماه = حذف بودجه قبلی و ساخت بودجه جدید
        await removeBudget(record.id);
        await addBudget({
          title: data.title, categoryId, month: data.month, limit: data.limit, description: data.description,
        });
        toast(`تغییرات بودجه «${data.title}» ذخیره شد.`);
      } else if (record) {
        await updateBudget(record.id, { title: data.title, limit: data.limit, description: data.description });
        toast(`تغییرات بودجه «${data.title}» ذخیره شد.`);
      } else {
        await addBudget({
          title: data.title, categoryId, month: data.month, limit: data.limit, description: data.description,
        });
        toast(`بودجه «${data.title}» برای ${budgetCalc.monthLabel(data.month)} ایجاد شد.`);
      }
      onClose();
      onSaved?.(data.month);
    } catch (err) {
      toast(err.message || 'ذخیره بودجه انجام نشد. دوباره تلاش کنید.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal id="budgetModal" wide onClose={onClose}
      title={(
        <div className="mh-title">
          <span className="mh-ic"><Icon name="pie-chart" /></span>
          <div>
            <h3 id="budgetModalTitle">{record ? 'ویرایش بودجه' : 'ایجاد بودجه جدید'}</h3>
            <p id="budgetModalSub">{record ? 'سقف یا مشخصات بودجه را اصلاح و ذخیره کنید.' : 'برای یک دسته‌بندی هزینه در یک ماه سقف تعیین کنید.'}</p>
          </div>
        </div>
      )}>
      <form id="budgetForm" noValidate onSubmit={submit}>
        <div className="form-grid">
          <div className={`fld span2${errors.title ? ' has-err' : ''}`}>
            <label htmlFor="bfTitle">عنوان بودجه <b className="req" aria-hidden="true">*</b></label>
            <input id="bfTitle" name="title" maxLength={60} placeholder="مثلاً بودجه خوراک ماهانه"
              aria-required="true" aria-describedby="bfTitleErr" aria-invalid={errors.title ? 'true' : undefined}
              value={title}
              onChange={(e) => { setTitle(e.target.value); if (errors.title) setError('title', ''); }} />
            <em className="err" id="bfTitleErr">{errors.title}</em>
          </div>

          <div className={`fld${errors.category ? ' has-err' : ''}`}>
            <label htmlFor="bfCategory">دسته‌بندی هزینه <b className="req" aria-hidden="true">*</b></label>
            <select id="bfCategory" name="category" aria-required="true" aria-describedby="bfCategoryErr"
              aria-invalid={errors.category ? 'true' : undefined}
              value={category} onChange={(e) => onCategoryOrMonth(e.target.value, budgetMonth)}>
              <option value="">انتخاب دسته‌بندی</option>
              {CATS.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <em className="err" id="bfCategoryErr">{errors.category}</em>
          </div>

          <div className={`fld${errors.month ? ' has-err' : ''}`}>
            <label htmlFor="bfMonth">ماه بودجه <b className="req" aria-hidden="true">*</b></label>
            <select id="bfMonth" name="month" aria-required="true" aria-describedby="bfMonthErr"
              aria-invalid={errors.month ? 'true' : undefined}
              value={budgetMonth} onChange={(e) => onCategoryOrMonth(category, e.target.value)}>
              <option value="">انتخاب ماه</option>
              {monthOptions.map((o) => (
                <option key={o.key} value={o.key}>{o.label}{o.current ? ' (ماه جاری)' : ''}</option>
              ))}
            </select>
            <em className="err" id="bfMonthErr">{errors.month}</em>
          </div>

          <div className={`fld span2${errors.limit ? ' has-err' : ''}`}>
            <label htmlFor="bfLimit">سقف بودجه به تومان <b className="req" aria-hidden="true">*</b></label>
            <div className="input-affix">
              <input id="bfLimit" name="limit" inputMode="numeric" placeholder="مثلاً ۱۰٬۰۰۰٬۰۰۰"
                aria-required="true" aria-describedby="bfLimitErr bfLimitHint bfSpentHint"
                aria-invalid={errors.limit ? 'true' : undefined}
                value={limit}
                onChange={(e) => {
                  const n = fmt.toLatin(e.target.value).replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
                  setLimit(n ? fmt.money(Number(n)) : '');
                  if (errors.limit) setError('limit', '');
                }} />
              <span>تومان</span>
            </div>
            <small className="hint" id="bfLimitHint">{limitHint}</small>
            <small className="hint spent-hint" id="bfSpentHint" aria-live="polite">{monthSpend}</small>
            <em className="err" id="bfLimitErr">{errors.limit}</em>
          </div>

          <div className="fld span2">
            <label htmlFor="bfDesc">توضیحات <span className="opt">(اختیاری)</span></label>
            <textarea id="bfDesc" name="description" rows="3" maxLength={300} placeholder="مثلاً شامل خرید هفتگی و غذای بیرون"
              aria-describedby="bfDescCount" value={description} onChange={(e) => setDescription(e.target.value)} />
            <small className="hint counter" id="bfDescCount">{fmt.digits(description.length)} از ۳۰۰ نویسه</small>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>انصراف</button>
          <button type="submit" className="btn primary" id="bfSubmit" disabled={busy}>
            <Icon name="check" /><span>{record ? 'ذخیره تغییرات' : 'ایجاد بودجه'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
