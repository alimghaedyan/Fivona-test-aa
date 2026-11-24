import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Modal } from '../context/UIContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { budgetCalc, dashboardCalc, stats } from '../lib/calc.js';
import { fmt } from '../lib/format.js';
import { jalali as J } from '../lib/jalali.js';
import { util } from '../lib/calc.js';
import { useTheme } from '../lib/theme.js';

const NAV = [
  { to: '/', icon: 'layout-dashboard', label: 'داشبورد', end: true },
  { to: '/income', icon: 'hand-coins', label: 'مدیریت درآمدها' },
  { to: '/expenses', icon: 'receipt', label: 'مدیریت هزینه‌ها' },
  { to: '/budgets', icon: 'pie-chart', label: 'بودجه‌بندی' },
  { to: '/financial-health', icon: 'heart-pulse', label: 'سلامت مالی' },
  { to: '/expense-forecast', icon: 'sparkles', label: 'پیش‌بینی هزینه‌ها' },
  { to: '/reports', icon: 'file-bar-chart', label: 'گزارش‌ها' },
  { to: '/insights', icon: 'network', label: 'تحلیل هوشمند' },
];

const PAGE_TITLES = {
  '/': 'داشبورد | Finova',
  '/income': 'مدیریت درآمدها | Finova',
  '/expenses': 'مدیریت هزینه‌ها | Finova',
  '/budgets': 'بودجه‌بندی | Finova',
  '/financial-health': 'سلامت مالی | Finova',
  '/expense-forecast': 'پیش‌بینی هزینه‌ها | Finova',
  '/reports': 'گزارش‌ها و تحلیل مالی | Finova',
  '/insights': 'تحلیل هوشمند مخارج | Finova',
  '/profile': 'پروفایل کاربری | Finova',
};

function todayLabel() {
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date()).replace('،', '');
}

const SEARCH_TARGETS = {
  '/expenses': { ph: 'جست‌وجوی سریع در هزینه‌ها…', label: 'جست‌وجوی سریع در هزینه‌ها' },
  '/budgets': { ph: 'جست‌وجوی سریع در بودجه‌ها…', label: 'جست‌وجوی سریع در بودجه‌ها' },
  '/reports': { ph: 'جست‌وجو در گزارش تراکنش‌ها…', label: 'جست‌وجو در گزارش تراکنش‌ها' },
  '/income': { ph: 'جست‌وجوی سریع در درآمدها…', label: 'جست‌وجوی سریع در درآمدها' },
};

export default function Layout() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { toast } = useUI();
  const { isDark, toggle } = useTheme();
  const { transactions, budgets, prefs, displayName, avatar, markNotificationsRead, savePreferences } = useData();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalAmount, setGoalAmount] = useState('');
  const [goalError, setGoalError] = useState('');
  const [q, setQ] = useState('');
  const searchRef = useRef(null);

  useEffect(() => {
    document.title = PAGE_TITLES[pathname] || PAGE_TITLES['/'];
    setMenuOpen(false);
    setNotifOpen(false);
    window.scrollTo({ top: 0 });
    const h1 = document.querySelector('.app-view h1');
    if (h1) h1.focus({ preventScroll: true });
  }, [pathname]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('.modal.open')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const target = SEARCH_TARGETS[pathname] || SEARCH_TARGETS['/income'];

  const notifications = useMemo(() => {
    const today = J.todayISO(), key = J.monthKey(today);
    const seen = new Set(prefs.notificationRead || []);
    const rows = budgetCalc.forMonth(transactions, budgets, key).filter((b) => b.status !== 'ok').map((b) => ({
      id: JSON.stringify(['budget', b.id, b.limit, b.spent]),
      text: `${fmt.money(b.spent)} تومان از بودجه «${b.title}» با سقف ${fmt.money(b.limit)} تومان مصرف شده است (${fmt.percent(b.pct)}).`,
      date: budgetCalc.monthLabel(key), icon: 'alert-triangle', tone: 'warn',
    }));
    const recent = transactions
      .filter((x) => x.date <= today)
      .slice()
      .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '') || b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
      .slice(0, 8)
      .map((x) => ({
        id: JSON.stringify(['tx', x.id, x.type, x.amount, x.title, x.date, x.updatedAt]),
        text: `${x.type === 'income' ? 'درآمد' : 'هزینه'} «${x.title}» به مبلغ ${fmt.money(x.amount)} تومان ثبت شده است.`,
        date: `تاریخ تراکنش: ${fmt.date(x.date)}`,
        icon: x.type === 'income' ? 'arrow-down-left' : 'arrow-up-right',
        tone: x.type === 'income' ? 'ok' : 'info',
      }));
    const all = [...rows, ...recent];
    return { all, seen, unread: all.filter((n) => !seen.has(n.id)).length };
  }, [transactions, budgets, prefs.notificationRead]);

  const handleMarkRead = async () => {
    try {
      await markNotificationsRead(notifications.all.map((n) => n.id));
      setNotifOpen(false);
      toast('همه اعلان‌ها خوانده شد.', 'info');
    } catch (e) {
      toast('وضعیت خواندن اعلان‌ها ذخیره نشد.', 'error');
    }
  };

  const goal = useMemo(() => dashboardCalc.goal(transactions, prefs.annualGoal), [transactions, prefs.annualGoal]);

  const openGoal = () => {
    setGoalAmount(prefs.annualGoal ? fmt.money(prefs.annualGoal) : '');
    setGoalError('');
    setGoalOpen(true);
  };

  const submitGoal = async (e) => {
    e.preventDefault();
    const raw = fmt.toLatin(goalAmount).trim().replace(/[,٬\s]/g, '');
    const amount = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setGoalError('مبلغ هدف باید یک عدد صحیح مثبت و معتبر به تومان باشد.');
      return;
    }
    try {
      await savePreferences({ annualGoal: amount });
      setGoalOpen(false);
      toast('هدف پس‌انداز ذخیره شد.');
    } catch (err) {
      setGoalError(err.message || 'ذخیره هدف انجام نشد.');
    }
  };

  const submitSearch = (e) => {
    e.preventDefault();
    const query = q.trim();
    const route = pathname === '/expenses' ? '/expenses' : pathname === '/budgets' ? '/budgets' : pathname === '/reports' ? '/reports' : '/income';
    navigate(`${route}?q=${encodeURIComponent(query)}`);
    setQ('');
    document.activeElement?.blur();
  };

  return (
    <div className="app">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`} id="sidebar" aria-label="منوی اصلی برنامه">
        <NavLink className="brand" to="/" aria-label="Finova ـ بازگشت به داشبورد">
          <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
            <rect width="40" height="40" rx="12" fill="url(#g1)" />
            <path d="M11 26l6-6 4 4 8-9" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="29" cy="15" r="2.6" fill="#fff" />
            <defs><linearGradient id="g1" x1="0" y1="0" x2="40" y2="40"><stop stopColor="#2563eb" /><stop offset="1" stopColor="#10b981" /></linearGradient></defs>
          </svg>
          <div className="brand-text">
            <strong>Finova</strong>
            <span>مدیریت مالی هوشمند</span>
          </div>
        </NavLink>

        <nav className="nav" aria-label="بخش‌های برنامه">
          <span className="nav-label">منوی اصلی</span>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </NavLink>
          ))}
          <span className="nav-label">حساب کاربری</span>
          <NavLink to="/profile" className={({ isActive }) => `nav-item${isActive && new URLSearchParams(search).get('section') !== 'settings' ? ' active' : ''}`}>
            <Icon name="user-round" /><span>پروفایل کاربری</span>
          </NavLink>
          <NavLink to="/profile?section=settings" className={() => `nav-item${pathname === '/profile' && new URLSearchParams(search).get('section') === 'settings' ? ' active' : ''}`}>
            <Icon name="settings" /><span>تنظیمات</span>
          </NavLink>
        </nav>

        <div className="side-promo">
          <div className="promo-icon"><Icon name="target" /></div>
          <strong>هدف پس‌انداز سالانه</strong>
          <p id="goalSummary" aria-live="polite">
            {goal.percent === null
              ? 'برای محاسبه پیشرفت، مبلغ هدف سالانه خود را تعیین کنید.'
              : `${fmt.percent(goal.percent)} از هدف ${fmt.money(goal.target)} تومانی؛ خالص پس‌انداز ثبت‌شده سال ${fmt.digits(goal.year)} تا امروز: ${fmt.money(goal.net)} تومان.`}
          </p>
          <div className="promo-bar" id="goalProgress" role="progressbar" aria-label="پیشرفت هدف سالانه" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(goal.bar)}
            aria-valuetext={goal.percent === null ? 'هنوز هدفی تعیین نشده است.' : `${fmt.percent(goal.percent)} از هدف`}>
            <span id="goalBar" style={{ width: `${goal.bar}%` }} />
          </div>
          <button className="btn ghost" id="goalEdit" type="button" onClick={openGoal}>
            {goal.percent === null ? 'تعیین هدف' : 'ویرایش هدف'}
          </button>
        </div>
      </aside>
      <div className={`overlay${menuOpen ? ' show' : ''}`} id="overlay" onClick={() => setMenuOpen(false)} />

      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" id="menuBtn" aria-label="باز کردن منو" aria-controls="sidebar" aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
          <form className="search" id="globalSearch" role="search" onSubmit={submitSearch}>
            <Icon name="search" />
            <label className="sr-only" htmlFor="globalSearchInput">{target.label}</label>
            <input type="search" id="globalSearchInput" placeholder={target.ph} autoComplete="off" ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} />
            <kbd>/</kbd>
          </form>
          <div className="top-actions">
            <button className="icon-btn theme-btn" type="button" id="themeBtn"
              aria-label={isDark ? 'تغییر به پوسته روشن' : 'تغییر به پوسته تیره'}
              title={isDark ? 'تغییر به پوسته روشن' : 'تغییر به پوسته تیره'}
              aria-pressed={isDark} onClick={toggle}>
              <Icon name={isDark ? 'sun' : 'moon'} />
            </button>
            <div className="date-chip"><Icon name="calendar-days" /><span id="today">{todayLabel()}</span></div>
            <div className="notif-wrap">
              <button className="icon-btn" id="notifBtn" aria-label={notifications.unread ? `اعلان‌ها، ${fmt.digits(notifications.unread)} خوانده‌نشده` : 'اعلان‌ها، بدون اعلان خوانده‌نشده'}
                aria-expanded={notifOpen} aria-controls="notifPanel" onClick={() => setNotifOpen((v) => !v)}>
                <Icon name="bell" />
                <span className="dot" id="notifCount" hidden={!notifications.unread}>{fmt.digits(notifications.unread)}</span>
              </button>
              <div className={`notif-panel${notifOpen ? ' open' : ''}`} id="notifPanel">
                <div className="np-head">
                  <strong>اعلان‌ها</strong>
                  <button id="markRead" onClick={handleMarkRead} disabled={!notifications.unread}>خواندن همه</button>
                </div>
                <div id="notifItems" aria-live="polite">
                  {notifications.all.length ? notifications.all.map((n) => {
                    const seen = notifications.seen.has(n.id);
                    return (
                      <div className={`np-item${seen ? ' is-read' : ''}`} key={n.id}>
                        <span className={`np-ic ${n.tone}`}><Icon name={n.icon} /></span>
                        <div>
                          <p>{n.text}</p>
                          <small>{n.date}{seen ? ' · خوانده‌شده' : ''}</small>
                        </div>
                      </div>
                    );
                  }) : <p className="np-item">اعلانی برای نمایش وجود ندارد.</p>}
                </div>
              </div>
            </div>
            <NavLink className="user" to="/profile" id="userChip" aria-label={`پروفایل کاربری${displayName ? ' ' + displayName : ''}`}>
              <img src={avatar || '/avatar.svg'} alt="" id="userAvatar" />
              <div className="user-meta"><strong id="userName">{displayName || 'کاربر Finova'}</strong><span>حساب کاربری</span></div>
            </NavLink>
          </div>
        </header>

        <section className="content" id="mainContent">
          <Outlet />
          <footer className="foot">© ۱۴۰۵ Finova ـ سامانه مدیریت مالی هوشمند با پیش‌بینی هزینه و امتیاز سلامت مالی ـ پروژه کارشناسی مهندسی نرم‌افزار</footer>
        </section>
      </main>

      {goalOpen && (
        <Modal id="goalDialog" title="هدف پس‌انداز سالانه" onClose={() => setGoalOpen(false)}>
          <form id="goalForm" noValidate onSubmit={submitGoal}>
            <p id="goalHelp">پیشرفت بر اساس مجموع درآمد منهای هزینه‌های ثبت‌شده سال جاری تا امروز محاسبه می‌شود؛ مانده حساب بانکی نیست.</p>
            <label className="fld">
              <span>مبلغ هدف (تومان)</span>
              <input id="goalAmount" inputMode="numeric" autoComplete="off" aria-describedby="goalError goalHelp"
                value={goalAmount} onChange={(e) => setGoalAmount(e.target.value)} aria-invalid={goalError ? 'true' : undefined} />
              <em className="err" id="goalError">{goalError}</em>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setGoalOpen(false)}>انصراف</button>
              <button className="btn primary" type="submit">ذخیره هدف</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
