export function ChatTracePanel() {
  return (
    <>
      <div className={'chat-trace'} id={'chat-trace'} role={'region'} aria-labelledby={'trace-title'} hidden={true}>
        <div className={'trace-heading'}>
          <h3 id={'trace-title'}>{'応答の詳細'}</h3>
          <span id={'trace-source'}></span>
        </div>

        <div className={'trace-tabs'} role={'tablist'} aria-label={'応答ログの種類'}>
          <button
            type={'button'}
            role={'tab'}
            id={'trace-tab-tools'}
            data-trace-tab={'tools'}
            aria-controls={'trace-content'}
            aria-selected={'true'}
          >
            {'ツール'}
          </button>

          <button
            type={'button'}
            role={'tab'}
            id={'trace-tab-reasoning'}
            data-trace-tab={'reasoning'}
            aria-controls={'trace-content'}
            aria-selected={'false'}
            tabIndex={'-1'}
          >
            {'推論ログ'}
          </button>

          <button
            type={'button'}
            role={'tab'}
            id={'trace-tab-intermediate'}
            data-trace-tab={'intermediate'}
            aria-controls={'trace-content'}
            aria-selected={'false'}
            tabIndex={'-1'}
          >
            {'中間出力'}
          </button>

        </div>

        <div
          className={'trace-content'}
          id={'trace-content'}
          role={'tabpanel'}
          aria-labelledby={'trace-tab-tools'}
          tabIndex={'0'}
        ></div>
      </div>
    </>
  );
}
