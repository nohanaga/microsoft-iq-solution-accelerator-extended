import { AlertTriangle, Brain, TrendingUp } from 'lucide-react';
import { jpy } from './analytics';
import { orderDepletion, summarizeForecast, summarizeLanes } from './predictions';
import type { BeanDepletion, DemandForecast, ShipmentRisk } from './predictions';
import './ml-predictions.css';

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const kg = (grams: number) => `${(grams / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 2 })} kg`;
const cups = (value: number) => Math.round(value).toLocaleString('ja-JP');

function Provenance({ model, note }: { model: string; note: string }) {
  return <p className="mlp-provenance"><Brain size={13}/>モデル {model} ／ {note}</p>;
}

interface SupplyPredictionProps {
  risk: ShipmentRisk[];
  forecast: DemandForecast[];
  storeId: string;
  supplierId: string;
  storeName: (id: string) => string;
  supplierName: (id: string) => string;
}

export function SupplyPredictionPanel({ risk, forecast, storeId, supplierId, storeName, supplierName }: SupplyPredictionProps) {
  const lanes = summarizeLanes(risk, { storeId, supplierId });
  const demand = summarizeForecast(forecast, { storeId });
  if (!lanes.length && !demand) {
    return <section className="mlp-panel" aria-label="機械学習の予測">
      <div className="section-heading"><h2><Brain size={16}/>機械学習の予測</h2></div>
      <p className="empty">予測データは利用できません。供給と注文の業務データは引き続き確認できます。</p>
    </section>;
  }
  const peak = demand ? Math.max(...demand.byDay.map(row => row.upper)) : 1;
  return <section className="mlp-panel" aria-label="機械学習の予測">
    <div className="section-heading"><h2><Brain size={16}/>機械学習の予測</h2><span>Fabric の gold テーブル</span></div>

    {demand && <div className="mlp-block">
      <h3><TrendingUp size={14}/>需要予測（{demand.days} 日先まで）</h3>
      <div className="mlp-headline">
        <strong>{cups(demand.totalCups)}<small>杯</small></strong>
        <span>95% 区間 {cups(demand.lowerCups)} 〜 {cups(demand.upperCups)} 杯</span>
        <span>{demand.from} 〜 {demand.to}</span>
      </div>
      <div className="mlp-spark" role="img" aria-label={`日別の予測杯数。合計 ${cups(demand.totalCups)} 杯`}>
        {demand.byDay.map(row => <span key={row.day} title={`${row.day}：${cups(row.cups)} 杯（${cups(row.lower)}〜${cups(row.upper)}）`}>
          <i className="mlp-band" style={{ height: `${row.upper / peak * 100}%` }}/>
          <i className="mlp-point" style={{ height: `${row.cups / peak * 100}%` }}/>
        </span>)}
      </div>
      <table className="mlp-table">
        <thead><tr><th>店舗</th><th>予測杯数</th><th>95% 区間</th></tr></thead>
        <tbody>{demand.byStore.map(row => <tr key={row.storeId}>
          <td>{storeName(row.storeId)}</td><td>{cups(row.cups)}</td>
          <td className="mlp-muted">{cups(row.lower)} 〜 {cups(row.upper)}</td>
        </tr>)}</tbody>
      </table>
      <Provenance model={demand.modelVersion} note="実績は実線、予測は網掛け。点推定だけでは判断しません"/>
    </div>}

    {!!lanes.length && <div className="mlp-block">
      <h3><AlertTriangle size={14}/>入荷の遅延リスク（供給会社 × 店舗）</h3>
      <table className="mlp-table">
        <thead><tr><th>経路</th><th>便</th><th>遅延確率</th><th>欠品確率</th><th>期待逸失額</th><th>実績</th></tr></thead>
        <tbody>{lanes.slice(0, 8).map(row => <tr key={`${row.supplierId}-${row.storeId}`}>
          <td>{supplierName(row.supplierId)} → {storeName(row.storeId)}</td>
          <td>{row.shipments}</td>
          <td className={row.delayProbability >= .3 ? 'mlp-risk' : ''}>{percent(row.delayProbability)}</td>
          <td>{percent(row.shortageProbability)}</td>
          <td>{jpy(row.expectedLossExTax)}</td>
          <td className="mlp-muted">遅延 {percent(row.actualDelayRate)} / {jpy(row.actualAmountExTax)}</td>
        </tr>)}</tbody>
      </table>
      <p className="mlp-caveat"><AlertTriangle size={13}/><strong>この金額は校正されていません。</strong>検証区間の予測合計は実績の約 2 倍で、絶対額ではなく経路の優先順位付けに使ってください。学習は 500 便の合成履歴、検証 ROC AUC は 0.668 です。</p>
      <Provenance model={lanes[0] && risk[0]?.modelVersion ? risk[0].modelVersion : '不明'} note="対象は ML 学習用の合成入荷便で、上の入荷便一覧とは別のレコードです"/>
    </div>}
  </section>;
}

export function BeanDepletionPanel({ rows, materialName }: { rows: BeanDepletion[]; materialName: (id: string) => string }) {
  if (!rows.length) {
    return <section className="mlp-panel" aria-label="豆の枯渇予測">
      <div className="section-heading"><h2><Brain size={16}/>豆の枯渇予測</h2></div>
      <p className="empty">予測データは利用できません。商品開発の業務データは引き続き確認できます。</p>
    </section>;
  }
  const ordered = orderDepletion(rows);
  const horizon = ordered[0].horizonDays;
  return <section className="mlp-panel" aria-label="豆の枯渇予測">
    <div className="section-heading"><h2><Brain size={16}/>豆の枯渇予測</h2><span>{horizon} 日先まで</span></div>
    <table className="mlp-table">
      <thead><tr><th>焙煎豆</th><th>利用可能</th><th>予測消費</th><th>持ち日数</th><th>枯渇予測日</th></tr></thead>
      <tbody>{ordered.map(row => <tr key={row.materialId}>
        <td>{materialName(row.materialId)}</td>
        <td>{kg(row.availableGrams)}<small className="mlp-muted">{row.reservedGrams ? ` 確保 ${kg(row.reservedGrams)} 控除後` : ''}</small></td>
        <td>{kg(row.meanDailyGrams)}<small className="mlp-muted"> /日</small></td>
        <td>{row.coverDays === null ? '算出不可' : `${row.coverDays.toFixed(1)} 日`}</td>
        <td className={row.withinHorizon && (row.depletionDayIndex ?? horizon) <= 7 ? 'mlp-risk' : ''}>
          {row.withinHorizon ? row.depletionDate : `${horizon} 日以内に尽きません`}
        </td>
      </tr>)}</tbody>
    </table>
    <p className="mlp-caveat"><AlertTriangle size={13}/>発注を止めた場合に何日で尽きるかを示すものであり、欠品の予告ではありません。在庫が不明な豆と、登録配合に出現しない豆はこの表に現れません。</p>
    <Provenance model={ordered[0].modelVersion} note="需要予測から配合経由で豆の消費量へ換算。販売 SKU と開発商品の対応は学習用の仮定です"/>
  </section>;
}
