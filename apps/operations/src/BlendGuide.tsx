import { ArrowRight, Boxes, Calculator, Network } from 'lucide-react';
import type { BlendData, BlendResult, BlendScenario } from './blend';
import type { Dataset } from './domain';

export type BlendLens = 'quantity' | 'upstream' | 'products';
const lenses = [
  { id: 'quantity', label: '必要量と不足', icon: Calculator },
  { id: 'upstream', label: '輸入元の集中', icon: Network },
  { id: 'products', label: '既存商品の引当', icon: Boxes }
] as const;
const kg = (grams: number | null) => grams === null ? '未確認' : `${(grams / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 3 })} kg`;
const paths: Record<BlendLens, string[]> = {
  quantity: ['配合案', '生豆', '補充条件・歩留まり'],
  upstream: ['配合案', '生豆', '補充条件', '供給会社・輸入元'],
  products: ['配合案', '共用する生豆', '既存引当', '既存商品']
};

interface BlendGuideProps {
  data: Dataset;
  blendData: BlendData;
  result: BlendResult;
  baseline: BlendResult | null;
  scenario: BlendScenario;
  lens: BlendLens;
  onLens: (lens: BlendLens) => void;
}

export function BlendGuide({ data, blendData, result, baseline, scenario, lens, onLens }: BlendGuideProps) {
  const sharedImporters = result.importerExposure.filter(group => group.beanIds.length > 1);
  const unknownStock = result.requirements.filter(row => row.availableGrams === null);
  const late = result.requirements.filter(row => row.shortageGrams !== null && row.shortageGrams > 0 && row.earliestArrival !== null && row.earliestArrival >= scenario.productionDate);
  const products = [...new Set(result.requirements.flatMap(row => row.allocations.map(allocation => allocation.beanProductId)))];
  const reserved = result.requirements.reduce((total, row) => total + row.reservedGrams, 0);
  const supplierName = (id: string) => data.suppliers.find(supplier => supplier.id === id)?.name ?? id;
  return <div className="blend-guide" id="blend-guide">
    <div className="blend-guide-intro"><h3>配合と調達の判断</h3><span className="badge">現在の入力に連動 / 合成データ</span></div>
    <p>味の良し悪しではなく、<strong>この配合を、既存商品の引当を守りながら製造できるか</strong>を検討します。比率は焙煎後の重さで、購入する生豆の比率とは異なります。</p>
    <div className="blend-lenses" role="group" aria-label="関係図の着眼点">{lenses.map(option => <button key={option.id} aria-pressed={lens === option.id} onClick={() => onLens(option.id)}><option.icon size={16}/>{option.label}</button>)}</div>
    <ol className="blend-guide-path" aria-label="強調する関係の経路">{paths[lens].map((label, index) => <li key={label}>{index > 0 && <ArrowRight size={14} aria-hidden="true"/>}<span>{label}</span></li>)}</ol>
    <div className="blend-guide-reading" aria-live="polite">
      {lens === 'quantity' && <>
        <h4>焙煎後 {kg(result.roastedGrams)} に、生豆 {kg(result.greenGrams)} が必要です</h4>
        <p>{result.totalBags.toLocaleString('ja-JP')} 袋 × {result.draft.bagGrams} g × 配合比率 ÷ 焙煎歩留まりで、豆ごとの必要量を求めます。案 A も同じ袋数・製造日で比較しています。</p>
        <div className="table-scroll"><table><thead><tr><th>生豆</th><th>配合</th><th>案 A の必要量</th><th>現在の必要量</th><th>追加調達</th></tr></thead><tbody>{result.requirements.map(row => {
          const original = baseline?.requirements.find(candidate => candidate.bean.id === row.bean.id);
          const originalGrams = baseline === null ? null : original ? original.greenGrams : 0;
          return <tr key={row.bean.id}><th>{row.bean.name}</th><td>{row.sharePercent}%</td><td>{kg(originalGrams)}</td><td>{kg(row.greenGrams)}</td><td>{kg(row.shortageGrams)}</td></tr>;
        })}</tbody></table></div>
        <p className="blend-guide-conclusion"><strong>判断への意味：</strong>同じ豆・補充先なら図のつながりは変わりません。変わるのは比率と必要量です。必要量の合計が減っても、在庫が少ない豆に配合が寄れば不足は増えるため、豆ごとの不足と製造日を照合します。</p>
        {!!late.length && <p className="fail-text">{late.map(row => `${row.bean.name}：追加 ${kg(row.shortageGrams)}、入荷目安 ${row.earliestArrival}`).join(' / ')}。製造日 {scenario.productionDate} の前日までに到着しない見込みです。</p>}
        {!!unknownStock.length && <p>{unknownStock.map(row => row.bean.name).join('・')}の在庫は未確認です。不足ゼロとは扱えません。</p>}
      </>}
      {lens === 'upstream' && <>
        <h4>{sharedImporters.length ? `共通の輸入元 ${sharedImporters.length} 社に、複数の豆の補充経路が集まっています` : '現在の補充先では、複数の豆に共通する輸入元はありません'}</h4>
        <ul className="blend-dependency-list">{result.importerExposure.map(group => {
          const related = result.requirements.filter(row => row.offer.importerId === group.importer.id);
          const share = related.reduce((total, row) => total + row.sharePercent, 0);
          return <li key={group.importer.id}><strong>{group.importer.name}</strong><span>供給会社 {group.supplierIds.length} 社 / 焙煎後配合の {share.toLocaleString('ja-JP')}%</span><span>生豆必要量 {kg(group.greenGrams)}</span>{related.map(row => <p key={row.bean.id}>{row.bean.name} / {supplierName(row.offer.supplierId)}{row.offer.qualification !== 'approved' && <span className="status unknown">供給資格未承認</span>}</p>)}</li>;
        })}</ul>
        <p className="blend-guide-conclusion"><strong>判断への意味：</strong>供給会社が別でも、経路が同じ輸入元へ合流するなら上流は分散していません。補充が止まった場合に、確認すべき豆と供給会社を一緒に追えます。</p>
        <p>補充先の変更は、輸入元だけでなく価格・入荷目安・供給資格も変えます。<strong>別の輸入元に替えるだけでは、製造できるとは判断できません。</strong></p>
      </>}
      {lens === 'products' && <>
        <h4>同じ生豆を使う既存商品は {products.length} 商品、確保済みは {kg(reserved)} です</h4>
        <ul className="blend-dependency-list">{products.map(id => <li key={id}><strong>{blendData.beanProducts.find(product => product.id === id)?.name ?? id}</strong><p>{result.requirements.flatMap(row => row.allocations.filter(allocation => allocation.beanProductId === id).map(allocation => `${row.bean.name} ${kg(allocation.allocatedGrams)}`)).join(' / ')}</p></li>)}</ul>
        <p className="blend-guide-conclusion"><strong>判断への意味：</strong>新ブレンドだけに使える在庫ではありません。生豆から引当をたどると、在庫を融通する前に調整が必要な既存商品が分かります。</p>
        <p>利用可能量は「手持ち ＋ 製造日前日までの確定入荷 − 既存引当」です。現在は引当を維持して不足を計算しており、既存商品の欠品や注文取消を予測した結果ではありません。</p>
      </>}
    </div>
    <details className="blend-ontology-note"><summary>オントロジーを使う意味</summary>
      <dl><div><dt>計算で分かること</dt><dd>必要量・原料費・不足量は通常の計算で求められます。オントロジーが自動で計算する特別な値ではありません。</dd></div>
        <div><dt>関係をたどって分かること</dt><dd>「別の供給会社がどの輸入元を共用するか」「この豆をどの既存商品が確保しているか」を横断して確認できます。図の合流と分岐が、その確認範囲を表します。</dd></div>
        <div><dt>オントロジーを採用する理由</dt><dd>生豆・補充条件・引当・商品とその関係を共通定義にして、開発・調達・在庫担当やエージェントが同じ意味で再利用するためです。この画面だけならテーブルと SQL の結合でも実現できます。</dd></div>
        <div><dt>このデモの範囲</dt><dd>ローカルの合成データを計算・描画しています。Fabric Ontology への照会は未接続です。味・需要・遅延確率・実在庫ロットの来歴は分かりません。</dd></div></dl>
      <a href="https://learn.microsoft.com/fabric/iq/ontology/overview" target="_blank" rel="noreferrer">Microsoft Learn：Ontology の概念・関係・データへの接続</a>
    </details>
    <p className="scope-note">図は選択した補充条件の依存関係です。既存在庫の仕入元や、障害発生の事実を示すものではありません。</p>
  </div>;
}