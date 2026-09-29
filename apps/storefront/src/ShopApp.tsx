import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ShopLayout } from './components/ShopLayout';
import { DataSettings } from './components/DataSettings';
import { SAMPLE_CATALOGUE, fetchPostgresCatalogue } from './data/catalogue';
import { mountShop } from './runtime/shopController';
import type { DataMode, ShopCatalogue } from './types/shop';
import './styles/shop.css';

const MODE_KEY = 'maikuro:catalogue-mode:v1';
function savedMode(): DataMode {
  try { return localStorage.getItem(MODE_KEY) === 'postgres' ? 'postgres' : 'sample'; }
  catch { return 'sample'; }
}

function LoadedShop({ catalogue, mode, onSettings }: {
  catalogue: ShopCatalogue; mode: DataMode; onSettings: () => void;
}) {
  useLayoutEffect(() => mountShop(catalogue.products, mode,
    (catalogue.stores.find(store => store.id === 'STR-04') ?? catalogue.stores[0]).name,
  ), [catalogue, mode]);
  return <ShopLayout stores={catalogue.stores} dataMode={mode} onDataSettings={onSettings} />;
}

export default function ShopApp() {
  const [initialMode] = useState(savedMode);
  const [mode, setMode] = useState(initialMode);
  const [catalogue, setCatalogue] = useState<ShopCatalogue | null>(initialMode === 'sample' ? SAMPLE_CATALOGUE : null);
  const [revision, setRevision] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(initialMode === 'postgres');
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);

  async function applyMode(nextMode: DataMode, persist = true) {
    if (persist && nextMode === mode && catalogue) { setError(''); closeSettings(); return; }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      const next = nextMode === 'sample' ? SAMPLE_CATALOGUE : await fetchPostgresCatalogue(controller.signal);
      if (controller.signal.aborted) return;
      if (persist) {
        try { localStorage.setItem(MODE_KEY, nextMode); }
        catch { throw new Error('設定を保存できませんでした。ブラウザーの保存設定をご確認ください。'); }
      }
      setMode(nextMode);
      setCatalogue(next);
      setRevision(value => value + 1);
      setSettingsOpen(false);
    } catch (failure) {
      if (pending.current !== controller) return;
      setError(controller.signal.aborted ? '接続がタイムアウトしました。再試行してください。' :
        failure instanceof Error ? failure.message : 'データの読み込みに失敗しました。');
    } finally {
      window.clearTimeout(timeout);
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  function closeSettings() {
    const controller = pending.current;
    pending.current = null;
    controller?.abort();
    setBusy(false);
    setSettingsOpen(false);
  }
  function openSettings() {
    closeSettings();
    setError('');
    setSettingsOpen(true);
  }
  useEffect(() => {
    if (initialMode === 'postgres') void applyMode('postgres', false);
    return () => {
      const controller = pending.current;
      pending.current = null;
      controller?.abort();
    };
  }, [initialMode]);

  return (
    <>
      {catalogue ? <LoadedShop key={revision} catalogue={catalogue} mode={mode} onSettings={openSettings} /> : (
        <ShopLayout dataMode={mode} onDataSettings={openSettings}
          pending={{ busy, error, onRetry: () => void applyMode(mode, false) }} />
      )}
      <DataSettings open={settingsOpen} mode={mode} busy={busy} error={error}
        onApply={nextMode => void applyMode(nextMode)} onClose={closeSettings} />
    </>
  );
}