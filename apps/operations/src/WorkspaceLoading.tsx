import type { ReactNode } from 'react';

export function WorkspaceLoading({ graphStatus }: { graphStatus?: ReactNode }) {
  return <div className="app-shell workspace-skeleton" aria-busy="true">
    <span className="sr-only" role="status">データを読み込んでいます。</span>
    <header className="topbar">
      <span className="skeleton-block skeleton-brand" aria-hidden="true"/>
      <span className="skeleton-block skeleton-workspace-title" aria-hidden="true"/>
      {graphStatus ? <div className="workspace-session">{graphStatus}</div> : <span className="skeleton-actions" aria-hidden="true">
        <span className="skeleton-block"/>
        <span className="skeleton-block"/>
        <span className="skeleton-block"/>
      </span>}
    </header>
    <nav className="navigation skeleton-navigation" aria-hidden="true">
      <span className="skeleton-block skeleton-nav-label"/>
      <span className="skeleton-block skeleton-nav-item"/>
      <span className="skeleton-block skeleton-nav-item"/>
      <span className="skeleton-block skeleton-nav-item"/>
      <span className="skeleton-nav-footer">
        <span className="skeleton-block skeleton-nav-label"/>
        <span className="skeleton-block skeleton-nav-item"/>
        <span className="skeleton-block skeleton-nav-item"/>
      </span>
    </nav>
    <div className="context-strip skeleton-context" aria-hidden="true">
      <span className="skeleton-block"/>
      <span className="skeleton-block"/>
    </div>
    <main aria-hidden="true">
      <div className="skeleton-page-heading">
        <span className="skeleton-block"/>
        <span className="skeleton-block"/>
      </div>
      <div className="skeleton-toolbar">
        <span className="skeleton-block"/>
        <span className="skeleton-block"/>
        <span className="skeleton-block"/>
      </div>
      <section className="skeleton-metrics">
        <span className="skeleton-panel"/>
        <span className="skeleton-panel"/>
        <span className="skeleton-panel"/>
        <span className="skeleton-panel"/>
      </section>
      <div className="skeleton-content">
        <section className="skeleton-panel skeleton-content-primary">
          <span className="skeleton-block"/>
          <span className="skeleton-block"/>
          <span className="skeleton-block"/>
          <span className="skeleton-block"/>
        </section>
        <section className="skeleton-panel skeleton-content-secondary">
          <span className="skeleton-block"/>
          <span className="skeleton-block"/>
          <span className="skeleton-block"/>
        </section>
      </div>
    </main>
  </div>;
}