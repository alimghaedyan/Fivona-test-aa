import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { defaultExpenseNames, defaultIncomeNames } from '../lib/categories.js';
import { setDateFormat } from '../lib/format.js';
import { useAuth } from './AuthContext.jsx';

const DataContext = createContext(null);

export const DEFAULT_PREFS = {
  dateFormat: 'numeric',
  annualGoal: 0,
  notificationRead: [],
  fullName: '',
  bio: '',
  avatar: '',
  budgetTitles: {},
  budgetNotes: {},
  categoriesSeeded: false,
};

function normalizeProfile(p) {
  if (!p) return null;
  return { ...p, displayName: p.display_name || '' };
}

const pad = (n) => String(n).padStart(2, '0');
const budgetTitleKey = (categoryId, year, month) => `${categoryId}:${year}-${pad(month)}`;

/** ترتیب دسته‌بندی‌ها مطابق نسخه قبلی؛ دسته‌های سفارشی پس از پیش‌فرض‌ها */
function inCanonicalOrder(list, type) {
  const order = type === 'income' ? defaultIncomeNames : defaultExpenseNames;
  const rank = (name) => {
    const i = order.indexOf(name);
    return i === -1 ? order.length : i;
  };
  return [...list].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'fa'));
}

function mapTransaction(t, catById) {
  return {
    id: `tx-${t.id}`,
    apiId: t.id,
    type: t.type,
    title: t.title,
    amount: t.amount,
    date: t.transaction_date,
    category: t.category_id != null ? catById.get(t.category_id) || '' : '',
    categoryId: t.category_id,
    method: t.payment_method || '',
    description: t.description || '',
    createdAt: t.created_at || '',
    updatedAt: t.updated_at || '',
  };
}

function mapBudget(b, catById, prefs) {
  const key = budgetTitleKey(b.category_id, b.year, b.month);
  const name = catById.get(b.category_id) || '';
  return {
    id: `bud-${b.id}`,
    apiId: b.id,
    categoryId: b.category_id,
    category: name,
    title: (prefs.budgetTitles && prefs.budgetTitles[key]) || name,
    month: `${b.year}-${pad(b.month)}`,
    year: b.year,
    monthNum: b.month,
    limit: b.amount,
    description: (prefs.budgetNotes && prefs.budgetNotes[key]) || '',
    demo: false,
  };
}

export function DataProvider({ children }) {
  const { status, refreshUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const loadedFor = useRef(null);

  const prefs = useMemo(() => ({ ...DEFAULT_PREFS, ...(profile?.preferences || {}) }), [profile]);

  useEffect(() => { setDateFormat(prefs.dateFormat); }, [prefs.dateFormat]);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const hydrateFrom = useCallback((cats, prefsValue) => ({
    categories: cats,
    transactions: (tx) => tx.map((t) => mapTransaction(t, new Map(cats.map((c) => [c.id, c.name])))),
    budgets: (bs) => bs.map((b) => mapBudget(b, new Map(cats.map((c) => [c.id, c.name])), prefsValue)),
  }), []);

  const loadAll = useCallback(async () => {
    setLoading(true); setError('');
    try {
      let p = await api.getProfile();
      let cats = await api.listCategories();
      if (cats.length === 0 && !(p.preferences && p.preferences.categoriesSeeded)) {
        const created = [];
        for (const name of defaultIncomeNames) {
          created.push(await api.createCategory({ name, type: 'income' }));
        }
        for (const name of defaultExpenseNames) {
          created.push(await api.createCategory({ name, type: 'expense' }));
        }
        cats = created;
        p = await api.updateProfile({ preferences: { ...(p.preferences || {}), categoriesSeeded: true } });
      }
      p = normalizeProfile(p);
      const h = hydrateFrom(cats, p.preferences || {});
      const [tx, bs] = await Promise.all([api.allTransactions(), api.listBudgets()]);
      setProfile(p);
      setCategories(cats);
      setTransactions(h.transactions(tx));
      setBudgets(h.budgets(bs));
      setReady(true);
    } catch (e) {
      setError(e.message || 'بارگذاری داده‌ها انجام نشد.');
      setReady(true);
    } finally {
      setLoading(false);
    }
  }, [hydrateFrom]);

  useEffect(() => {
    if (status === 'authed') {
      if (loadedFor.current === 'authed') return;
      loadedFor.current = 'authed';
      loadAll();
    } else if (status === 'anon') {
      loadedFor.current = 'anon';
      setProfile(null);
      setCategories([]);
      setTransactions([]);
      setBudgets([]);
      setReady(false);
    }
  }, [status, loadAll]);

  const refresh = useCallback(async () => {
    if (status !== 'authed') return;
    await loadAll();
  }, [status, loadAll]);

  const patchProfile = useCallback(async (payload) => {
    const p = normalizeProfile(await api.updateProfile(payload));
    setProfile(p);
    return p;
  }, []);

  const savePreferences = useCallback(async (patch) => {
    const next = { ...(profile?.preferences || {}), ...patch };
    await patchProfile({ preferences: next });
    return next;
  }, [profile, patchProfile]);

  /** افزودن تراکنش */
  const addTransaction = useCallback(async (data) => {
    const body = {
      type: data.type,
      title: data.title,
      amount: Math.round(data.amount),
      transaction_date: data.date,
      category_id: data.categoryId ?? null,
      payment_method: data.method || null,
      description: data.description || null,
    };
    const created = await api.createTransaction(body);
    const row = mapTransaction(created, catById);
    setTransactions((list) => [row, ...list]);
    return row;
  }, [catById]);

  const updateTransaction = useCallback(async (id, data) => {
    const current = transactions.find((x) => x.id === id);
    if (!current) throw new Error('تراکنش پیدا نشد.');
    const body = {
      type: data.type ?? current.type,
      title: data.title ?? current.title,
      amount: Math.round(data.amount ?? current.amount),
      transaction_date: data.date ?? current.date,
      category_id: data.categoryId !== undefined ? data.categoryId : current.categoryId,
      payment_method: data.method !== undefined ? (data.method || null) : (current.method || null),
      description: data.description !== undefined ? (data.description || null) : (current.description || null),
    };
    const updated = await api.updateTransaction(current.apiId, body);
    const row = mapTransaction(updated, catById);
    setTransactions((list) => list.map((x) => (x.id === id ? row : x)));
    return row;
  }, [transactions, catById]);

  const removeTransaction = useCallback(async (id) => {
    const current = transactions.find((x) => x.id === id);
    if (!current) return false;
    await api.deleteTransaction(current.apiId);
    setTransactions((list) => list.filter((x) => x.id !== id));
    return true;
  }, [transactions]);

  /** افزودن بودجه */
  const addBudget = useCallback(async ({ title, categoryId, month, limit, description }) => {
    const [year, monthNum] = month.split('-').map(Number);
    const created = await api.createBudget({ category_id: categoryId, year, month: monthNum, amount: Math.round(limit) });
    const key = budgetTitleKey(categoryId, year, monthNum);
    let prefsValue = prefs;
    const category = catById.get(categoryId) || '';
    const patch = {};
    if (title && title !== category) patch.budgetTitles = { ...(prefs.budgetTitles || {}), [key]: title };
    if (description) patch.budgetNotes = { ...(prefs.budgetNotes || {}), [key]: description };
    if (Object.keys(patch).length) {
      const p = await patchProfile({ preferences: { ...(profile?.preferences || {}), ...patch } });
      prefsValue = { ...DEFAULT_PREFS, ...(p.preferences || {}) };
    }
    const row = mapBudget(created, catById, prefsValue);
    setBudgets((list) => [row, ...list]);
    return row;
  }, [catById, prefs, profile, patchProfile]);

  const updateBudget = useCallback(async (id, { title, limit, description }) => {
    const current = budgets.find((b) => b.id === id);
    if (!current) throw new Error('بودجه پیدا نشد.');
    let prefsValue = prefs;
    const patch = {};
    if (title !== undefined) {
      const key = budgetTitleKey(current.categoryId, current.year, current.monthNum);
      const budgetTitles = { ...(prefs.budgetTitles || {}) };
      if (title && title !== current.category) budgetTitles[key] = title; else delete budgetTitles[key];
      patch.budgetTitles = budgetTitles;
    }
    if (description !== undefined) {
      const key = budgetTitleKey(current.categoryId, current.year, current.monthNum);
      const budgetNotes = { ...(prefs.budgetNotes || {}) };
      if (description) budgetNotes[key] = description; else delete budgetNotes[key];
      patch.budgetNotes = budgetNotes;
    }
    if (Object.keys(patch).length) {
      const p = await patchProfile({ preferences: { ...(profile?.preferences || {}), ...patch } });
      prefsValue = { ...DEFAULT_PREFS, ...(p.preferences || {}) };
    }
    let saved = { ...current };
    if (limit !== undefined) {
      const updated = await api.updateBudget(current.apiId, { amount: Math.round(limit) });
      saved = { ...saved, limit: updated.amount };
    }
    const row = mapBudget(
      { id: current.apiId, category_id: current.categoryId, year: current.year, month: current.monthNum, amount: saved.limit },
      catById,
      prefsValue,
    );
    row.description = description !== undefined ? (description || '') : current.description;
    setBudgets((list) => list.map((b) => (b.id === id ? row : b)));
    return row;
  }, [budgets, catById, prefs, profile, patchProfile]);

  const removeBudget = useCallback(async (id) => {
    const current = budgets.find((b) => b.id === id);
    if (!current) return false;
    await api.deleteBudget(current.apiId);
    setBudgets((list) => list.filter((b) => b.id !== id));
    return true;
  }, [budgets]);

  /** ذخیره اطلاعات پروفایل (نام نمایشی در بک‌اند، بقیه در تنظیمات) */
  const saveProfile = useCallback(async ({ displayName, fullName, bio }) => {
    const p = await patchProfile({
      display_name: displayName,
      preferences: { ...(profile?.preferences || {}), fullName, bio, profileUpdatedAt: new Date().toISOString() },
    });
    await refreshUser();
    return p;
  }, [profile, patchProfile, refreshUser]);

  const setAvatar = useCallback(async (dataUrl) => {
    await savePreferences({ avatar: dataUrl });
  }, [savePreferences]);

  const clearAvatar = useCallback(async () => {
    await savePreferences({ avatar: '' });
  }, [savePreferences]);

  const markNotificationsRead = useCallback(async (ids) => {
    const merged = [...new Set([...(prefs.notificationRead || []), ...ids])].slice(-200);
    await savePreferences({ notificationRead: merged });
  }, [prefs.notificationRead, savePreferences]);

  const exportBackup = useCallback(() => ({
    app: 'Finova',
    schema: 'finova-backup-v1',
    version: 2,
    exportedAt: new Date().toISOString(),
    profile: {
      displayName: profile?.displayName || '',
      email: profile?.email || '',
      preferences: profile?.preferences || {},
    },
    categories: categories.map((c) => ({ name: c.name, type: c.type, is_default: !!c.is_default })),
    transactions: transactions.map((t) => ({
      type: t.type,
      title: t.title,
      amount: t.amount,
      transaction_date: t.date,
      category: t.category,
      payment_method: t.method,
      description: t.description,
    })),
    budgets: budgets.map((b) => ({
      category: b.category,
      year: b.year,
      month: b.monthNum,
      amount: b.limit,
      title: b.title,
    })),
  }), [profile, categories, transactions, budgets]);

  const clearAllData = useCallback(async () => {
    for (const t of transactions) { await api.deleteTransaction(t.apiId); }
    for (const b of budgets) { await api.deleteBudget(b.apiId); }
    await patchProfile({
      display_name: 'کاربر Finova',
      preferences: {
        ...(profile?.preferences || {}),
        annualGoal: 0,
        notificationRead: [],
        fullName: '',
        bio: '',
        avatar: '',
        budgetTitles: {},
        budgetNotes: {},
        dateFormat: 'numeric',
        profileUpdatedAt: '',
      },
    });
    setTransactions([]);
    setBudgets([]);
    await refreshUser();
  }, [transactions, budgets, profile, patchProfile, refreshUser]);

  const importBackup = useCallback(async (snap) => {
    if (!snap || !Array.isArray(snap.transactions) || !Array.isArray(snap.budgets) || !Array.isArray(snap.categories)) {
      throw new Error('ساختار فایل پشتیبان معتبر نیست.');
    }
    // حذف داده‌های فعلی
    for (const t of transactions) { await api.deleteTransaction(t.apiId); }
    for (const b of budgets) { await api.deleteBudget(b.apiId); }

    // ساخت دسته‌های لازم
    const wanted = new Map();
    snap.categories.forEach((c) => { if (c && c.name && (c.type === 'income' || c.type === 'expense')) wanted.set(`${c.type}|${c.name}`, c); });
    const byKey = new Map(categories.map((c) => [`${c.type}|${c.name}`, c]));
    const createdCats = [];
    for (const [key, c] of wanted) {
      if (byKey.has(key)) { createdCats.push(byKey.get(key)); continue; }
      const created = await api.createCategory({ name: c.name, type: c.type });
      createdCats.push(created); byKey.set(key, created);
    }
    const catMap = new Map(createdCats.map((c) => [`${c.type}|${c.name}`, c]));

    // بودجه‌ها
    const budgetTitles = {};
    const newBudgets = [];
    for (const b of snap.budgets) {
      const cat = catMap.get(`expense|${b.category}`);
      if (!cat || !(b.amount > 0)) continue;
      try {
        const created = await api.createBudget({ category_id: cat.id, year: b.year, month: b.month, amount: Math.round(b.amount) });
        newBudgets.push(created);
        if (b.title && b.title !== b.category) budgetTitles[budgetTitleKey(cat.id, b.year, b.month)] = b.title;
      } catch (e) { /* بودجه تکراری رد می‌شود */ }
    }

    // تراکنش‌ها
    const newTx = [];
    for (const t of snap.transactions) {
      if (!(t.amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(t.transaction_date || '')) continue;
      const cat = catMap.get(`${t.type}|${t.category}`);
      try {
        const created = await api.createTransaction({
          type: t.type, title: t.title, amount: Math.round(t.amount),
          transaction_date: t.transaction_date, category_id: cat ? cat.id : null,
          payment_method: t.payment_method || null, description: t.description || null,
        });
        newTx.push(created);
      } catch (e) { /* ردیف نامعتبر رد می‌شود */ }
    }

    const mergedPrefs = { ...DEFAULT_PREFS, ...(profile?.preferences || {}), ...(snap.profile?.preferences || {}), budgetTitles, categoriesSeeded: true };
    const p = normalizeProfile(await api.updateProfile({
      display_name: snap.profile?.displayName || profile?.displayName || '',
      preferences: mergedPrefs,
    }));
    setProfile(p);
    setCategories(createdCats);
    const cmap = new Map(createdCats.map((c) => [c.id, c.name]));
    setTransactions(newTx.map((x) => mapTransaction(x, cmap)));
    setBudgets(newBudgets.map((x) => mapBudget(x, cmap, mergedPrefs)));
    await refreshUser();
    return { transactions: newTx.length, budgets: newBudgets.length };
  }, [transactions, budgets, categories, profile, refreshUser]);

  const selectedAvatar = useMemo(() => {
    if (prefs.avatar) return prefs.avatar;
    return null;
  }, [prefs.avatar]);

  const value = useMemo(() => ({
    loading, ready, error,
    profile, prefs, categories, transactions, budgets,
    avatar: selectedAvatar,
    displayName: profile?.displayName || '',
    email: profile?.email || '',
    refresh,
    loadAll,
    savePreferences,
    saveProfile,
    setAvatar,
    clearAvatar,
    markNotificationsRead,
    addTransaction,
    updateTransaction,
    removeTransaction,
    addBudget,
    updateBudget,
    removeBudget,
    exportBackup,
    importBackup,
    clearAllData,
    categoriesFor: (type) => inCanonicalOrder(categories.filter((c) => c.type === type), type),
    categoryIdFor: (type, name) => categories.find((c) => c.type === type && c.name === name)?.id ?? null,
  }), [loading, ready, error, profile, prefs, categories, transactions, budgets, selectedAvatar,
    refresh, loadAll, savePreferences, saveProfile, setAvatar, clearAvatar, markNotificationsRead,
    addTransaction, updateTransaction, removeTransaction, addBudget, updateBudget, removeBudget,
    exportBackup, importBackup, clearAllData]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}
