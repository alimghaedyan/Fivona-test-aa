import { useState } from 'react';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../lib/theme.js';

export default function AuthScreen() {
  const { login, register } = useAuth();
  const { isDark, toggle } = useTheme();
  const [mode, setMode] = useState('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('error');
  const [busy, setBusy] = useState(false);

  const switchMode = (next) => {
    setMode(next);
    setMessage('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (mode === 'register' && !displayName.trim()) {
      setMessage('لطفاً نام نمایشی خود را وارد کنید.');
      setMessageType('error');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'register') {
        await register(email.trim(), password, displayName.trim());
      } else {
        await login(email.trim(), password);
      }
    } catch (err) {
      setMessage(err.message || 'ارتباط با سرور برقرار نشد.');
      setMessageType('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="darik-auth-overlay">
      <button type="button" className="auth-theme-btn" id="authThemeBtn"
        aria-pressed={isDark} aria-label={isDark ? 'تغییر به پوسته روشن' : 'تغییر به پوسته تیره'}
        title={isDark ? 'تغییر به پوسته روشن' : 'تغییر به پوسته تیره'} onClick={toggle}>
        <Icon name={isDark ? 'sun' : 'moon'} />
      </button>
      <div className="darik-auth-card">
        <header className="darik-auth-brand">
          <div className="darik-auth-logo">F</div>
          <h1>به Finova خوش آمدید</h1>
          <p>مدیریت هوشمند درآمدها و هزینه‌های شما</p>
        </header>

        <div className="darik-auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} data-mode="login" aria-pressed={mode === 'login'} onClick={() => switchMode('login')}>ورود</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} data-mode="register" aria-pressed={mode === 'register'} onClick={() => switchMode('register')}>ثبت‌نام</button>
        </div>

        <form id="darikAuthForm" onSubmit={submit}>
          <label className="darik-auth-field" id="darikNameField" hidden={mode !== 'register'}>
            <span>نام نمایشی</span>
            <input name="display_name" type="text" maxLength={100} autoComplete="name" required={mode === 'register'}
              value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>

          <label className="darik-auth-field">
            <span>ایمیل</span>
            <input name="email" type="email" required maxLength={254} autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>

          <label className="darik-auth-field">
            <span>رمز عبور</span>
            <input name="password" type="password" required maxLength={128}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>

          <button className="darik-auth-submit" type="submit" disabled={busy}>
            {busy ? 'لطفاً صبر کنید...' : mode === 'register' ? 'ساخت حساب کاربری' : 'ورود به حساب'}
          </button>

          <div className={`darik-auth-message ${message ? messageType : ''}`} id="darikAuthMessage" role="status" aria-live="polite">
            {message}
          </div>
        </form>

        <p className="darik-auth-note">اطلاعات حساب شما از طریق API فینووا مدیریت می‌شود.</p>
      </div>
    </section>
  );
}
