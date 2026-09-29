export function FaqPage() {
  return (
    <>
      <section id={'faq-view'} className={'faq-page'} aria-labelledby={'faq-heading'} hidden={true}>
        <nav className={'faq-breadcrumb'} aria-label={'パンくず'}>
          <button data-action={'catalog-view'}>{'お品書き'}</button>
          <span aria-hidden={'true'}>{'/'}</span>
          <span aria-current={'page'}>{'よくあるご質問'}</span>
        </nav>

        <h1 id={'faq-heading'} tabIndex={'-1'}>
          {'よくあるご質問'}
        </h1>

        <section className={'faq-group'} aria-labelledby={'faq-beans-heading'}>
          <h2 id={'faq-beans-heading'}>{'珈琲豆について'}</h2>

          <details open={true}>
            <summary>{'珈琲豆は何グラム入りですか？ 粉に挽けますか？'}</summary>
            <p>
              {
                '珈琲豆は全 6 種、いずれも一袋 200 g です。現在のお品書きでは豆のままでのお渡しのみで、挽き方や内容量の変更は承っていません。'
              }
            </p>
          </details>

          <details>
            <summary>{'酸味がひかえめの豆はありますか？'}</summary>
            <p>
              {
                '舞黒 深煎りブレンドとインドネシア マンデリンは、酸味がひかえめでコクのある豆としてご案内しています。商品情報と味わいは、このデモ用の仮設定です。'
              }
            </p>
          </details>

          <details>
            <summary>{'「ナッツ」や「カカオ」は原材料ですか？'}</summary>
            <p>
              {
                '珈琲豆の説明にある「ナッツ」や「カカオ」は風味の表現です。原材料は商品ごとの表示をご確認ください。アレルギーへの対応や製造設備の情報は、このサンプルでは確認できません。'
              }
            </p>
          </details>
        </section>

        <section className={'faq-group'} aria-labelledby={'faq-orders-heading'}>
          <h2 id={'faq-orders-heading'}>{'ご注文・お受け取り'}</h2>

          <details>
            <summary>{'どの店舗で受け取れますか？'}</summary>
            <p>
              {
                '神田店、中目黒店、吉祥寺店、浦和店、大宮店、横浜みなとみらい店を選べます。いずれも架空の店舗で、実際の商品のお受け取りはできません。'
              }
            </p>
          </details>

          <details>
            <summary>{'配送はできますか？ 送料はかかりますか？'}</summary>
            <p>{'このサンプルは店頭受取のみで、受取料は無料です。配送の受付や配送料金は設定していません。'}</p>
          </details>

          <details>
            <summary>{'明日受け取れますか？ 在庫はありますか？'}</summary>
            <p>
              {
                '実際の在庫や受取可能日は確認できません。表示している受取日・時刻はデモ用の仮設定で、ご注文や在庫の確保をお約束するものではありません。'
              }
            </p>
          </details>

          <details>
            <summary>{'利用できる支払い方法は何ですか？'}</summary>
            <p>
              {'受注内容は業務データベースへ保存されますが、決済機能はありません。クレジットカードなどの決済情報は入力しないでください。'}
            </p>
          </details>

          <details>
            <summary>{'注文後の変更・キャンセル・返品はできますか？'}</summary>
            <p>
              {
                'このデモでは受注記録を作成しますが、実際の売買や商品確保は行いません。注文後の変更・キャンセル・返品には対応していません。'
              }
            </p>
          </details>
        </section>

        <section className={'faq-group'} aria-labelledby={'faq-memory-heading'}>
          <h2 id={'faq-memory-heading'}>{'お客様メモリー'}</h2>

          <details>
            <summary>{'相談した好みは何を覚えますか？'}</summary>
            <p>
              {
                '焙煎度、酸味、風味、普段の淹れ方、一袋の予算です。本人が継続的な好みを明示した場合に Agent が保存します。覚えた内容と根拠の発言は、記憶一覧で確認できます。'
              }
            </p>
          </details>

          <details>
            <summary>{'覚えた好みを消せますか？'}</summary>
            <p>
              {
                'はい。記憶一覧から項目ごと、またはまとめて削除できます。相談室で「酸味の好みを忘れて」「メモリーを全部忘れて」と伝えることもできます。'
              }
            </p>
          </details>
        </section>

        <div className={'faq-actions'}>
          <button className={'button secondary faq-back'} data-action={'catalog-view'}>
            <svg className={'icon'}>
              <use href={'#i-arrow'}></use>
            </svg>
            {'お品書きに戻る'}
          </button>
          <button className={'button primary'} data-action={'faq-consult'}>
            <svg className={'icon'}>
              <use href={'#i-chat'}></use>
            </svg>
            {'バリスタ監修 豆選びガイド'}
          </button>
        </div>
      </section>
    </>
  );
}
