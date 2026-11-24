import { useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { Modal, useUI } from '../context/UIContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { util } from '../lib/calc.js';
import { fmt } from '../lib/format.js';
import { jalali as J } from '../lib/jalali.js';
import {
  defaultExpenseNames, defaultIncomeNames, expenseMethods, paymentMethods,
} from '../lib/categories.js';

const COPY = {
  income: {
    icon: 'hand-coins',
    iconClass: 'mh-ic',
    prefix: 'if',
    noun: 'درآمد',
    title: 'ثبت درآمد جدید',
    editTitle: 'ویرایش درآمد',
    sub: 'اطلاعات درآمد دریافتی را وارد کنید.',
    editSub: 'اطلاعات درآمد را اصلاح و ذخیره کنید.',
    submit: 'ثبت درآمد',
    dateLabel: 'تاریخ دریافت',
    methodLabel: 'روش دریافت',
    placeholderTitle: 'مثلاً حقوق ماهانه',
    placeholderAmount: 'مثلاً ۲۸٬۵۰۰٬۰۰۰',
    placeholderDesc: 'جزئیات بیشتر، مثلاً نام کارفرما یا شماره قرارداد',
    categoryEmpty: 'لطفاً یک دسته‌بندی انتخاب کنید.',
  },
  expense: {
    icon: 'receipt',
    iconClass: 'mh-ic red',
    prefix: 'ef',
    noun: 'هزینه',
    title: 'ثبت هزینه جدید',
    editTitle: 'ویرایش هزینه',
    sub: 'اطلاعات هزینه پرداختی را وارد کنید.',
    editSub: 'اطلاعات هزینه را اصلاح و ذخیره کنید.',
    submit: 'ثبت هزینه',
    dateLabel: 'تاریخ',
    methodLabel: 'روش پرداخت',
    placeholderTitle: 'مثلاً خرید مواد غذایی',
    placeholderAmount: 'مثلاً ۱٬۲۵۰٬۰۰۰',
    placeholderDesc: 'جزئیات بیشتر، مثلاً نام فروشگاه یا شماره قبض',
    categoryEmpty: 'لطفاً یک دسته‌بندی انتخاب کنید.',
  },
};

/** فرم کامل ثبت و ویرایش درآمد / هزینه (مشترک بین صفحه‌ها) */
export default function TransactionModal({ kind, record, onClose }) {
  const c = COPY[kind];
  const { categoriesFor, categoryIdFor, addTransaction, updateTransaction } = useData();
  const { toast } = useUI();
  const prefix = c.prefix;

  const categoryNames = useMemo(() => {
    const list = categoriesFor(kind).map((x) => x.name);
    if (list.length) return list;
    return kind === 'income' ? defaultIncomeNames : defaultExpenseNames;
  }, [categoriesFor, kind]);
  const methods = kind === 'income' ? paymentMethods : expenseMethods;

  const [title, setTitle] = useState(record?.title || '');
  const [amount, setAmount] = useState(record ? fmt.money(record.amount) : '');
  const [category, setCategory] = useState(
    record?.category && categoryNames.includes(record.category) ? record.category : '',
  );
  const [date, setDate] = useState(fmt.dateInput(record?.date || J.todayISO()));
  const [method, setMethod] = useState(
    record && methods.includes(record.method) ? record.method : methods[0],
  );
  const [description, setDescription] = useState(record?.description || '');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const dateErrorFor = (text) => {
    if (kind === 'income') return util.parseJalali(text, 'لطفاً تاریخ دریافت را وارد کنید.');
    return util.parseJalali(text, 'لطفاً تاریخ هزینه را وارد کنید.');
  };

  const validate = () => {
    const e = {};
    const t = title.trim();
    if (!t) e.title = `عنوان ${c.noun} نمی‌تواند خالی باشد.`;
    else if (t.length < 2) e.title = `عنوان ${c.noun} باید دست‌کم ۲ نویسه باشد.`;

    const parsedAmount = util.parseAmount(amount);
    if (!amount.trim()) e.amount = `لطفاً مبلغ ${c.noun} را وارد کنید.`;
    else if (!(parsedAmount > 0)) e.amount = 'مبلغ باید عددی معتبر و بیشتر از صفر باشد.';
    else if (parsedAmount > 1e12) e.amount = 'مبلغ واردشده بیش از حد مجاز است.';

    if (!category || !categoryNames.includes(category)) e.category = c.categoryEmpty;

    const d = dateErrorFor(date);
    if (d.error) e.date = d.error;
    return { errors: e, data: { title: t, amount: parsedAmount, category, date: d.iso, method, description: description.trim() } };
  };

  const focusFirst = (errs) => {
    const first = ['title', 'amount', 'category', 'date'].find((k) => errs[k]);
    document.getElementById(`${prefix}${first.charAt(0).toUpperCase()}${first.slice(1)}`)?.focus();
  };

  const submit = async (e) => {
    e.preventDefault();
    const { errors: errs, data } = validate();
    setErrors(errs);
    if (Object.keys(errs).length) {
      focusFirst(errs);
      toast('لطفاً خطاهای فرم را برطرف کنید.', 'error');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        type: kind,
        title: data.title,
        amount: data.amount,
        date: data.date,
        categoryId: categoryIdFor(kind, data.category),
        method: data.method,
        description: data.description,
      };
      if (record) {
        await updateTransaction(record.id, payload);
        toast(`تغییرات ${c.noun} «${data.title}» ذخیره شد.`);
      } else {
        await addTransaction(payload);
        toast(`${c.noun} «${data.title}» با موفقیت ثبت شد.`);
      }
      onClose();
    } catch (err) {
      toast(err.message || `ذخیره ${c.noun} انجام نشد.`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const amountHint = (() => {
    const n = util.parseAmount(amount);
    return n > 0 ? `معادل ${fmt.million(n, 3)} میلیون تومان` : '';
  })();

  const titleId = `${prefix}Title`;
  const amountId = `${prefix}Amount`;
  const categoryId = `${prefix}Category`;
  const dateId = `${prefix}Date`;
  const methodId = `${prefix}Method`;
  const descId = `${prefix}Desc`;

  const clearError = (key) => {
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  return (
    <Modal id={`${kind}Modal`} onClose={onClose} wide
      title={(
        <div className="mh-title">
          <span className={c.iconClass}><Icon name={c.icon} /></span>
          <div>
            <h3 id={`${kind}ModalTitle`}>{record ? c.editTitle : c.title}</h3>
            <p id={`${kind}ModalSub`}>{record ? c.editSub : c.sub}</p>
          </div>
        </div>
      )}>
      <form id={`${kind}Form`} noValidate onSubmit={submit}>
        <div className="form-grid">
          <div className={`fld span2${errors.title ? ' has-err' : ''}`}>
            <label htmlFor={titleId}>عنوان {c.noun} <b className="req" aria-hidden="true">*</b></label>
            <input id={titleId} name="title" maxLength={80} placeholder={c.placeholderTitle}
              aria-required="true" aria-describedby={`${titleId}Err`}
              aria-invalid={errors.title ? 'true' : undefined}
              value={title} onChange={(e) => { setTitle(e.target.value); clearError('title'); }} />
            <em className="err" id={`${titleId}Err`}>{errors.title}</em>
          </div>

          <div className={`fld${errors.amount ? ' has-err' : ''}`}>
            <label htmlFor={amountId}>مبلغ به تومان <b className="req" aria-hidden="true">*</b></label>
            <div className="input-affix">
              <input id={amountId} name="amount" inputMode="numeric" placeholder={c.placeholderAmount}
                aria-required="true" aria-describedby={`${amountId}Err ${amountId}Hint`}
                aria-invalid={errors.amount ? 'true' : undefined}
                value={amount}
                onChange={(e) => {
                  const n = fmt.toLatin(e.target.value).replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
                  setAmount(n ? fmt.money(Number(n)) : '');
                  clearError('amount');
                }} />
              <span>تومان</span>
            </div>
            <small className="hint" id={`${amountId}Hint`}>{amountHint}</small>
            <em className="err" id={`${amountId}Err`}>{errors.amount}</em>
          </div>

          <div className={`fld${errors.category ? ' has-err' : ''}`}>
            <label htmlFor={categoryId}>دسته‌بندی <b className="req" aria-hidden="true">*</b></label>
            <select id={categoryId} name="category" aria-required="true" aria-describedby={`${categoryId}Err`}
              aria-invalid={errors.category ? 'true' : undefined}
              value={category} onChange={(e) => { setCategory(e.target.value); clearError('category'); }}>
              <option value="">انتخاب دسته‌بندی</option>
              {categoryNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <em className="err" id={`${categoryId}Err`}>{errors.category}</em>
          </div>

          <div className={`fld${errors.date ? ' has-err' : ''}`}>
            <label htmlFor={dateId}>{c.dateLabel} <b className="req" aria-hidden="true">*</b></label>
            <div className="input-affix">
              <input id={dateId} name="date" inputMode="numeric" placeholder="۱۴۰۵/۰۷/۲۷" maxLength={10}
                aria-required="true" aria-describedby={`${dateId}Err ${dateId}Hint`}
                aria-invalid={errors.date ? 'true' : undefined}
                value={date}
                onChange={(e) => {
                  setDate(fmt.digits(fmt.toLatin(e.target.value).replace(/[^\d/]/g, '')));
                  clearError('date');
                }}
                onBlur={() => { if (date) setErrors((prev) => ({ ...prev, date: dateErrorFor(date).error || '' })); }} />
              <span><Icon name="calendar" /></span>
            </div>
            <div className="quick-dates">
              <button type="button" data-qd="0" onClick={() => { setDate(fmt.dateInput(J.todayISO())); clearError('date'); }}>امروز</button>
              <button type="button" data-qd="-1" onClick={() => { setDate(fmt.dateInput(J.addDaysISO(J.todayISO(), -1))); clearError('date'); }}>دیروز</button>
              <small className="hint" id={`${dateId}Hint`}>قالب: سال/ماه/روز</small>
            </div>
            <em className="err" id={`${dateId}Err`}>{errors.date}</em>
          </div>

          <div className="fld">
            <label htmlFor={methodId}>{c.methodLabel}</label>
            <select id={methodId} name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
              {methods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="fld span2">
            <label htmlFor={descId}>توضیحات <span className="opt">(اختیاری)</span></label>
            <textarea id={descId} name="description" rows="3" maxLength={300} placeholder={c.placeholderDesc}
              aria-describedby={`${descId}Count`} value={description}
              onChange={(e) => setDescription(e.target.value)} />
            <small className="hint counter" id={`${descId}Count`}>{fmt.digits(description.length)} از ۳۰۰ نویسه</small>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>انصراف</button>
          <button type="submit" className="btn primary" id={`${prefix}Submit`} disabled={busy}>
            <Icon name="check" /><span>{record ? 'ذخیره تغییرات' : c.submit}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
