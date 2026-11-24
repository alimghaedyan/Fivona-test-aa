import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initTheme } from './lib/theme.js';
import './styles/style.css';
import './styles/income.css';
import './styles/expenses.css';
import './styles/budgets.css';
import './styles/health.css';
import './styles/forecast.css';
import './styles/reports.css';
import './styles/profile.css';
import './styles/auth.css';
import './styles/insights.css';
import './styles/theme.css';

initTheme();

createRoot(document.getElementById('root')).render(<App />);
