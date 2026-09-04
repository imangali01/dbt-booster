import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DocsApp } from './DocsApp';

const container = document.getElementById('root');
if (container) {
  const view = container.dataset.view;
  createRoot(container).render(
    <StrictMode>{view === 'docs' ? <DocsApp /> : <App />}</StrictMode>,
  );
}
