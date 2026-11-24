import { useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AuthScreen from './components/AuthScreen.jsx';
import Layout from './components/Layout.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { DataProvider, useData } from './context/DataContext.jsx';
import { UIProvider } from './context/UIContext.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Income from './pages/Income.jsx';
import Expenses from './pages/Expenses.jsx';
import Budgets from './pages/Budgets.jsx';
import Health from './pages/Health.jsx';
import Forecast from './pages/Forecast.jsx';
import Reports from './pages/Reports.jsx';
import Profile from './pages/Profile.jsx';
import Insights from './pages/Insights.jsx';

function Loading({ label = 'در حال بارگذاری…' }) {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <span className="app-loading-ring" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function DataGate() {
  const { ready, error, refresh } = useData();
  const { logout } = useAuth();
  const [retrying, setRetrying] = useState(false);

  if (error) {
    return (
      <div className="app-loading app-loading-error" role="alert">
        <strong>بارگذاری داده‌ها انجام نشد.</strong>
        <p>{error}</p>
        <div className="app-loading-actions">
          <button type="button" className="btn primary" disabled={retrying}
            onClick={async () => { setRetrying(true); try { await refresh(); } finally { setRetrying(false); } }}>
            {retrying ? 'در حال تلاش…' : 'تلاش دوباره'}
          </button>
          <button type="button" className="btn ghost" onClick={() => logout()}>خروج از حساب</button>
        </div>
      </div>
    );
  }

  if (!ready) return <Loading label="در حال بارگذاری داده‌های حساب…" />;

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="income" element={<Income />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="budgets" element={<Budgets />} />
          <Route path="financial-health" element={<Health />} />
          <Route path="expense-forecast" element={<Forecast />} />
          <Route path="reports" element={<Reports />} />
          <Route path="insights" element={<Insights />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

function Shell() {
  const { status } = useAuth();

  if (status === 'loading') return <Loading />;
  if (status === 'anon') return <AuthScreen />;

  return (
    <DataProvider>
      <DataGate />
    </DataProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <UIProvider>
        <Shell />
      </UIProvider>
    </AuthProvider>
  );
}
