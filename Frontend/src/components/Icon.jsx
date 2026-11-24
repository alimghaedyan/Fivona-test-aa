import * as Lucide from 'lucide-react';

const cache = new Map();
const pascal = (name) => name.split('-').map((s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')).join('');

export function getIcon(name) {
  if (!name) return Lucide.Circle;
  if (cache.has(name)) return cache.get(name);
  const Comp = Lucide[pascal(name)] || Lucide.Circle;
  cache.set(name, Comp);
  return Comp;
}

/** آیکون lucide با نام کباب‌کیسی، مثل data-lucide در نسخه قبلی */
export default function Icon({ name, size, strokeWidth, className, ...rest }) {
  const Comp = getIcon(name);
  return <Comp className={className} size={size} strokeWidth={strokeWidth} aria-hidden="true" {...rest} />;
}
