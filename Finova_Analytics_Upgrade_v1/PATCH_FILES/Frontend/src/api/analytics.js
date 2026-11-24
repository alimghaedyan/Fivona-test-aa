import { request } from './client.js';

function queryString(values) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const analyticsApi = {
  forecast: (options = {}) => request(`/api/analytics/forecast${queryString(options)}`),
  patterns: (options = {}) => request(`/api/analytics/patterns${queryString(options)}`),
  clusters: (options = {}) => request(`/api/analytics/clusters${queryString(options)}`),
};
