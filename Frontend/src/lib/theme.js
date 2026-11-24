/* پوسته روشن/تیره ـ ذخیره در مرورگر و همگام با تنظیم سیستم */
import { useCallback, useEffect, useState } from 'react';

const KEY = 'finova:theme';
const DEFAULT_PREF = 'dark';
const META_LIGHT = '#f5f7fb';
const META_DARK = '#0a101c';

export const THEME_OPTIONS = [
  { value: 'light', label: 'روشن', icon: 'sun' },
  { value: 'dark', label: 'تیره', icon: 'moon' },
  { value: 'system', label: 'مطابق سیستم', icon: 'monitor' },
];

const canUseDom = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/** تنظیم ذخیره‌شده؛ در نخستین بازدید پوسته تیره فعال می‌شود */
export function readThemePref() {
  if (!canUseDom()) return DEFAULT_PREF;
  try {
    const saved = window.localStorage.getItem(KEY);
    return THEME_OPTIONS.some((o) => o.value === saved) ? saved : DEFAULT_PREF;
  } catch {
    return DEFAULT_PREF;
  }
}

export function systemTheme() {
  if (!canUseDom() || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(pref) {
  return pref === 'system' ? systemTheme() : pref;
}

/** اعمال پوسته روی ریشه سند و انتشار رویداد برای نمودارها و کامپوننت‌ها */
export function applyTheme(pref, { persist = true } = {}) {
  if (!canUseDom()) return 'light';
  const safePref = THEME_OPTIONS.some((o) => o.value === pref) ? pref : DEFAULT_PREF;
  const theme = resolveTheme(safePref);
  const root = document.documentElement;

  root.dataset.theme = theme;
  root.dataset.themePref = safePref;
  root.style.colorScheme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? META_DARK : META_LIGHT);

  if (persist) {
    try { window.localStorage.setItem(KEY, safePref); } catch { /* حافظه مرورگر در دسترس نیست */ }
  }

  window.dispatchEvent(new CustomEvent('finova:theme', { detail: { theme, pref: safePref } }));
  return theme;
}

/** پیش از رندر اولیه اجرا می‌شود تا پرش رنگ نداشته باشیم */
export function initTheme() {
  return applyTheme(readThemePref(), { persist: false });
}

/** قلاب مشترک: پوسته فعلی، تنظیم انتخابی و تغییر آن */
export function useTheme() {
  const [pref, setPref] = useState(readThemePref);
  const [theme, setTheme] = useState(() => resolveTheme(readThemePref()));

  useEffect(() => {
    const onTheme = (event) => {
      const detail = event.detail || {};
      if (detail.pref) setPref(detail.pref);
      if (detail.theme) setTheme(detail.theme);
    };
    window.addEventListener('finova:theme', onTheme);
    return () => window.removeEventListener('finova:theme', onTheme);
  }, []);

  useEffect(() => {
    if (pref !== 'system' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [pref]);

  const setThemePref = useCallback((value) => applyTheme(value), []);
  const toggle = useCallback(() => applyTheme(theme === 'dark' ? 'light' : 'dark'), [theme]);

  return { pref, theme, isDark: theme === 'dark', setThemePref, toggle };
}
