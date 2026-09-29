export function ShopDialogs() {
  return (
    <>
      <dialog id={'detail-dialog'} aria-labelledby={'detail-heading'}>
        <div className={'dialog-top'}>
          <h2 id={'detail-heading'}>{'商品について'}</h2>
          <button className={'icon-button'} data-action={'close-dialog'} aria-label={'閉じる'} title={'閉じる'}>
            <svg className={'icon'}>
              <use href={'#i-close'}></use>
            </svg>
          </button>
        </div>
        <div className={'dialog-body'} id={'detail-body'}></div>
      </dialog>
      <dialog id={'source-dialog'} className={'source-sheet'} aria-labelledby={'source-heading'}>
        <div className={'dialog-top'}>
          <h2 id={'source-heading'}>{'商品ガイド'}</h2>
          <button className={'icon-button'} data-action={'close-dialog'} aria-label={'閉じる'} title={'閉じる'}>
            <svg className={'icon'}>
              <use href={'#i-close'}></use>
            </svg>
          </button>
        </div>
        <div className={'dialog-body'} id={'source-body'}></div>
      </dialog>
      <dialog id={'cart-dialog'} className={'cart-dialog'} aria-labelledby={'cart-heading'}>
        <div className={'dialog-top'}>
          <h2 id={'cart-heading'}>{'カート'}</h2>
          <button className={'icon-button'} data-action={'close-dialog'} aria-label={'閉じる'} title={'閉じる'}>
            <svg className={'icon'}>
              <use href={'#i-close'}></use>
            </svg>
          </button>
        </div>
        <div className={'dialog-body'} id={'cart-body'}></div>
      </dialog>
      <dialog id={'memory-dialog'} className={'memory-dialog'} aria-labelledby={'memory-heading'}>
        <div className={'dialog-top'}>
          <h2 id={'memory-heading'}>{'お客様メモリー'}</h2>
          <button className={'icon-button'} data-action={'close-dialog'} aria-label={'閉じる'} title={'閉じる'}>
            <svg className={'icon'}>
              <use href={'#i-close'}></use>
            </svg>
          </button>
        </div>

        <div className={'dialog-body'}>
          <p className={'memory-note'}>{'会話から覚えたこと · Agent の保存ツール'}</p>

          <ul className={'memory-list'} id={'memory-list'}></ul>

          <p className={'memory-note'}>
            {'Agent が明示された好みを構造化し、このブラウザーに保存します。会話全文は保存しません。'}
          </p>

          <p id={'memory-error'} className={'memory-error'} role={'alert'} hidden={true}></p>

          <div className={'memory-footer'}>
            <button className={'text-button'} type={'button'} data-action={'memory-delete'}>
              {'すべて削除'}
            </button>
            <button className={'button secondary'} type={'button'} data-action={'close-dialog'}>
              {'相談に戻る'}
            </button>
          </div>

          <div id={'memory-delete-confirm'} className={'memory-delete-confirm'} hidden={true}>
            <p>{'保存した好みをすべて削除しますか？'}</p>
            <button className={'button secondary'} type={'button'} data-action={'memory-delete-cancel'}>
              {'戻る'}
            </button>

            <button className={'button primary'} type={'button'} data-action={'memory-delete-confirm'}>
              {'削除する'}
            </button>
          </div>
        </div>
      </dialog>
      <dialog id={'voice-settings'} className={'voice-settings'} aria-labelledby={'voice-settings-heading'}>
        <div className={'dialog-top'}>
          <h2 id={'voice-settings-heading'}>{'音声の接続設定'}</h2>
          <button className={'icon-button'} data-action={'close-dialog'} aria-label={'閉じる'} title={'閉じる'}>
            <svg className={'icon'}>
              <use href={'#i-close'}></use>
            </svg>
          </button>
        </div>

        <form id={'voice-settings-form'} className={'dialog-body'}>
          <label>
            {'音声方式'}
            <select id={'voice-mode-choice'}>
              <option value={'realtime_native'}>{'Realtime 一体型'}</option>
              <option value={'live_jev'}>{'GPT-Live + Jev'}</option>
            </select>
          </label>

          <label>
            {'音声'}
            <select id={'voice-choice'}>
              <option>{'verse'}</option>
              <option>{'alloy'}</option>
              <option>{'ash'}</option>
              <option>{'ballad'}</option>
              <option>{'coral'}</option>
              <option>{'echo'}</option>
              <option>{'sage'}</option>
              <option>{'shimmer'}</option>
            </select>
          </label>

          <p id={'voice-mode-detail'} className={'voice-error'} role={'status'} hidden={true}></p>
          <p id={'voice-data-notice'} className={'muted'} hidden={true}>
            {'音声は Azure、発言・直前の会話・商品情報・カート・保存済みの好み・直近の注文概要は TypeSafe に送信されます。'}
            <a href={'https://typesafe.ai/legal/privacy-policy'} target={'_blank'} rel={'noreferrer'}>{'TypeSafe のプライバシーポリシー'}</a>
          </p>

          <p id={'voice-settings-error'} className={'voice-error'} role={'alert'} hidden={true}></p>

          <div className={'review-actions'}>
            <button type={'button'} className={'button secondary'} data-action={'close-dialog'}>
              {'閉じる'}
            </button>
            <button type={'submit'} className={'button primary'}>
              {'設定を適用'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
