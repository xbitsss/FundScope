import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './ui/App';
import './ui/styles/tokens.css';
import './ui/styles/table-sticky.css';
import './ui/styles/table-scroll.css';
import './ui/styles/header-density.css';
import './ui/styles/history-cache.css';
import './ui/styles/multi-select.css';
import './ui/styles/checklist-filter.css';
import './ui/styles/page-scroll.css';
import './ui/styles/benchmark.css';
import './ui/styles/responsive-workspace.css';
import './ui/styles/interaction-fixes.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
