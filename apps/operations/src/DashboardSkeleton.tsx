interface DashboardSkeletonProps { view: 'development' | 'supply'; error: string; onRetry: () => void }

export function DashboardSkeleton({ view, error, onRetry }: DashboardSkeletonProps) {
  return <div className="dashboard-skeleton" aria-busy={!error}>
    {!error && <span className="sr-only" role="status">{view === 'supply' ? '供給と注文' : '商品開発'}のデータを読み込んでいます。</span>}
    {error && <p className="message error" role="alert">{error}<button type="button" onClick={onRetry}>再試行</button></p>}
    <div className="ds-heading" aria-hidden="true">
      <span className="skeleton-block ds-title"/>
      <span className="skeleton-block ds-action"/>
    </div>
    <div className="ds-tabs" aria-hidden="true">
      <span className="skeleton-block"/>
      <span className="skeleton-block"/>
      <span className="skeleton-block ds-tabs-meta"/>
    </div>
    {view === 'supply'
      ? <div aria-hidden="true">
          <div className="ds-filters">{[0, 1, 2, 3].map(index => <span className="skeleton-block" key={index}/>)}</div>
          <div className="ds-metrics">{[0, 1, 2, 3].map(index => <span className="skeleton-panel" key={index}/>)}</div>
          <div className="ds-split">
            <span className="skeleton-panel ds-side"/>
            <span className="skeleton-panel ds-canvas"/>
          </div>
          <span className="skeleton-panel ds-table"/>
        </div>
      : <div className="ds-workbench" aria-hidden="true">
          <div className="ds-controls">
            <span className="skeleton-block ds-image"/>
            <div className="ds-presets">{[0, 1, 2].map(index => <span className="skeleton-block" key={index}/>)}</div>
            <span className="skeleton-block ds-bar"/>
            {[0, 1].map(index => <div className="ds-component" key={index}>
              <span className="skeleton-block"/>
              <span className="skeleton-block"/>
              <span className="skeleton-block ds-slider"/>
            </div>)}
          </div>
          <div className="ds-analysis">
            <div className="ds-metrics ds-metrics-three">{[0, 1, 2].map(index => <span className="skeleton-panel" key={index}/>)}</div>
            <span className="skeleton-block ds-outcome"/>
            <span className="skeleton-panel ds-canvas"/>
            <span className="skeleton-panel ds-table"/>
          </div>
        </div>}
  </div>;
}
