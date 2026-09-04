import { createRoot } from 'react-dom/client';

// Placeholder webview entry point. The real lineage UI is added in a later ticket;
// for now this only proves the browser/React bundle builds and mounts.
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<div className="dbt-booster-placeholder" />);
}
