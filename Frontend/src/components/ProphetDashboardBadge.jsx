import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { analyticsApi } from '../api/analytics.js';
import { fmt } from '../lib/format.js';

export default function ProphetDashboardBadge() {
  const [forecast, setForecast] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    analyticsApi.forecast({ horizon: 1, months: 36 })
      .then((result) => { if (alive) setForecast(result.predictions?.[0] || null); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  return (
    <Link className="forecast-chip" to="/expense-forecast" title="مشاهده پیش‌بینی تفصیلی Prophet">
      <Icon name="sparkles" />
      <span>
        پیش‌بینی Prophet: <b>{forecast ? `${fmt.money(forecast.yhat)} تومان` : failed ? 'در دسترس نیست' : 'در حال محاسبه…'}</b>
      </span>
    </Link>
  );
}
