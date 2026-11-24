import { useEffect, useMemo, useState } from 'react';
import ChartCanvas from './ChartCanvas.jsx';
import Icon from './Icon.jsx';
import { analyticsApi } from '../api/analytics.js';
import { fmt } from '../lib/format.js';

const monthLabel = (key) => {
  const [year, month] = key.split('-').map(Number);
  const names = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  return `${names[month - 1]} ${fmt.digits(year)}`;
};

export default function ProphetForecastPanel({ horizon = 1, categoryId = null }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [includeEvaluation, setIncludeEvaluation] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    analyticsApi.forecast({
      horizon,
      months: 36,
      category_id: categoryId,
      include_evaluation: includeEvaluation,
    }).then((result) => {
      if (alive) setData(result);
    }).catch((err) => {
      if (alive) setError(err.message || 'دریافت پیش‌بینی انجام نشد.');
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [horizon, categoryId, includeEvaluation, refreshKey]);

  const chartData = useMemo(() => ({
    labels: (data?.predictions || []).map((row) => monthLabel(row.period)),
    datasets: [
      {
        label: 'Prophet',
        data: (data?.predictions || []).map((row) => row.yhat / 1e6),
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,.18)',
        borderWidth: 2,
        borderRadius: 8,
      },
      {
        label: 'WMA baseline',
        data: (data?.predictions || []).map((row) => row.wma_baseline == null ? null : row.wma_baseline / 1e6),
        borderColor: '#d97706',
        backgroundColor: 'rgba(217,119,6,.15)',
        borderWidth: 2,
        borderDash: [6, 4],
        type: 'line',
      },
    ],
  }), [data]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
      tooltip: { rtl: true, textDirection: 'rtl', callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt.money(ctx.parsed.y * 1e6)} تومان` } },
    },
    scales: {
      y: { beginAtZero: true, title: { display: true, text: 'میلیون تومان' }, grid: { color: '#eef2f7' } },
      x: { grid: { display: false } },
    },
  }), []);

  const modelLabel = data?.method === 'prophet' ? 'Prophet' : 'میانگین متحرک وزنی (Fallback)';

  return (
    <section className="card prophet-panel" aria-labelledby="prophetPanelTitle">
      <div className="card-head prophet-panel-head">
        <div>
          <div className="prophet-eyebrow"><Icon name="sparkles" /> موتور پیش‌بینی آماری</div>
          <h2 id="prophetPanelTitle">پیش‌بینی هزینه با Prophet</h2>
          <p>پیش‌بینی ماه‌های آینده همراه با مقایسه روش پایه WMA و بازه عدم‌قطعیت</p>
        </div>
        <button className="btn ghost sm" type="button" onClick={() => setRefreshKey((v) => v + 1)} disabled={loading}>
          <Icon name="refresh-cw" /> محاسبه دوباره
        </button>
      </div>

      <div className="prophet-toolbar">
        <span className="prophet-status">روش فعال: <b>{modelLabel}</b></span>
        <label className="prophet-eval-toggle">
          <input type="checkbox" checked={includeEvaluation} onChange={(event) => setIncludeEvaluation(event.target.checked)} />
          ارزیابی Walk-forward
        </label>
      </div>

      {loading && <div className="analytics-state"><span className="app-loading-ring" /> در حال محاسبه پیش‌بینی…</div>}
      {!loading && error && <div className="analytics-error" role="alert"><Icon name="alert-circle" />{error}</div>}
      {!loading && data && (
        <>
          {data.warning && <div className="analytics-notice"><Icon name="info" />{data.warning}</div>}
          <div className="prophet-kpis">
            <article><span>تعداد ماه‌های بررسی‌شده</span><strong>{fmt.digits(data.history_months)}</strong></article>
            <article><span>ماه‌های دارای هزینه</span><strong>{fmt.digits(data.active_months)}</strong></article>
            <article><span>پیش‌بینی ماه آینده</span><strong>{data.predictions[0] ? `${fmt.money(data.predictions[0].yhat)} تومان` : '—'}</strong></article>
            <article><span>فصل‌مندی سالانه</span><strong>{data.yearly_seasonality ? 'فعال' : 'غیرفعال'}</strong></article>
          </div>
          {data.predictions.length > 0 ? (
            <>
              <div className="prophet-chart"><ChartCanvas type="bar" data={chartData} options={chartOptions} ariaLabel="نمودار مقایسه پیش‌بینی Prophet و WMA" /></div>
              <div className="table-wrap">
                <table className="tx prophet-table">
                  <thead><tr><th>ماه</th><th>پیش‌بینی</th><th>حد پایین</th><th>حد بالا</th><th>WMA</th></tr></thead>
                  <tbody>{data.predictions.map((row) => (
                    <tr key={row.period}>
                      <th>{monthLabel(row.period)}</th>
                      <td className="amt">{fmt.money(row.yhat)} تومان</td>
                      <td>{row.lower == null ? '—' : `${fmt.money(row.lower)} تومان`}</td>
                      <td>{row.upper == null ? '—' : `${fmt.money(row.upper)} تومان`}</td>
                      <td>{row.wma_baseline == null ? '—' : `${fmt.money(row.wma_baseline)} تومان`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          ) : <div className="analytics-empty">برای این دسته یا بازه، داده کافی جهت پیش‌بینی وجود ندارد.</div>}
          {data.evaluation && (
            <div className="prophet-evaluation">
              <h3>ارزیابی Walk-forward</h3>
              {data.evaluation.available ? (
                <div className="table-wrap"><table className="tx"><thead><tr><th>روش</th><th>MAE</th><th>RMSE</th><th>WAPE</th><th>نمونه</th></tr></thead><tbody>
                  {['prophet', 'wma'].map((key) => <tr key={key}><th>{key === 'prophet' ? 'Prophet' : 'WMA'}</th><td>{fmt.money(data.evaluation[key].mae || 0)}</td><td>{fmt.money(data.evaluation[key].rmse || 0)}</td><td>{data.evaluation[key].wape == null ? '—' : `${fmt.digits((data.evaluation[key].wape * 100).toFixed(1))}٪`}</td><td>{fmt.digits(data.evaluation[key].samples)}</td></tr>)}
                </tbody></table></div>
              ) : <p className="muted">{data.evaluation.reason}</p>}
              <small>ارزیابی گذشته‌نگر است و تضمین‌کننده دقت آینده نیست.</small>
            </div>
          )}
          <p className="prophet-footnote">بازه پایین و بالا، بازه پیش‌بینی ۸۰٪ مدل است؛ این مقدار تضمین قطعی نیست. در صورت ناکافی بودن سابقه، WMA به‌عنوان روش جایگزین استفاده می‌شود.</p>
        </>
      )}
    </section>
  );
}
