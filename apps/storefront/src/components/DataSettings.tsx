import { useLayoutEffect, useRef, useState } from 'react';
import type { DataMode } from '../types/shop';

export const DATA_MODE_LABELS = { sample: 'サンプルデータ', postgres: 'PostgreSQL' };

interface DataSettingsProps {
  open: boolean;
  mode: DataMode;
  busy: boolean;
  error: string;
  onApply: (mode: DataMode) => void;
  onClose: () => void;
}

export function DataSettings({ open, mode, busy, error, onApply, onClose }: DataSettingsProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(mode);
  useLayoutEffect(() => {
    if (open) {
      setDraft(mode);
      dialog.current?.showModal();
    } else if (dialog.current?.open) {
      dialog.current.close();
      document.querySelector<HTMLButtonElement>('.data-settings-open')?.focus();
    }
  }, [open, mode]);
  return (
    <dialog ref={dialog} id="data-settings" className="data-settings" aria-labelledby="data-settings-heading" onClose={onClose}>
      <div className="dialog-top">
        <h2 id="data-settings-heading">データ設定</h2>
        <button type="button" className="icon-button" aria-label="閉じる" title="閉じる" onClick={onClose}>
          <svg className="icon"><use href="#i-close" /></svg>
        </button>
      </div>
      <form className="dialog-body" aria-busy={busy} onSubmit={event => { event.preventDefault(); onApply(draft); }}>
        <fieldset className="data-mode-options" disabled={busy}>
          <legend>データモード</legend>
          {(['sample', 'postgres'] as const).map(value => (
            <label key={value}>
              <input type="radio" name="data-mode" value={value} checked={draft === value} onChange={() => setDraft(value)} />
              {DATA_MODE_LABELS[value]}
            </label>
          ))}
        </fieldset>
        <p className="muted">切り替えると、カート・比較・会話はリセットされます。</p>
        <p role="status">{busy ? '接続中...' : `現在の設定: ${DATA_MODE_LABELS[mode]}`}</p>
        {error && <p className="voice-error" role="alert">{error}</p>}
        <div className="review-actions">
          <button type="button" className="button secondary" onClick={onClose}>キャンセル</button>
          <button type="submit" className="button primary" disabled={busy}>設定を適用</button>
        </div>
      </form>
    </dialog>
  );
}