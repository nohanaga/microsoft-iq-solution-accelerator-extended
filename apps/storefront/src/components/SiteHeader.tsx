import type { DataMode } from '../types/shop';
import { DATA_MODE_LABELS } from './DataSettings';

export function SiteHeader({ dataMode, onDataSettings, disabled = false }: {
  dataMode: DataMode; onDataSettings: () => void; disabled?: boolean;
}) {
  const postgresConnected = dataMode === 'postgres' && !disabled;
  return (
    <>
      <a className={'skip-link'} href={'#main'}>
        {'商品へ進む'}
      </a>
      <div className={'noticebar'}>
        <span>{'自家焙煎・珈琲豆商　舞黒珈琲店'}</span>
        <div className="header-notice-details">
          <div className="data-mode-label" role="status" data-connected={postgresConnected}
            title={postgresConnected ? '商品・店舗データの取得に成功しました' : undefined}>
            {dataMode === 'postgres' && <i className="connection-lamp" aria-hidden="true" />}
            <strong>{DATA_MODE_LABELS[dataMode]}</strong>
            {postgresConnected && <small>connected</small>}
          </div>
          <span>{'写真は仮表示 · 実際の注文はできません'}</span>
        </div>
      </div>
      <header className={'site-header'}>
        <a className={'brand'} href={'#shop'} aria-label={'舞黒珈琲店 商品一覧'}>
          <span className={'brand-seal'} aria-hidden={'true'}>
            {'舞'}
          </span>
          <span>
            <span className={'brand-name'}>{'舞黒珈琲店'}</span>
            <span className={'brand-sub'} style={{ display: 'block' }}>
              {'自家焙煎　珈琲豆と喫茶'}
            </span>
          </span>
        </a>

        <nav className={'header-nav'} aria-label={'メインナビゲーション'} inert={disabled}>
          <button data-action={'all'} className={'active'}>
            {'商品を選ぶ'}
          </button>
          <button data-action={'compare-view'}>{'商品を比較'}</button>
          <button data-action={'orders'}>{'ご注文履歴'}</button>
        </nav>

        <div className={'header-actions'}>
          <button type="button" className="icon-button data-settings-open" onClick={onDataSettings}
            aria-label="データ設定" aria-controls="data-settings" title={`データ設定: ${DATA_MODE_LABELS[dataMode]}`}>
            <svg className="icon"><use href="#i-sliders" /></svg>
          </button>
          <button
            className={'header-faq'}
            disabled={disabled}
            data-action={'faq'}
            aria-label={'よくあるご質問'}
            aria-controls={'faq-view'}
            title={'よくあるご質問'}
          >
            {'FAQ'}
          </button>

          <button
            className={'header-consult'}
            disabled={disabled}
            data-action={'toggle-chat'}
            aria-expanded={'false'}
            aria-controls={'assistant'}
            aria-label={'バリスタ監修 豆選びガイド（開く）'}
            title={'バリスタ監修 豆選びガイド'}
          >
            <svg className={'icon'}>
              <use href={'#i-chat'}></use>
            </svg>
            <span>{'バリスタ監修 豆選びガイド'}</span>
          </button>

          <button
            className={'icon-button'}
            disabled={disabled}
            data-action={'theme'}
            aria-label={'表示テーマを切り替え'}
            title={'表示テーマを切り替え'}
          >
            <svg className={'icon'}>
              <use href={'#i-sun'}></use>
            </svg>
          </button>

          <button className={'cart-button'} data-action={'cart'} aria-label={'カートを開く'} disabled={disabled}>
            <svg className={'icon'}>
              <use href={'#i-bag'}></use>
            </svg>
            <span className={'cart-label'}>{'カート'}</span>
            <span className={'cart-count'} id={'cart-count'}>
              {'0'}
            </span>
          </button>
        </div>
      </header>
    </>
  );
}
