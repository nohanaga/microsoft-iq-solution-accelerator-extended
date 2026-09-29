export function SiteFooter() {
  return (
    <>
      <footer className={'site-footer'}>
        <div>
          <div className={'serif'}>{'舞黒珈琲店'}</div>
          {'一杯の、その先へ。'}
        </div>
        <div>
          {'表示価格はすべて税込です。'}
          <br />
          {'© MAIKURO COFFEE / 架空の店舗です。'}
          <br />
          <button className={'faq-link'} data-action={'orders'}>
            {'ご注文履歴'}
          </button>
          <br />
          <button className={'faq-link'} data-action={'faq'} aria-controls={'faq-view'}>
            {'よくあるご質問'}
          </button>
        </div>
      </footer>
    </>
  );
}
