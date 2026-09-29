import { STORES } from '../data/catalogue';
import type { Store } from '../types/shop';

function nextPickupDay() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(tomorrow);
  const label = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short',
  }).format(tomorrow);
  return { date, label };
}

export function ShopIntro({ stores = STORES }: { stores?: Store[] }) {
  const pickupDay = nextPickupDay();
  return (
    <>
      <section className={'intro'} aria-labelledby={'shop-heading'}>
        <div className={'intro-top'}>
          <span className={'intro-kicker'}>{'一粒に向き合う、ひと手間を。'}</span>
          <span className={'eyebrow'}>{'MAIKURO COFFEE ROASTERS'}</span>
        </div>

        <h1 className={'serif'} id={'shop-heading'}>
          {'珈琲豆のお品書き'}
        </h1>

        <p className={'intro-copy'}>
          {'豆を見極め、火を入れ、香りを届ける。'}
          <br />
          {'いつもの一杯を、いつもの味で。'}
        </p>

        <div className={'pickup-bar'}>
          <label className={'pickup-choice'}>
            <svg className={'icon'}>
              <use href={'#i-pin'}></use>
            </svg>
            <span>{'お受け取り'}</span>
            <select id={'store-select'} aria-label={'受取店舗'} defaultValue={(stores.find(store => store.id === 'STR-04') ?? stores[0])?.name}>
              {stores.map(store => <option key={store.id} value={store.name} data-store-id={store.id}>{store.name}</option>)}
            </select>
          </label>

          <label className={'pickup-date'}>
            <svg className={'icon'} style={{ width: '14px', height: '14px' }}>
              <use href={'#i-clock'}></use>
            </svg>
            <time id={'pickup-date'} dateTime={pickupDay.date}>{pickupDay.label}</time>
            <select
              id={'time-select'}
              aria-label={'受取時刻'}
              style={{ border: '0', background: 'var(--cp-surface)', fontSize: '11px' }}
            >
              <option>{'15:00'}</option>
              <option>{'15:30'}</option>
              <option>{'16:00'}</option>
              <option>{'16:30'}</option>
            </select>
            <span>{'店頭受取 · 送料無料'}</span>
          </label>
        </div>
      </section>
    </>
  );
}
