export function CatalogueWorkspace({ loading = false }: { loading?: boolean }) {
  return (
    <>
      <div className={'workspace'}>
        <div className={'view-toolbar'} inert={loading}>
          <div className={'view-tabs'} role={'tablist'} aria-label={'商品表示'}>
            <button
              id={'catalog-tab'}
              role={'tab'}
              aria-selected={'true'}
              aria-controls={'catalog-view'}
              data-action={'catalog-view'}
            >
              {'お品書き '}
              <span className={'tab-count'} id={'catalog-count'}>
                {loading ? <span className="skeleton-block skeleton-count" aria-hidden="true" /> : '6'}
              </span>
            </button>

            <button
              id={'compare-tab'}
              role={'tab'}
              aria-selected={'false'}
              aria-controls={'compare-view'}
              tabIndex={'-1'}
              data-action={'compare-view'}
            >
              {'比較する '}
              <span className={'tab-count'} id={'compare-count'}>
                {'0'}
              </span>
            </button>
          </div>

          <label className={'searchbox'} id={'searchbox'}>
            <svg className={'icon'}>
              <use href={'#i-search'}></use>
            </svg>
            <input id={'search'} type={'search'} placeholder={'商品をさがす'} aria-label={'商品を検索'} />
          </label>
        </div>

        <section id={'catalog-view'} role={'tabpanel'} aria-labelledby={'catalog-tab'}>
          <div className={'catalog-controls'} inert={loading}>
            <div className={'category-tabs'} aria-label={'商品カテゴリー'}>
              <button data-category={'beans'} aria-pressed={'true'}>
                {'珈琲豆'}
              </button>
              <button data-category={'cold'} aria-pressed={'false'}>
                {'水出し珈琲'}
              </button>
              <button data-category={'coffee'} aria-pressed={'false'}>
                {'珈琲・ラテ'}
              </button>
              <button data-category={'tea'} aria-pressed={'false'}>
                {'お茶'}
              </button>
              <button data-category={'other'} aria-pressed={'false'}>
                {'お菓子・雑貨'}
              </button>
              <button data-category={'all'} aria-pressed={'false'}>
                {'すべて'}
              </button>
            </div>

            <select id={'sort'} className={'sort'} aria-label={'並べ替え'}>
              <option value={'recommended'}>{'おすすめ順'}</option>
              <option value={'price-low'}>{'価格の低い順'}</option>
              <option value={'price-high'}>{'価格の高い順'}</option>
            </select>
          </div>

          <p className={'catalog-note'} id={'bean-note'} aria-hidden={loading || undefined}>
            {loading ? <span className="skeleton-block skeleton-note" /> : '自家焙煎の六種。すべて 200 g 入り、豆のままでお渡しします。'}
          </p>

          <div className={'product-grid'} id={'product-grid'}>
            {loading && Array.from({ length: 6 }, (_, index) => (
              <div className="product skeleton-product" key={index} aria-hidden="true">
                <div className="skeleton-block skeleton-media" />
                <div className="product-info">
                  <div className="skeleton-block skeleton-caption" />
                  <div className="skeleton-block skeleton-title" />
                  <div className="skeleton-block skeleton-description" />
                  <div className="skeleton-block skeleton-spec" />
                  <div className="price-row">
                    <div className="skeleton-block skeleton-price" />
                    <div className="skeleton-block skeleton-action" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div id={'catalog-empty'} className={'empty'} hidden={true}>
            <svg className={'icon'}>
              <use href={'#i-search'}></use>
            </svg>
            <h3>{'該当する商品がありません'}</h3>
            <p>{'別の言葉やカテゴリーでお探しください。'}</p>
            <button className={'button secondary'} data-action={'all'}>
              {'すべての商品を見る'}
            </button>
          </div>

          <div className={'comparison-tray'} id={'comparison-tray'} hidden={true}>
            <div className={'tray-copy'}>
              <span id={'tray-count'}>{'0'}</span>
              {' 商品を比較に選択中'}
              <small>{'香りや甘さを、並べて見つける。'}</small>
            </div>
            <button className={'button primary'} data-action={'compare-view'}>
              {'比較する'}
              <svg className={'icon'}>
                <use href={'#i-arrow'}></use>
              </svg>
            </button>
          </div>
        </section>

        <section id={'compare-view'} role={'tabpanel'} aria-labelledby={'compare-tab'} hidden={true}></section>
      </div>
    </>
  );
}
