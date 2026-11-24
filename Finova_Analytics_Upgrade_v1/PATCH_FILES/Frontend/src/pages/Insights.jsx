import { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import ChartCanvas from '../components/ChartCanvas.jsx';
import { analyticsApi } from '../api/analytics.js';
import { fmt } from '../lib/format.js';

export default function Insights() {
  const [months, setMonths] = useState(24);
  const [bucket, setBucket] = useState('day');
  const [patterns, setPatterns] = useState(null);
  const [clusters, setClusters] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    Promise.all([
      analyticsApi.patterns({ months, bucket, min_support: 0.10, min_confidence: 0.50, min_lift: 1.0 }),
      analyticsApi.clusters({ months, max_clusters: 4, min_active_months: 12 }),
    ]).then(([patternResult, clusterResult]) => {
      if (alive) {
        setPatterns(patternResult);
        setClusters(clusterResult);
      }
    }).catch((err) => {
      if (alive) setError(err.message || 'بارگذاری تحلیل‌ها انجام نشد.');
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [months, bucket, reloadKey]);

  const clusterChart = useMemo(() => ({
    labels: (clusters?.clusters || []).map((item) => item.label),
    datasets: [{
      label: 'میانگین هزینه ماهانه',
      data: (clusters?.clusters || []).map((item) => item.average_expense / 1e6),
      backgroundColor: ['rgba(16,185,129,.65)', 'rgba(59,130,246,.65)', 'rgba(245,158,11,.65)', 'rgba(139,92,246,.65)'],
      borderRadius: 8,
    }],
  }), [clusters]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { rtl: true, textDirection: 'rtl' } },
    scales: { y: { beginAtZero: true, title: { display: true, text: 'میلیون تومان' } }, x: { grid: { display: false } } },
  }), []);

  return (
    <div className="app-view insights-page" id="view-insights">
      <nav className="breadcrumb" aria-label="مسیر صفحه"><ol><li><Icon name="home" /> داشبورد</li><li className="sep">/</li><li aria-current="page">تحلیل هوشمند</li></ol></nav>
      <div className="page-head">
        <div><h1 tabIndex="-1">تحلیل هوشمند مخارج</h1><p>کشف ارتباط میان دسته‌های هزینه و شناسایی الگوهای مشابه مالی</p></div>
        <div className="head-actions insights-controls">
          <label>بازه بررسی
            <select value={months} onChange={(event) => setMonths(Number(event.target.value))}>
              <option value={12}>۱۲ ماه</option><option value={24}>۲۴ ماه</option><option value={36}>۳۶ ماه</option>
            </select>
          </label>
          <button className="btn ghost" type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}><Icon name="refresh-cw" /> به‌روزرسانی</button>
        </div>
      </div>

      {loading && <div className="analytics-state"><span className="app-loading-ring" /> در حال تحلیل اطلاعات مالی…</div>}
      {!loading && error && <div className="analytics-error" role="alert"><Icon name="alert-circle" />{error}</div>}

      {!loading && patterns && (
        <section className="card insight-section" aria-labelledby="aprioriTitle">
          <div className="card-head">
            <div><div className="insight-eyebrow"><Icon name="network" /> APRIORI · ASSOCIATION RULES</div><h2 id="aprioriTitle">کشف الگوهای هم‌وقوعی مخارج</h2><p>هر سبد، یک روز یا یک هفته شامل دسته‌های هزینه ثبت‌شده است.</p></div>
            <label className="insight-filter">نوع سبد
              <select value={bucket} onChange={(event) => setBucket(event.target.value)}><option value="day">روزانه</option><option value="week">هفتگی</option></select>
            </label>
          </div>
          <div className="insight-stat-row">
            <article><span>تعداد سبدها</span><strong>{fmt.digits(patterns.basket_count)}</strong></article>
            <article><span>دسته‌های شناسایی‌شده</span><strong>{fmt.digits(patterns.category_count)}</strong></article>
            <article><span>قوانین استخراج‌شده</span><strong>{fmt.digits(patterns.rules.length)}</strong></article>
          </div>
          {patterns.warning && <div className="analytics-notice"><Icon name="info" />{patterns.warning}</div>}
          {patterns.rules.length > 0 ? (
            <div className="association-rules">
              {patterns.rules.map((rule, index) => (
                <article className="association-rule" key={`${rule.antecedents.join('|')}-${rule.consequents.join('|')}-${index}`}>
                  <div className="rule-flow"><strong>{rule.antecedents.join(' + ')}</strong><Icon name="arrow-left" /><strong>{rule.consequents.join(' + ')}</strong></div>
                  <div className="rule-metrics">
                    <span>Support <b>{fmt.digits((rule.support * 100).toFixed(1))}٪</b></span>
                    <span>Confidence <b>{fmt.digits((rule.confidence * 100).toFixed(1))}٪</b></span>
                    <span>Lift <b>{fmt.digits(rule.lift.toFixed(2))}</b></span>
                    <span>تکرار <b>{fmt.digits(rule.occurrences)}</b></span>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="analytics-empty">با داده‌ها و آستانه فعلی قانون انجمنی قابل نمایش پیدا نشد.</div>}
          <p className="insight-disclaimer">این قوانین هم‌زمانی ثبت دسته‌ها را نشان می‌دهند و رابطه علت‌ومعلولی را اثبات نمی‌کنند.</p>
        </section>
      )}

      {!loading && clusters && (
        <section className="card insight-section" aria-labelledby="kmeansTitle">
          <div className="card-head">
            <div><div className="insight-eyebrow"><Icon name="chart-scatter" /> K-MEANS · CLUSTERING</div><h2 id="kmeansTitle">خوشه‌بندی رفتار مالی ماهانه</h2><p>ماه‌های دارای تراکنش بر اساس ویژگی‌های مالی استانداردشده گروه‌بندی می‌شوند.</p></div>
            {clusters.silhouette_score != null && <div className="silhouette-pill">Silhouette <b>{fmt.digits(clusters.silhouette_score.toFixed(3))}</b></div>}
          </div>
          <div className="insight-stat-row">
            <article><span>ماه‌های فعال</span><strong>{fmt.digits(clusters.samples)}</strong></article>
            <article><span>تعداد خوشه منتخب</span><strong>{clusters.selected_k ? fmt.digits(clusters.selected_k) : '—'}</strong></article>
            <article><span>ویژگی‌ها</span><strong>{fmt.digits(clusters.feature_names.length)}</strong></article>
          </div>
          {clusters.warning && <div className="analytics-notice"><Icon name="info" />{clusters.warning}</div>}
          {clusters.clusters.length > 0 && (
            <>
              <div className="cluster-chart"><ChartCanvas type="bar" data={clusterChart} options={chartOptions} ariaLabel="مقایسه میانگین هزینه خوشه‌های مالی" /></div>
              <div className="cluster-grid">
                {clusters.clusters.map((cluster) => (
                  <article className="cluster-card" key={cluster.cluster_id}>
                    <span className="cluster-label">{cluster.label}</span>
                    <strong>{fmt.money(cluster.average_expense)} <small>تومان میانگین هزینه</small></strong>
                    <span>{fmt.digits(cluster.month_count)} ماه</span>
                    <p>{cluster.periods.map((period) => {
                      const [year, month] = period.split('-').map(Number);
                      const names = ['فرو', 'ارد', 'خرد', 'تیر', 'مرد', 'شهر', 'مهر', 'آبا', 'آذر', 'دی', 'بهم', 'اسف'];
                      return `${names[month - 1]} ${fmt.digits(String(year).slice(-2))}`;
                    }).join('، ')}</p>
                  </article>
                ))}
              </div>
              {clusters.candidate_scores?.length > 0 && <p className="insight-disclaimer">امتیاز Silhouette برای Kهای آزمایش‌شده: {clusters.candidate_scores.map((item) => `K=${item.k}: ${fmt.digits(item.silhouette.toFixed(3))}`).join(' · ')}</p>}
            </>
          )}
          <p className="insight-disclaimer">خوشه‌ها فقط از تاریخچه همین حساب ساخته می‌شوند؛ نام‌گذاری کم‌هزینه تا پرهزینه بر اساس میانگین هزینه هر خوشه است.</p>
        </section>
      )}
    </div>
  );
}
