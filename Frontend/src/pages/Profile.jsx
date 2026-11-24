import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Modal } from '../context/UIContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { fmt } from '../lib/format.js';
import { jalali as J } from '../lib/jalali.js';
import { THEME_OPTIONS, useTheme } from '../lib/theme.js';

const DEFAULT_AVATAR = '/avatar.svg';
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const AVATAR_MAX_FILE = 2 * 1024 * 1024; // ۲ مگابایت
const AVATAR_SIZE = 256;
const AVATAR_MAX = 400000;
const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,/;
const IMPORT_MAX = 10 * 1024 * 1024; // ۱۰ مگابایت
const LIMITS = { fullName: 60, displayName: 30, email: 120, bio: 200 };
const FIELDS = ['fullName', 'displayName', 'bio'];
const SECTION_IDS = { settings: 'pfSettings', data: 'pfData', info: 'pfInfo', about: 'pfAbout' };
const THEME_HINTS = {
  light: 'پس‌زمینه روشن',
  dark: 'پس‌زمینه تیره',
  system: 'مطابق دستگاه',
};

const fa = (n) => fmt.digits(n);
const kb = (bytes) => `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(bytes / 1024)} کیلوبایت`;

/** اعتبارسنجی فرم پروفایل؛ مانند نسخه قبلی */
function validate(d) {
  const e = {};
  const t = (k) => (typeof d[k] === 'string' ? d[k].trim() : '');
  const name = t('fullName');
  const disp = t('displayName');
  const bio = t('bio');
  if (!name) e.fullName = 'نام و نام خانوادگی را وارد کنید.';
  else if (name.length < 2) e.fullName = 'نام و نام خانوادگی باید دست‌کم ۲ نویسه باشد.';
  else if (name.length > LIMITS.fullName) e.fullName = 'نام و نام خانوادگی حداکثر ۶۰ نویسه است.';
  if (!disp) e.displayName = 'نام نمایشی را وارد کنید.';
  else if (disp.length > LIMITS.displayName) e.displayName = 'نام نمایشی حداکثر ۳۰ نویسه است.';
  if (bio.length > LIMITS.bio) e.bio = 'توضیحات کوتاه حداکثر ۲۰۰ نویسه است.';
  return e;
}

const isAvatar = (v) => typeof v === 'string' && v.length <= AVATAR_MAX && AVATAR_RE.test(v);
const isDirtyValues = (v, saved) => FIELDS.some((k) => (v[k] || '').trim() !== (saved[k] || ''));

/** برش مربعی از مرکز و فشرده‌سازی تصویر پروفایل */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

async function processAvatar(file) {
  if (!AVATAR_TYPES.includes(file.type)) throw new Error('فقط تصویرهای با قالب پی‌ان‌جی، جی‌پگ یا وب‌پی پذیرفته می‌شوند.');
  if (!file.size) throw new Error('فایل انتخاب‌شده خالی است.');
  if (file.size > AVATAR_MAX_FILE) throw new Error(`حجم تصویر ${kb(file.size)} است؛ حداکثر حجم مجاز ۲ مگابایت است.`);
  let img;
  try { img = await loadImage(file); } catch (e) { throw new Error('فایل انتخاب‌شده قابل خواندن نیست یا تصویر معتبری نیست.'); }
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  if (s < 48) throw new Error('ابعاد تصویر خیلی کوچک است؛ دست‌کم ۴۸ پیکسل لازم است.');
  const out = Math.min(AVATAR_SIZE, s);
  const c = document.createElement('canvas');
  c.width = c.height = out;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, out, out);
  g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, out, out);
  const url = c.toDataURL('image/jpeg', 0.86);
  if (!isAvatar(url)) throw new Error('تصویر پس از فشرده‌سازی هنوز بزرگ است؛ تصویر دیگری انتخاب کنید.');
  return { url, size: out, bytes: Math.round(url.length * 0.75), original: file.size };
}

function backupFileName() {
  const j = J.fromISO(J.todayISO());
  return `finova-backup-${j.jy}-${String(j.jm).padStart(2, '0')}-${String(j.jd).padStart(2, '0')}.json`;
}

const fail = (error) => ({ ok: false, error });

/** خواندن و اعتبارسنجی کامل متن فایل پشتیبان؛ هیچ داده‌ای تغییر نمی‌کند */
function parseBackup(text) {
  if (typeof text !== 'string' || !text.trim()) return fail('فایل انتخاب‌شده خالی است.');
  if (text.length > IMPORT_MAX) return fail('حجم فایل پشتیبان بیش از حد مجاز (۱۰ مگابایت) است.');
  let o;
  try { o = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { return fail('ساختار فایل قابل خواندن نیست؛ فایل آسیب دیده یا فایل پشتیبان Finova نیست.'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return fail('ساختار فایل معتبر نیست.');
  if (o.app !== 'Finova') return fail('این فایل، نسخه پشتیبان Finova نیست.');
  if (typeof o.exportedAt !== 'string' || isNaN(Date.parse(o.exportedAt))) return fail('زمان تهیه پشتیبان در فایل معتبر نیست.');
  if (!Array.isArray(o.transactions)) return fail('فهرست تراکنش‌ها در فایل وجود ندارد.');
  if (!Array.isArray(o.budgets)) return fail('فهرست بودجه‌ها در فایل وجود ندارد.');
  if (!Array.isArray(o.categories)) return fail('فهرست دسته‌بندی‌ها در فایل وجود ندارد.');
  const badTx = o.transactions.filter((x) => !x || (x.type !== 'income' && x.type !== 'expense')
    || typeof x.title !== 'string' || !(x.amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(x.transaction_date || '')).length;
  if (badTx) return fail(`${fa(badTx)} تراکنش نامعتبر در فایل وجود دارد؛ برای جلوگیری از ورود داده ناقص، بازیابی انجام نشد.`);
  const badB = o.budgets.filter((x) => !x || typeof x.category !== 'string' || !(x.amount > 0)
    || !Number.isInteger(x.year) || !Number.isInteger(x.month)).length;
  if (badB) return fail(`${fa(badB)} بودجه نامعتبر در فایل وجود دارد؛ بازیابی انجام نشد.`);
  const dates = o.transactions.map((x) => x.transaction_date).sort();
  const preferences = o.profile && typeof o.profile.preferences === 'object' && o.profile.preferences ? o.profile.preferences : {};
  return {
    ok: true,
    snap: o,
    summary: {
      exportedAt: o.exportedAt,
      transactions: o.transactions.length,
      incomes: o.transactions.filter((x) => x.type === 'income').length,
      expenses: o.transactions.filter((x) => x.type === 'expense').length,
      budgets: o.budgets.length,
      name: (o.profile && o.profile.displayName) || '',
      hasAvatar: !!preferences.avatar,
      from: dates[0] || null,
      to: dates[dates.length - 1] || null,
    },
  };
}

export default function Profile() {
  const {
    profile, prefs, displayName, email, avatar,
    transactions, budgets,
    saveProfile, savePreferences, setAvatar, clearAvatar,
    exportBackup, importBackup, clearAllData,
  } = useData();
  const { toast, confirm } = useUI();
  const { logout } = useAuth();
  const { pref: themePref, setThemePref } = useTheme();
  const [searchParams] = useSearchParams();

  const saved = useMemo(() => ({
    fullName: prefs.fullName || '',
    displayName: displayName || '',
    bio: prefs.bio || '',
  }), [prefs.fullName, displayName, prefs.bio]);

  const savedRef = useRef(saved);
  savedRef.current = saved;

  const [form, setForm] = useState(saved);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  const [importError, setImportError] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const [clearChecked, setClearChecked] = useState(false);

  const avatarFileRef = useRef(null);
  const importFileRef = useRef(null);
  const fullNameRef = useRef(null);

  /* همگام‌سازی فرم با اطلاعات ذخیره‌شده، بدون از بین بردن تغییرات کاربر */
  const prevSaved = useRef(saved);
  useEffect(() => {
    const before = prevSaved.current;
    prevSaved.current = saved;
    setForm((cur) => (isDirtyValues(cur, before) ? cur : saved));
  }, [saved]);

  /* پیمایش به بخش انتخاب‌شده از نشانی صفحه */
  const paramsKey = searchParams.toString();
  useEffect(() => {
    const id = SECTION_IDS[searchParams.get('section') || ''];
    if (!id) return;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  const dirty = isDirtyValues(form, saved);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const focusField = (key) => {
    if (key === 'fullName') fullNameRef.current?.focus();
    else document.getElementById(`pf${key.charAt(0).toUpperCase()}${key.slice(1)}`)?.focus();
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      focusField(FIELDS.find((k) => errs[k]));
      toast('لطفاً خطاهای فرم را برطرف کنید.', 'error');
      return;
    }
    setSaving(true);
    try {
      const next = {
        fullName: form.fullName.trim(),
        displayName: form.displayName.trim(),
        bio: form.bio.trim(),
      };
      await saveProfile(next);
      setForm(next);
      setErrors({});
      toast('اطلاعات پروفایل ذخیره شد.');
    } catch (err) {
      toast(err.message || 'ذخیره اطلاعات پروفایل انجام نشد.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setForm(saved);
    setErrors({});
    toast('تغییرات لغو شد و اطلاعات ذخیره‌شده بازگردانده شد.', 'info');
  };

  const scrollToInfo = () => {
    document.getElementById('pfInfo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => fullNameRef.current?.focus({ preventScroll: true }), 250);
  };

  const onAvatarFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      setAvatarPreview(await processAvatar(file));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const saveAvatar = async () => {
    try {
      await setAvatar(avatarPreview.url);
      setAvatarPreview(null);
      toast('تصویر پروفایل در حساب کاربری ذخیره شد.');
    } catch (err) {
      toast(err.message || 'ذخیره تصویر پروفایل انجام نشد.', 'error');
    }
  };

  const resetAvatar = async () => {
    const ok = await confirm({
      title: 'بازگردانی تصویر پیش‌فرض',
      message: 'تصویر انتخاب‌شده حذف و تصویر پیش‌فرض Finova نمایش داده می‌شود.',
      confirmText: 'بازگردانی تصویر پیش‌فرض',
    });
    if (!ok) return;
    try {
      await clearAvatar();
      toast('تصویر پیش‌فرض پروفایل بازگردانده شد.', 'info');
    } catch (err) {
      toast(err.message || 'حذف تصویر پروفایل انجام نشد.', 'error');
    }
  };

  const changeDateFormat = async (value) => {
    try {
      await savePreferences({ dateFormat: value });
      toast(`قالب نمایش تاریخ به «${value === 'long' ? 'با نام ماه' : 'عددی'}» تغییر کرد و در همه صفحه‌ها اعمال شد.`);
    } catch (err) {
      toast(err.message || 'ذخیره تنظیمات انجام نشد.', 'error');
    }
  };

  /* ---------- پشتیبان‌گیری ---------- */
  const snapshot = useMemo(() => exportBackup(), [exportBackup]);
  const backupJson = useMemo(() => JSON.stringify(snapshot, null, 2), [snapshot]);

  const exportBackupFile = () => {
    try {
      const blob = new Blob([backupJson], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`فایل پشتیبان دریافت شد: ${fa(snapshot.transactions.length)} تراکنش و ${fa(snapshot.budgets.length)} بودجه.`);
      return true;
    } catch (e) {
      toast('ساخت فایل پشتیبان انجام نشد. دوباره تلاش کنید.', 'error');
      return false;
    }
  };

  /* ---------- بازیابی ---------- */
  const onImportFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setImportError('');
    if (file.size > IMPORT_MAX) {
      setImportError('حجم فایل بیش از ۱۰ مگابایت است و نمی‌تواند پشتیبان Finova باشد.');
      toast('فایل پشتیبان پذیرفته نشد.', 'error');
      return;
    }
    let text;
    try { text = await file.text(); } catch (err) {
      setImportError('خواندن فایل انجام نشد.');
      toast('فایل پشتیبان پذیرفته نشد.', 'error');
      return;
    }
    const r = parseBackup(text);
    if (!r.ok) {
      setImportError(r.error + ' هیچ داده‌ای تغییر نکرد.');
      toast('فایل پشتیبان پذیرفته نشد؛ داده‌های فعلی دست‌نخورده باقی ماند.', 'error');
      return;
    }
    setPendingImport({ ...r, fileName: file.name });
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    try {
      const res = await importBackup(pendingImport.snap);
      const n = res.transactions;
      const b = res.budgets;
      setPendingImport(null);
      toast(`بازیابی انجام شد: ${fa(n)} تراکنش و ${fa(b)} بودجه جایگزین شد.`);
    } catch (err) {
      toast(err.message || 'بازیابی داده‌ها انجام نشد.', 'error');
    }
  };

  /* ---------- پاک کردن همه داده‌ها ---------- */
  const openClear = () => {
    setClearChecked(false);
    setClearOpen(true);
  };

  const confirmClear = async () => {
    if (!clearChecked) return;
    try {
      await clearAllData();
      setClearOpen(false);
      setClearChecked(false);
      setForm({ fullName: '', displayName: '', bio: '' });
      toast('همه داده‌های Finova از حساب کاربری پاک شد و برنامه به حالت اولیه خالی بازگشت.');
      setTimeout(() => fullNameRef.current?.focus(), 0);
    } catch (err) {
      toast(err.message || 'پاک کردن کامل انجام نشد.', 'error');
    }
  };

  const handleLogout = async () => {
    const ok = await confirm({
      title: 'خروج از حساب کاربری',
      message: 'برای ورود دوباره باید ایمیل و رمز عبور خود را وارد کنید.',
      confirmText: 'خروج از حساب',
      danger: false,
    });
    if (!ok) return;
    try {
      await logout();
      toast('از حساب کاربری خارج شدید.', 'info');
    } catch (err) {
      toast(err.message || 'خروج از حساب انجام نشد.', 'error');
    }
  };

  /* ---------- داده‌های نمایش ---------- */
  const incCount = transactions.filter((x) => x.type === 'income').length;
  const today = J.todayISO();
  const statItems = [
    ['تراکنش‌ها', `${fa(transactions.length)} مورد`, `${fa(incCount)} درآمد و ${fa(transactions.length - incCount)} هزینه`],
    ['بودجه‌ها', `${fa(budgets.length)} مورد`, 'بودجه‌های ماهانه'],
    ['تصویر پروفایل', avatar ? 'انتخاب شده' : 'پیش‌فرض', avatar ? 'ذخیره در حساب کاربری' : 'تصویری ذخیره نشده'],
    ['حجم داده‌های Finova', `≈ ${kb(new Blob([backupJson]).size)}`, 'بر اساس داده‌های حساب کاربری'],
  ];

  return (
    <div className="app-view" id="view-profile">
      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <ol>
          <li><Link to="/"><Icon name="home" />داشبورد</Link></li>
          <li aria-hidden="true" className="sep">/</li>
          <li aria-current="page">پروفایل کاربری</li>
        </ol>
      </nav>

      <div className="page-head">
        <div>
          <h1 tabIndex="-1">پروفایل کاربری</h1>
          <p>اطلاعات حساب و تنظیمات شخصی خود را مدیریت کنید.</p>
        </div>
      </div>

      {/* کارت خلاصه پروفایل */}
      <section className="card pf-overview" aria-labelledby="pfOvName">
        <div className="pf-avatar">
          <img src={avatar || DEFAULT_AVATAR} alt={avatar ? 'تصویر پروفایل انتخاب‌شده' : 'تصویر پیش‌فرض پروفایل'} width="104" height="104" />
          <button type="button" className="pf-avatar-btn" id="pfAvatarCam" aria-label="انتخاب تصویر پروفایل"
            onClick={() => avatarFileRef.current?.click()}><Icon name="camera" /></button>
        </div>
        <div className="pf-ov-body">
          <div className="pf-ov-title">
            <h2 id="pfOvName" className={prefs.fullName ? '' : 'muted'}>{prefs.fullName || 'نامی ثبت نشده است'}</h2>
            <span className="pf-badge"><Icon name="shield-check" />حساب کاربری</span>
          </div>
          <p className="pf-ov-line" id="pfOvDisplay">{displayName ? `نام نمایشی: ${displayName}` : 'نام نمایشی ثبت نشده است.'}</p>
          {email && (
            <p className="pf-ov-line pf-ov-email" id="pfOvEmail"><Icon name="mail" /><bdi id="pfOvEmailTxt" dir="ltr">{email}</bdi></p>
          )}
          {prefs.bio && <p className="pf-ov-bio" id="pfOvBio">{prefs.bio}</p>}
          <p className="pf-ov-meta" id="pfOvMeta">
            {prefs.profileUpdatedAt
              ? `آخرین ذخیره پروفایل: ${fmt.stamp(prefs.profileUpdatedAt)}`
              : 'اطلاعات پروفایل هنوز ذخیره نشده است.'}
          </p>
        </div>
        <div className="pf-ov-actions">
          <button type="button" className="btn primary" id="pfEditBtn" onClick={scrollToInfo}><Icon name="pencil" />ویرایش اطلاعات</button>
          <button type="button" className="btn ghost" id="pfAvatarPick" onClick={() => avatarFileRef.current?.click()}><Icon name="image-plus" />انتخاب تصویر</button>
          {avatar && (
            <button type="button" className="btn ghost" id="pfAvatarReset" onClick={resetAvatar}><Icon name="rotate-ccw" />تصویر پیش‌فرض</button>
          )}
        </div>
        <input type="file" id="pfAvatarFile" className="sr-only" accept="image/png,image/jpeg,image/webp" tabIndex="-1" aria-hidden="true"
          ref={avatarFileRef} onChange={onAvatarFile} />
      </section>

      <div className="pf-grid">
        {/* اطلاعات شخصی */}
        <section className="card pf-card" id="pfInfo" aria-labelledby="pfInfoTitle">
          <div className="card-head">
            <div>
              <h2 id="pfInfoTitle"><Icon name="user-round-pen" />اطلاعات شخصی</h2>
              <p>این اطلاعات برای شخصی‌سازی نمایش برنامه در حساب کاربری شما ذخیره می‌شود.</p>
            </div>
          </div>
          <form id="pfForm" noValidate onSubmit={submit}>
            <div className="form-grid">
              <div className={`fld${errors.fullName ? ' has-err' : ''}`}>
                <label htmlFor="pfFullName">نام و نام خانوادگی <b className="req" aria-hidden="true">*</b></label>
                <input id="pfFullName" name="fullName" maxLength="60" autoComplete="name" aria-required="true"
                  aria-describedby="pfFullNameErr" aria-invalid={errors.fullName ? 'true' : undefined}
                  placeholder="مثلاً سارا محمدی" ref={fullNameRef}
                  value={form.fullName} onChange={(e) => setField('fullName', e.target.value)} />
                <em className="err" id="pfFullNameErr">{errors.fullName || ''}</em>
              </div>
              <div className={`fld${errors.displayName ? ' has-err' : ''}`}>
                <label htmlFor="pfDisplayName">نام نمایشی <b className="req" aria-hidden="true">*</b></label>
                <input id="pfDisplayName" name="displayName" maxLength="30" autoComplete="nickname" aria-required="true"
                  aria-describedby="pfDisplayNameHint pfDisplayNameErr" aria-invalid={errors.displayName ? 'true' : undefined}
                  placeholder="مثلاً سارا"
                  value={form.displayName} onChange={(e) => setField('displayName', e.target.value)} />
                <small className="hint" id="pfDisplayNameHint">در سربرگ و پیام خوش‌آمدگویی داشبورد نمایش داده می‌شود.</small>
                <em className="err" id="pfDisplayNameErr">{errors.displayName || ''}</em>
              </div>
              <div className="fld span2">
                <label htmlFor="pfEmail">ایمیل حساب کاربری</label>
                <input id="pfEmail" name="email" type="email" dir="ltr" maxLength="120" autoComplete="email" inputMode="email"
                  aria-describedby="pfEmailHint" value={email} readOnly />
                <small className="hint" id="pfEmailHint">ایمیل حساب کاربری شماست و از این بخش قابل تغییر نیست.</small>
              </div>
              <div className={`fld span2${errors.bio ? ' has-err' : ''}`}>
                <label htmlFor="pfBio">توضیحات کوتاه <span className="opt">(اختیاری)</span></label>
                <textarea id="pfBio" name="bio" rows="3" maxLength="200" aria-describedby="pfBioCount pfBioErr"
                  aria-invalid={errors.bio ? 'true' : undefined}
                  placeholder="مثلاً هدف مالی امسال: پس‌انداز برای خرید خودرو"
                  value={form.bio} onChange={(e) => setField('bio', e.target.value)} />
                <small className="hint counter" id="pfBioCount">{fa(form.bio.length)} از {fa(LIMITS.bio)} نویسه</small>
                <em className="err" id="pfBioErr">{errors.bio || ''}</em>
              </div>
            </div>
            <div className="pf-form-foot">
              <span className={`pf-dirty${dirty ? ' on' : ''}`} id="pfDirty" aria-live="polite">
                {dirty ? 'تغییرات ذخیره‌نشده دارید.' : 'تغییر ذخیره‌نشده‌ای وجود ندارد.'}
              </span>
              <div className="pf-form-btns">
                <button type="button" className="btn ghost" id="pfCancel" disabled={!dirty} onClick={cancelEdit}>انصراف</button>
                <button type="submit" className="btn primary" id="pfSave" disabled={!dirty || saving}>
                  <Icon name="check" />{saving ? 'در حال ذخیره…' : 'ذخیره تغییرات'}
                </button>
              </div>
            </div>
          </form>
        </section>

        {/* تنظیمات برنامه */}
        <section className="card pf-card" id="pfSettings" aria-labelledby="pfSettingsTitle">
          <div className="card-head">
            <div>
              <h2 id="pfSettingsTitle"><Icon name="settings" />تنظیمات برنامه</h2>
              <p>تنظیمات در حساب کاربری شما ذخیره می‌شوند و بلافاصله در همه صفحه‌ها اعمال می‌شوند.</p>
            </div>
          </div>
          <fieldset className="pf-set">
            <legend>قالب نمایش تاریخ</legend>
            <p className="pf-set-desc">در جدول‌ها و فهرست تراکنش‌های داشبورد، درآمدها، هزینه‌ها و گزارش‌ها اعمال می‌شود. فیلدهای ورود تاریخ همیشه عددی می‌مانند.</p>
            <div className="pf-radios">
              <label className="pf-radio">
                <input type="radio" name="dateFormat" value="numeric" checked={prefs.dateFormat !== 'long'}
                  onChange={() => changeDateFormat('numeric')} />
                <span><b>عددی</b><em id="pfDateExNum">{fmt.dateInput(today)}</em></span>
              </label>
              <label className="pf-radio">
                <input type="radio" name="dateFormat" value="long" checked={prefs.dateFormat === 'long'}
                  onChange={() => changeDateFormat('long')} />
                <span><b>با نام ماه</b><em id="pfDateExLong">{fmt.dateLong(today)}</em></span>
              </label>
            </div>
          </fieldset>
          <div className="pf-set pf-set-row">
            <div>
              <strong>واحد پول</strong>
              <p className="pf-set-desc">همه مبالغ به تومان ثبت و نمایش داده می‌شوند. تبدیل واحد پول در این نسخه پشتیبانی نمی‌شود، به همین دلیل گزینه دیگری ارائه نشده است.</p>
            </div>
            <span className="pf-fixed">تومان</span>
          </div>
          <div className="pf-set pf-set-row">
            <div>
              <strong>ارقام</strong>
              <p className="pf-set-desc">اعداد در سراسر Finova با ارقام فارسی نمایش داده می‌شوند. در فیلدهای ورودی، ارقام فارسی و لاتین هر دو پذیرفته می‌شوند.</p>
            </div>
            <span className="pf-fixed">فارسی</span>
          </div>
          <fieldset className="pf-set">
            <legend>پوسته</legend>
            <p className="pf-set-desc">رنگ‌بندی برنامه را انتخاب کنید. گزینه «مطابق سیستم» رنگ را خودکار با تنظیم روشن/تیره دستگاه هماهنگ می‌کند. این گزینه فقط در همین مرورگر ذخیره می‌شود.</p>
            <div className="pf-radios pf-radios-3">
              {THEME_OPTIONS.map((opt) => (
                <label className="pf-radio" key={opt.value}>
                  <input type="radio" name="themePref" value={opt.value}
                    checked={themePref === opt.value} onChange={() => setThemePref(opt.value)} />
                  <span>
                    <b><Icon name={opt.icon} />{opt.label}</b>
                    <em>{THEME_HINTS[opt.value]}</em>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      </div>

      {/* حریم خصوصی و مدیریت داده‌ها */}
      <section className="card pf-card" id="pfData" aria-labelledby="pfDataTitle">
        <div className="card-head">
          <div>
            <h2 id="pfDataTitle"><Icon name="shield-check" />حریم خصوصی و مدیریت داده‌ها</h2>
            <p>داده‌های شما در اختیار خودتان است؛ از آن پشتیبان بگیرید، بازیابی کنید یا به‌طور کامل پاکش کنید.</p>
          </div>
        </div>
        <div className="pf-note">
          <Icon name="server" />
          <p>این نسخه از Finova به سرور متصل است و پروفایل، تراکنش‌ها، بودجه‌ها و تنظیمات در حساب کاربری شما ذخیره می‌شوند. برای نگهداری نسخه مستقل یا انتقال داده، به‌طور منظم فایل پشتیبان بگیرید. فایل پشتیبان رمزگذاری نمی‌شود؛ آن را در جای امن نگه دارید.</p>
        </div>
        <dl className="pf-stats" id="pfStats">
          {statItems.map(([title, value, sub]) => (
            <div key={title}>
              <dt>{title}</dt>
              <dd><b>{value}</b><small>{sub}</small></dd>
            </div>
          ))}
        </dl>
        <div className="pf-actions">
          <article className="pf-action">
            <span className="pf-action-ic"><Icon name="download" /></span>
            <h3>دریافت نسخه پشتیبان</h3>
            <p>پروفایل، تصویر پروفایل، همه تراکنش‌ها، بودجه‌ها و تنظیمات در یک فایل ذخیره می‌شود. این فایل فقط داده‌های Finova را دارد.</p>
            <button type="button" className="btn primary" id="pfExport" onClick={exportBackupFile}><Icon name="download" />دریافت فایل پشتیبان</button>
          </article>
          <article className="pf-action">
            <span className="pf-action-ic"><Icon name="upload" /></span>
            <h3>بازیابی از نسخه پشتیبان</h3>
            <p>فایل پشتیبان Finova پیش از اعمال بررسی می‌شود و خلاصه آن را می‌بینید. داده‌ها فقط پس از تأیید شما جایگزین می‌شوند.</p>
            <button type="button" className="btn ghost" id="pfImportBtn" onClick={() => importFileRef.current?.click()}><Icon name="file-up" />انتخاب فایل پشتیبان</button>
            {importError && <p className="pf-import-err" id="pfImportErr" role="alert">{importError}</p>}
            <input type="file" id="pfImportFile" className="sr-only" accept=".json,application/json" tabIndex="-1" aria-hidden="true"
              ref={importFileRef} onChange={onImportFile} />
          </article>
          <article className="pf-action danger">
            <span className="pf-action-ic"><Icon name="trash-2" /></span>
            <h3>پاک کردن همه داده‌های Finova</h3>
            <p>همه پروفایل، تراکنش‌ها، بودجه‌ها و تنظیمات Finova برای همیشه از حساب کاربری شما حذف می‌شوند. دسته‌بندی‌ها و سایر اطلاعات حساب دست‌نخورده می‌مانند.</p>
            <button type="button" className="btn danger-ghost" id="pfClearBtn" onClick={openClear}><Icon name="trash-2" />پاک کردن همه داده‌ها</button>
          </article>
        </div>
      </section>

      <div className="pf-grid">
        {/* حساب کاربری و امنیت */}
        <section className="card pf-card" id="pfSecurity" aria-labelledby="pfSecTitle">
          <div className="card-head">
            <div>
              <h2 id="pfSecTitle"><Icon name="lock-keyhole" />حساب کاربری و امنیت</h2>
              <p>وضعیت واقعی حساب در نسخه فعلی</p>
            </div>
            <span className="pf-badge"><Icon name="shield-check" />حساب امن</span>
          </div>
          <ul className="pf-list">
            <li><Icon name="log-in" /><span>ورود به Finova با ایمیل و رمز عبور انجام می‌شود و نشست شما در یک کوکی امن سمت سرور نگهداری می‌شود.</span></li>
            <li><Icon name="server" /><span>تراکنش‌ها، بودجه‌ها، دسته‌بندی‌ها و تنظیمات در حساب کاربری شما روی سرور Finova ذخیره می‌شوند و بین دستگاه‌های مختلف در دسترس‌اند.</span></li>
            <li><Icon name="eye" /><span>هر کسی که به حساب کاربری شما دسترسی داشته باشد، می‌تواند داده‌های Finova را ببیند. رمز عبور خود را در اختیار دیگران قرار ندهید.</span></li>
            <li><Icon name="file-lock-2" /><span>فایل پشتیبان رمزگذاری نمی‌شود؛ آن را در جای امن نگه دارید.</span></li>
          </ul>
          <button type="button" className="btn ghost" id="pfLogout" onClick={handleLogout}><Icon name="log-out" />خروج از حساب کاربری</button>
        </section>

        {/* درباره Finova */}
        <section className="card pf-card" id="pfAbout" aria-labelledby="pfAboutTitle">
          <div className="card-head">
            <div>
              <h2 id="pfAboutTitle"><Icon name="info" />درباره Finova</h2>
              <p>سامانه مدیریت مالی شخصی</p>
            </div>
          </div>
          <p className="pf-about-desc"><b>Finova</b> یک سامانه مدیریت مالی شخصی فارسی است که با ثبت درآمدها و هزینه‌ها، تصویر روشنی از جریان نقدی، بودجه، سلامت مالی و روند هزینه‌های شما می‌سازد. همه محاسبات روی همان تراکنش‌هایی انجام می‌شود که خودتان ثبت کرده‌اید.</p>
          <h3 className="pf-sub">قابلیت‌های فعلی</h3>
          <ul className="pf-features">
            <li><Link to="/"><Icon name="layout-dashboard" />داشبورد مالی</Link></li>
            <li><Link to="/income"><Icon name="hand-coins" />مدیریت درآمدها</Link></li>
            <li><Link to="/expenses"><Icon name="receipt" />ثبت و پیگیری هزینه‌ها</Link></li>
            <li><Link to="/budgets"><Icon name="pie-chart" />بودجه‌بندی ماهانه</Link></li>
            <li><Link to="/financial-health"><Icon name="heart-pulse" />تحلیل سلامت مالی</Link></li>
            <li><Link to="/expense-forecast"><Icon name="sparkles" />پیش‌بینی هزینه‌ها</Link></li>
            <li><Link to="/reports"><Icon name="file-bar-chart" />گزارش‌ها و تحلیل مالی</Link></li>
            <li><Link to="/profile?section=data"><Icon name="database-backup" />پشتیبان‌گیری و بازیابی داده‌ها</Link></li>
          </ul>
          <p className="pf-about-meta">نوع نسخه: سامانه متصل به سرور با نشست امن</p>
        </section>
      </div>

      {/* پیش‌نمایش تصویر پروفایل */}
      {avatarPreview && (
        <Modal id="avatarDialog" onClose={() => setAvatarPreview(null)} narrow>
          <h3 id="avatarDlgTitle">پیش‌نمایش تصویر پروفایل</h3>
          <img id="avatarDlgImg" className="pf-dlg-avatar" src={avatarPreview.url} alt="پیش‌نمایش تصویر انتخاب‌شده" width="140" height="140" />
          <p className="pf-dlg-info" id="avatarDlgInfo">
            ابعاد ذخیره‌شده: {fa(avatarPreview.size)}×{fa(avatarPreview.size)} پیکسل ـ حجم: {kb(avatarPreview.bytes)} (فایل اصلی {kb(avatarPreview.original)})
          </p>
          <p className="pf-dlg-note">تصویر فشرده و به شکل مربع برش داده می‌شود و در حساب کاربری شما ذخیره می‌شود؛ به هیچ سرور دیگری بارگذاری نمی‌شود.</p>
          <div className="modal-actions center">
            <button type="button" className="btn ghost" onClick={() => setAvatarPreview(null)}>انصراف</button>
            <button type="button" className="btn primary" id="avatarDlgOk" onClick={saveAvatar}><Icon name="check" />ذخیره تصویر</button>
          </div>
        </Modal>
      )}

      {/* پیش‌نمایش بازیابی پشتیبان */}
      {pendingImport && (
        <Modal
          id="importDialog"
          role="alertdialog"
          wide
          onClose={() => setPendingImport(null)}
          labelledBy="importDlgTitle"
          describedBy="importDlgWarn"
          title={(
            <div className="mh-title">
              <span className="mh-ic"><Icon name="file-up" /></span>
              <div>
                <h3 id="importDlgTitle">بازیابی از نسخه پشتیبان</h3>
                <p id="importDlgFile">فایل: {pendingImport.fileName}</p>
              </div>
            </div>
          )}
        >
          <dl className="pf-preview" id="importDlgSummary">
            {[
              ['زمان تهیه پشتیبان', fmt.stamp(pendingImport.summary.exportedAt)],
              ['پروفایل', pendingImport.summary.name || 'بدون نام'],
              ['تراکنش‌ها', `${fa(pendingImport.summary.transactions)} مورد (${fa(pendingImport.summary.incomes)} درآمد، ${fa(pendingImport.summary.expenses)} هزینه)`],
              ['بازه تاریخ تراکنش‌ها', pendingImport.summary.from ? `${fmt.dateLong(pendingImport.summary.from)} تا ${fmt.dateLong(pendingImport.summary.to)}` : 'بدون تراکنش'],
              ['بودجه‌ها', `${fa(pendingImport.summary.budgets)} مورد`],
              ['تصویر پروفایل', pendingImport.summary.hasAvatar ? 'دارد' : 'ندارد'],
            ].map(([title, value]) => (
              <div key={title}><dt>{title}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <p className="pf-warn" id="importDlgWarn">
            با تأیید، همه داده‌های فعلی Finova در این حساب کاربری ({fa(transactions.length)} تراکنش، {fa(budgets.length)} بودجه، پروفایل و تنظیمات) با محتوای این فایل جایگزین می‌شود. این کار قابل بازگشت نیست، مگر اینکه از داده‌های فعلی پشتیبان گرفته باشید.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setPendingImport(null)}>انصراف</button>
            <button type="button" className="btn ghost" id="importDlgBackup" onClick={exportBackupFile}><Icon name="download" />اول از داده‌های فعلی پشتیبان بگیر</button>
            <button type="button" className="btn danger" id="importDlgOk" onClick={confirmImport}><Icon name="replace" />جایگزینی داده‌ها</button>
          </div>
        </Modal>
      )}

      {/* تأیید پاک کردن همه داده‌ها */}
      {clearOpen && (
        <Modal
          id="clearDialog"
          role="alertdialog"
          narrow
          cardClass="pf-clear-card"
          onClose={() => setClearOpen(false)}
          labelledBy="clearDlgTitle"
          describedBy="clearDlgMsg"
        >
          <div className="confirm-ic"><Icon name="alert-triangle" /></div>
          <h3 id="clearDlgTitle">پاک کردن همه داده‌های Finova</h3>
          <div id="clearDlgMsg">
            <p>با این کار، داده‌های زیر برای همیشه از حساب کاربری شما حذف می‌شوند:</p>
            <ul className="pf-clear-list" id="clearDlgList">
              <li>{fa(transactions.length)} تراکنش (درآمد و هزینه)</li>
              <li>{fa(budgets.length)} بودجه</li>
              <li>اطلاعات و تصویر پروفایل</li>
              <li>تنظیمات برنامه</li>
            </ul>
            <p className="pf-warn">این عملیات قابل بازگشت نیست، مگر اینکه پیش‌تر فایل پشتیبان گرفته باشید. دسته‌بندی‌ها و سایر اطلاعات حساب کاربری دست‌نخورده می‌مانند.</p>
          </div>
          <button type="button" className="btn ghost pf-clear-backup" id="clearDlgBackup" onClick={exportBackupFile}><Icon name="download" />دریافت فایل پشتیبان پیش از پاک کردن</button>
          <label className="pf-check">
            <input type="checkbox" id="clearDlgCheck" checked={clearChecked} onChange={(e) => setClearChecked(e.target.checked)} />
            <span>متوجه هستم که این داده‌ها برای همیشه حذف می‌شوند.</span>
          </label>
          <div className="modal-actions center pf-clear-actions">
            <button type="button" className="btn ghost" onClick={() => setClearOpen(false)}>انصراف</button>
            <button type="button" className="btn danger" id="clearDlgOk" disabled={!clearChecked} onClick={confirmClear}>پاک کردن همه داده‌ها</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
