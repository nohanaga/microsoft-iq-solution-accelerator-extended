export function BaristaPanel() {
  return (
    <>
      <aside className={'assistant'} id={'assistant'} aria-labelledby={'assistant-title'} hidden={true}>
        <div
          className={'assistant-resize'}
          id={'assistant-resize'}
          role={'separator'}
          aria-orientation={'vertical'}
          aria-controls={'assistant'}
          aria-label={'相談パネルの幅'}
          tabIndex={'0'}
          title={'ドラッグで幅を変更、左右キーで調整、ダブルクリックで元に戻す'}
        ></div>

        <div className={'assistant-heading'}>
          <div className={'assistant-identity'}>
            <span className={'assistant-emblem'} aria-hidden={'true'}>
              {'舞'}
            </span>
            <div>
              <h2 id={'assistant-title'}>{'バリスタ監修 豆選びガイド'}</h2>
              <p id={'barista-mode'}>{'テキスト相談'}</p>
            </div>
          </div>
          <div className={'assistant-actions'}>
            <button
              type={'button'}
              className={'icon-button'}
              id={'chat-clear'}
              aria-label={'チャットをクリア'}
              title={'チャットをクリア（音声対話も終了）'}
            >
              <svg className={'icon'}>
                <use href={'#i-trash'}></use>
              </svg>
            </button>
            <button
              className={'icon-button assistant-close'}
              data-action={'close-chat'}
              aria-label={'相談を閉じて商品画面へ'}
              title={'商品画面へ'}
            >
              <svg className={'icon'}>
                <use href={'#i-close'}></use>
              </svg>
            </button>
          </div>
        </div>

        <div className={'memory-strip'}>
          <div className={'memory-strip-heading'}>
            <strong>
              {'お客様メモリー '}
              <span id={'memory-count'}>{'0'}</span>
            </strong>
            <button
              className={'icon-button'}
              data-action={'memory-open'}
              aria-label={'記憶一覧を見る'}
              title={'記憶一覧を見る'}
            >
              <svg className={'icon'}>
                <use href={'#i-file'}></use>
              </svg>
            </button>
          </div>
          <p id={'memory-summary'} role={'status'}>
            {'まだ記憶はありません'}
          </p>
        </div>

        <div className={'chat-messages'} id={'chat-messages'}>
          <div className={'chat-welcome'}>
            <h3 className={'serif'}>
              <span>{'今日は、'}</span>
              <wbr />
              <span>{'どんな一杯に？'}</span>
            </h3>
            <p>
              {'深い苦味、果実のような香り。'}
              <br />
              {'お好みから、一緒に選びましょう。'}
            </p>
          </div>

          <div className={'quick-prompts'}>
            <button data-prompt={'私の好みに合う豆を比較して'}>
              {'私の好みに合う豆は？'}
              <svg className={'icon'}>
                <use href={'#i-arrow'}></use>
              </svg>
            </button>
            <button data-prompt={'おすすめの豆を3つ比較して'}>
              {'まずは三種、豆を比べたい'}
              <svg className={'icon'}>
                <use href={'#i-arrow'}></use>
              </svg>
            </button>
            <button data-prompt={'酸味が少ない豆を比較して'}>
              {'酸味が少ない豆を選びたい'}
              <svg className={'icon'}>
                <use href={'#i-arrow'}></use>
              </svg>
            </button>
          </div>

          <div className={'assistant-pick'}>
            <p className={'pick-label'}>{'今日のおすすめ'}</p>
            <div id={'assistant-pick'}></div>
          </div>

          <div id={'conversation'} role={'log'} aria-live={'polite'} aria-relevant={'additions'}></div>
        </div>

        <div className={'composer-area'}>
          <label className={'demo-prompt-picker'}>
            <span>{'デモ文例'}</span>
            <select id={'demo-prompt-select'} aria-label={'デモ文例を選ぶ'}>
              <option value={''}>{'文例を選ぶ'}</option>
              <option value={'previous-beans'}>{'前回の豆から代替を探す'}</option>
              <option value={'tasting'}>{'友人と三種の飲み比べ'}</option>
            </select>
          </label>

          <div className={'chat-context'}>
            <svg className={'icon'}>
              <use href={'#i-pin'}></use>
            </svg>
            <span id={'chat-context'}>{'神田店 · 15:00 店頭受取'}</span>
          </div>

          <p id={'voice-error'} className={'voice-error'} role={'alert'} hidden={true}></p>

          <audio id={'voice-audio'} autoPlay={true}></audio>

          <form className={'chat-form'} id={'chat-form'}>
            <label className={'sr-only'} htmlFor={'chat-input'}>
              {'珈琲について相談する'}
            </label>
            <textarea
              id={'chat-input'}
              rows={'2'}
              maxLength={'500'}
              placeholder={'「酸味が少ない豆を比べたい」'}
            ></textarea>
            <div className={'voice-toolbar'} role={'group'} aria-label={'音声相談'}>
              <button
                type={'button'}
                className={'voice-toggle'}
                id={'voice-toggle'}
                aria-pressed={'false'}
                title={'バリスタへの音声相談を開始'}
              >
                <svg className={'icon'}>
                  <use href={'#i-mic'}></use>
                </svg>
                <span>{'バリスタ監修 豆選びガイド'}</span>
              </button>

              <span className={'voice-status'} id={'voice-status'} role={'status'}>
                {'マイク停止'}
              </span>

              <button
                type={'button'}
                className={'icon-button'}
                id={'voice-mute'}
                disabled={true}
                aria-pressed={'false'}
                aria-label={'マイクをミュート'}
                title={'マイクをミュート'}
              >
                <svg className={'icon'}>
                  <use href={'#i-mic-off'}></use>
                </svg>
              </button>

              <button
                type={'button'}
                className={'icon-button'}
                id={'voice-stop'}
                disabled={true}
                aria-label={'バリスタの応答を止める'}
                title={'バリスタの応答を止める'}
              >
                <svg className={'icon'}>
                  <use href={'#i-stop'}></use>
                </svg>
              </button>

              <button
                type={'button'}
                className={'icon-button'}
                id={'voice-settings-open'}
                aria-label={'音声の接続設定'}
                title={'音声の接続設定'}
              >
                <svg className={'icon'}>
                  <use href={'#i-sliders'}></use>
                </svg>
              </button>

              <button
                type={'button'}
                className={'icon-button'}
                id={'voice-resume'}
                hidden={true}
                aria-label={'音声を再生'}
                title={'音声を再生'}
              >
                <svg className={'icon'}>
                  <use href={'#i-volume'}></use>
                </svg>
              </button>
            </div>
            <button className={'send-button'} type={'submit'} aria-label={'相談を送信'} title={'送信'}>
              <svg className={'icon'}>
                <use href={'#i-send'}></use>
              </svg>
            </button>
          </form>

          <p className={'composer-note'} id={'chat-data-notice'}>
            {'相談では会話・商品・好み・注文情報を Azure に送信します（従量課金）。音声開始時は音声も送信し、新しい会話になります。'}
          </p>
        </div>
      </aside>
    </>
  );
}
