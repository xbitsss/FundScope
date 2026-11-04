import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './ui/App';
import AppErrorBoundary from './ui/AppErrorBoundary';
import WebSnapshotGate from './ui/WebSnapshotGate';
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
import './ui/styles/classification.css';
import './ui/styles/snapshot-gate.css';
import './ui/styles/mobile-ux.css';
import './ui/styles/applied-filters.css';
import './ui/styles/scatter.css';
import './ui/styles/scatter.css';

const app = import.meta.env.MODE === 'web' ? <WebSnapshotGate /> : <App />;
if (import.meta.env.MODE === 'web' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined);
  }, { once: true });
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary>{app}</AppErrorBoundary></React.StrictMode>);
