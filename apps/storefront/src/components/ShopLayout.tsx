import { SiteHeader } from './SiteHeader';
import { ShopIntro } from './ShopIntro';
import { CatalogueWorkspace } from './CatalogueWorkspace';
import { FaqPage } from './FaqPage';
import { SiteFooter } from './SiteFooter';
import { BaristaPanel } from './BaristaPanel';
import { ChatTracePanel } from './ChatTracePanel';
import { ShopDialogs } from './ShopDialogs';
import { IconSprite } from './IconSprite';
import type { DataMode, Store } from '../types/shop';
export function ShopLayout({ stores, dataMode, onDataSettings, pending }: {
  stores?: Store[]; dataMode: DataMode; onDataSettings: () => void;
  pending?: { busy: boolean; error: string; onRetry: () => void };
}) {
  return (
    <>
      <SiteHeader dataMode={dataMode} onDataSettings={onDataSettings} disabled={Boolean(pending)} />

      <div className={pending ? 'layout catalogue-pending' : 'layout'} data-busy={pending?.busy}>
        <main id={'main'} aria-busy={pending?.busy}>
          <div inert={Boolean(pending)}>
            <ShopIntro stores={pending ? [] : stores} />
          </div>

          {pending?.error && (
            <div className="catalogue-error">
              <p className="voice-error" role="alert">{pending.error}</p>
              <button className="button secondary" disabled={pending.busy} onClick={pending.onRetry}>再試行</button>
            </div>
          )}
          {pending?.busy && <p className="sr-only" role="status">商品を読み込んでいます</p>}
          <CatalogueWorkspace loading={Boolean(pending)} />

          {!pending && <FaqPage />}

          <div inert={Boolean(pending)}><SiteFooter /></div>
        </main>

        {!pending && <BaristaPanel />}
      </div>

      {!pending && <button
        className={'mobile-chat-toggle'}
        data-action={'open-chat'}
        aria-expanded={'false'}
        aria-controls={'assistant'}
      >
        <svg className={'icon'}>
          <use href={'#i-chat'}></use>
        </svg>
        {'バリスタ監修 豆選びガイド'}
      </button>}

      {!pending && <ChatTracePanel />}

      {!pending && <ShopDialogs />}

      <div id={'toast'} className={'toast'} role={'status'} hidden={true}>
        <span id={'toast-text'}></span>
        <button id={'undo-button'} data-action={'undo'} hidden={true}>
          {'元に戻す'}
        </button>
      </div>

      <IconSprite />
    </>
  );
}
