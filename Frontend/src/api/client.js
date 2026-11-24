/** کلاینت API فینووا — نشست امن فقط در Cookie HttpOnly نگه داشته می‌شود. */
const host = window.location.hostname || '127.0.0.1';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${host}:8000`;

function readCookie(name) {
  const prefix = `${name}=`;
  const item = document.cookie.split(';').map((x) => x.trim()).find((x) => x.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

function normalizeError(detail, fallback = 'خطا در ارتباط با سرور.') {
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const first = detail[0];
    if (first && typeof first.msg === 'string') return first.msg;
  }
  if (typeof detail === 'object' && typeof detail.msg === 'string') return detail.msg;
  return fallback;
}

export async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrf = readCookie('finova_csrf');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
    });
  } catch (err) {
    throw new Error('ارتباط با سرور برقرار نشد. مطمئن شوید بک‌اند در حال اجراست.');
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  } else {
    data = await response.text();
  }
  if (!response.ok) {
    throw new Error(normalizeError(typeof data === 'object' && data !== null ? data.detail : data));
  }
  return data;
}

export const api = {
  request,
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email, password, displayName) => request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, display_name: displayName }),
  }),
  me: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }).catch(() => null),

  listTransactions: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, v); });
    const q = qs.toString();
    return request(`/api/transactions${q ? `?${q}` : ''}`);
  },
  async allTransactions() {
    const PAGE = 200;
    let offset = 0;
    const out = [];
    for (;;) {
      const chunk = await api.listTransactions({ limit: PAGE, offset });
      out.push(...chunk);
      if (chunk.length < PAGE) break;
      offset += PAGE;
    }
    return out;
  },
  createTransaction: (data) => request('/api/transactions', { method: 'POST', body: JSON.stringify(data) }),
  updateTransaction: (id, data) => request(`/api/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTransaction: (id) => request(`/api/transactions/${id}`, { method: 'DELETE' }),

  listCategories: () => request('/api/categories/'),
  createCategory: (data) => request('/api/categories/', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (id, data) => request(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCategory: (id) => request(`/api/categories/${id}`, { method: 'DELETE' }),

  listBudgets: () => request('/api/budgets/'),
  createBudget: (data) => request('/api/budgets/', { method: 'POST', body: JSON.stringify(data) }),
  updateBudget: (id, data) => request(`/api/budgets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBudget: (id) => request(`/api/budgets/${id}`, { method: 'DELETE' }),

  getProfile: () => request('/api/profile/'),
  updateProfile: (data) => request('/api/profile/', { method: 'PATCH', body: JSON.stringify(data) }),
  changePassword: (data) => request('/api/profile/password', { method: 'PATCH', body: JSON.stringify(data) }),
};
