import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { fmt } from '../lib/format.js';

/** شمارنده متحرک داشبورد ـ فقط در نخستین نمایش انیمیشن دارد */
export function Count({ value, animate = true, na = false, naText = 'ـ', duration = 1300, format = fmt.money }) {
  const [text, setText] = useState(() => (na ? naText : format(animate ? 0 : value)));
  const first = useRef(true);
  const raf = useRef(0);

  useEffect(() => {
    if (na) { setText(naText); return undefined; }
    if (!animate || !first.current) { setText(format(value)); return undefined; }
    first.current = false;
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setText(format(value * e));
      if (p < 1) raf.current = requestAnimationFrame(step);
      else setText(format(value));
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, na, naText, animate, duration, format]);

  return <b className="count">{text}</b>;
}

/** برجسته‌سازی عبارت جست‌وجو در متن (مانند util.highlight نسخه قبلی) */
export function Highlight({ text, query }) {
  const s = String(text ?? '');
  const q = String(query || '').trim();
  if (!q) return s;
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const parts = [];
  let last = 0;
  let m;
  let key = 0;
  while ((m = rx.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    parts.push(<mark key={`hl-${key++}`}>{m[0]}</mark>);
    last = m.index + m[0].length;
    if (m[0] === '') rx.lastIndex += 1;
  }
  if (!parts.length) return s;
  if (last < s.length) parts.push(s.slice(last));
  return <>{parts}</>;
}

/** صفحه‌بندی مشترک فهرست‌ها */
export function Pager({ page, pages, total, size, onPage, unit = 'مورد', collapse = false, label }) {
  if (pages <= 1) return <nav className="pager" aria-label={label}></nav>;
  let gap = false;
  const buttons = [];
  for (let p = 1; p <= pages; p += 1) {
    if (collapse && pages > 7 && p !== 1 && p !== pages && Math.abs(p - page) > 1) {
      if (!gap) { buttons.push(<span className="pg-gap" key="gap">…</span>); gap = true; }
      continue;
    }
    gap = false;
    const on = p === page;
    buttons.push(
      <button key={p} type="button" className={`pg${on ? ' on' : ''}`} data-pg={p}
        aria-label={`صفحه ${fmt.digits(p)}`} aria-current={on ? 'page' : undefined}
        onClick={() => onPage(p)}>{fmt.digits(p)}</button>,
    );
  }
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return (
    <nav className="pager" aria-label={label}>
      <span className="pg-info">نمایش {fmt.digits(from)} تا {fmt.digits(to)} از {fmt.digits(total)} {unit}</span>
      <div className="pg-btns">
        <button type="button" className="pg" data-pg={page - 1} disabled={page === 1} aria-label="صفحه قبل" onClick={() => onPage(page - 1)}>
          <Icon name="chevron-right" />
        </button>
        {buttons}
        <button type="button" className="pg" data-pg={page + 1} disabled={page === pages} aria-label="صفحه بعد" onClick={() => onPage(page + 1)}>
          <Icon name="chevron-left" />
        </button>
      </div>
    </nav>
  );
}
