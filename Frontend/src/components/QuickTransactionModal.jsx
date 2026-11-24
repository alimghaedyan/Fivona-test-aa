import { useMemo, useState } from 'react';
import { useData } from '../context/DataContext.jsx';
import { Modal, useUI } from '../context/UIContext.jsx';
import { defaultExpenseNames, expenseMethods } from '../lib/categories.js';
import { fmt } from '../lib/format.js';
import { jalali as J } from '../lib/jalali.js';

/** پنجره سریع ثبت/ویرایش هزینه در داشبورد (همان پنجره ساده نسخه قبلی) */
export default function QuickTransactionModal({ record, onClose, onSwitchToIncome }) {
  const { categoriesFor, categoryIdFor, addTransaction, updateTransaction } = useData();
  const { toast } = useUI();

  const categoryNames = useMemo(() => {
    const list = categoriesFor('expense').map((x) => x.name);
    return list.length ? list : defaultExpenseNames;
  }, [categoriesFor]);

  const [amount, setAmount] = useState(record ? fmt.money(record.amount) : '');
  const [category, setCategory] = useState(
    record?.category && categoryNames.includes(record.category) ? record.category : categoryNames[0] || '',
  );
  const [desc, setDesc] = useState(record?.title || '');
  const [errors, setErrors] = useState({ amount: '', desc: '' });
  const [busy, setBusy] = useState(false);

  const switchToIncome = () => {
    onClose();
    onSwitchToIncome?.();
  };

  const submit = async (e) => {
    e.preventDefault();
    const amt = Number(fmt.toLatin(amount).replace(/[^\d]/g, ''));
    const text = desc.trim();
    const next = {
      amount: amt > 0 ? '' : 'لطفاً مبلغ معتبری بیشتر از صفر وارد کنید.',
      desc: text ? '' : 'لطفاً توضیحات تراکنش را وارد کنید.',
    };
    setErrors(next);
    if (next.amount) { document.getElementById('txAmount')?.focus(); return; }
    if (next.desc) { document.getElementById('txDesc')?.focus(); return; }
    setBusy(true);
    try {
      if (record) {
        await updateTransaction(record.id, {
          type: 'expense',
          categoryId: categoryIdFor('expense', category),
          title: text,
          amount: amt,
        });
        toast('تغییرات تراکنش ذخیره شد.');
      } else {
        await addTransaction({
          type: 'expense',
          title: text,
          amount: amt,
          date: J.todayISO(),
          categoryId: categoryIdFor('expense', category),
          method: expenseMethods[0],
          description: '',
        });
        toast('هزینه جدید با موفقیت ثبت شد.');
      }
      onClose();
    } catch (err) {
      toast(err.message || 'ذخیره هزینه انجام نشد.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal id="quickModal" onClose={onClose} title={record ? 'ویرایش تراکنش هزینه' : 'ثبت تراکنش جدید'}>
      <form id="txForm" noValidate onSubmit={submit}>
        {!record && (
          <div className="type-toggle" role="radiogroup" aria-label="نوع تراکنش">
            <label>
              <input type="radio" name="type" value="expense" defaultChecked
                onChange={(e) => { if (e.target.checked) { /* هزینه */ } }} />
              <span>هزینه</span>
            </label>
            <label>
              <input type="radio" name="type" value="income" onChange={(e) => { if (e.target.checked) switchToIncome(); }} />
              <span>درآمد</span>
            </label>
          </div>
        )}
        <label className="fld">
          <span>مبلغ (تومان)</span>
          <input id="txAmount" name="amount" inputMode="numeric" placeholder="مثلاً ۲٬۵۰۰٬۰۰۰"
            aria-describedby="txAmountErr" aria-invalid={errors.amount ? 'true' : undefined}
            value={amount}
            onChange={(e) => {
              const n = fmt.toLatin(e.target.value).replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
              setAmount(n ? fmt.money(Number(n)) : '');
              if (errors.amount) setErrors((p) => ({ ...p, amount: '' }));
            }} />
          <em className="err" id="txAmountErr">{errors.amount}</em>
        </label>
        <label className="fld">
          <span>دسته‌بندی</span>
          <select name="cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categoryNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="fld">
          <span>توضیحات</span>
          <input id="txDesc" name="desc" placeholder="مثلاً خرید از فروشگاه"
            aria-describedby="txDescErr" aria-invalid={errors.desc ? 'true' : undefined}
            value={desc}
            onChange={(e) => { setDesc(e.target.value); if (errors.desc) setErrors((p) => ({ ...p, desc: '' })); }} />
          <em className="err" id="txDescErr">{errors.desc}</em>
        </label>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>انصراف</button>
          <button type="submit" className="btn primary" disabled={busy}>ذخیره</button>
        </div>
      </form>
    </Modal>
  );
}
