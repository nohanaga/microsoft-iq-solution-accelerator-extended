import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition } from 'cytoscape';
import { BookOpen, Download, Maximize2, RotateCcw, Save, ZoomIn, ZoomOut } from 'lucide-react';
import { analyzeBlend, defaultBlendScenario } from './blend';
import type { BlendData, BlendResult, BlendScenario } from './blend';
import { BlendGuide } from './BlendGuide';
import type { BlendLens } from './BlendGuide';
import type { Dataset } from './domain';
import { jpy } from './analytics';
import { downloadJson } from './adapter';
import seed from '../data/blend-dataset.json';

export const blendData = seed as BlendData;
const kg = (grams: number | null) => grams === null ? '未確認' : `${(grams / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 3 })} kg`;
const statusLabel = { pass: '能力内', fail: '能力超過', unknown: '未確認' };

export function BlendDevelopment({ data, scenario, setScenario }: { data: Dataset; scenario: BlendScenario; setScenario: (next: BlendScenario) => void }) {
  const [saveStatus, setSaveStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const storeIds = data.stores.map(store => store.id);
  let result: BlendResult | Error;
  try { result = analyzeBlend(blendData, scenario, storeIds); }
  catch (reason) { result = reason instanceof Error ? reason : new Error('計算できません。'); }
  let baseline: BlendResult | null = null;
  try { baseline = analyzeBlend(blendData, { ...defaultBlendScenario(blendData), storeBags: scenario.storeBags, productionDate: scenario.productionDate }, storeIds); } catch { baseline = null; }
  const shareTotal = scenario.components.reduce((total, row) => total + row.sharePercent, 0);
  const update = (next: BlendScenario) => { setScenario(next); setSaveStatus(''); setSaveError(''); };
  const record = (download: boolean) => {
    if (result instanceof Error) return;
    try {
      const snapshot = { id: crypto.randomUUID(), recordedAt: new Date().toISOString(), datasetId: data.datasetId, datasetVersion: blendData.version, businessAsOf: blendData.asOf, projectId: result.draft.projectId, dataOrigin: 'synthetic', executionMode: 'fixture', retrievalStatus: 'not-connected', approvalStatus: 'not-requested', scenario, result, baseline, sourceData: blendData, stores: data.stores, suppliers: data.suppliers };
      if (download) downloadJson(snapshot, `maikuro-blend-${snapshot.id}.json`);
      else {
        if (new URLSearchParams(location.search).get('fail') === 'save') throw new Error('保存に失敗しました。');
        localStorage.setItem(`micro-coffee-demo:blend:${data.datasetId}`, JSON.stringify(snapshot));
        setSaveStatus(`保存済み：${new Date(snapshot.recordedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST`);
      }
      setSaveError('');
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : '保存できませんでした。'); }
  };
  return <>
    <div className="page-heading"><div><span className="eyebrow">DEV-002</span><h1>ブレンド開発</h1></div><div className="blend-actions"><button title="初期案に戻す" aria-label="初期案に戻す" onClick={() => update(defaultBlendScenario(blendData))}><RotateCcw size={17}/></button><button title="判断材料 JSON" aria-label="判断材料 JSON をダウンロード" disabled={result instanceof Error} onClick={() => record(true)}><Download size={17}/></button><button className="primary" disabled={result instanceof Error} onClick={() => record(false)}><Save size={17}/>判断材料を保存</button></div></div>
    {saveStatus && <p className="message" role="status">{saveStatus}</p>}
    {saveError && <p className="message error" role="alert">{saveError}</p>}
    <div className="development-workbench">
    <section className="scenario-controls" aria-label="ブレンド条件">
      <div className="concept-tabs blend-tabs" role="group" aria-label="配合案">{blendData.blendDrafts.map(draft => <button key={draft.id} aria-pressed={scenario.draftId === draft.id} onClick={() => update({ ...defaultBlendScenario(blendData, draft.id), storeBags: scenario.storeBags, productionDate: scenario.productionDate })}><strong>{draft.name}</strong><span>{blendData.blendComponents.filter(row => row.draftId === draft.id).map(row => row.sharePercent).join(' : ')} / {draft.bagGrams} g 袋</span></button>)}</div>
      <div className="scenario-dates"><label>製造日<input aria-label="製造日" type="date" min="2026-07-09" value={scenario.productionDate} onChange={event => update({ ...scenario, productionDate: event.target.value })}/></label><span className="badge">試作・未販売</span></div>
      <div className="blend-composition"><div><h2>配合</h2><span className={Math.abs(shareTotal - 100) < 0.000001 ? '' : 'fail-text'}>合計 {shareTotal.toLocaleString('ja-JP')}%</span></div><div className="composition-track" role="img" aria-label={`焙煎後の質量比：${scenario.components.map(component => `${blendData.greenBeans.find(bean => bean.id === component.beanId)?.name} ${component.sharePercent}%`).join('、')}。合計 ${shareTotal}%`}>{scenario.components.map(component => <span key={component.beanId} className={`bean-color-${component.beanId}`} style={{ width: `${Math.max(0, Math.min(100, component.sharePercent))}%` }}/>)}</div></div>
      <div className="blend-recipe">{scenario.components.map((component, index) => {
        const bean = blendData.greenBeans.find(row => row.id === component.beanId)!;
        const offer = blendData.beanOffers.find(row => row.id === component.offerId)!;
        const change = (patch: Partial<typeof component>) => update({ ...scenario, components: scenario.components.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row) });
        return <div className="blend-recipe-row" key={bean.id}><strong><i className={`bean-swatch bean-color-${bean.id}`} aria-hidden="true"/>{bean.name}</strong><label className="ratio-input"><span className="sr-only">焙煎後の質量比</span><input aria-label={`${bean.name}の配合比率`} type="number" min={0} max={100} step={1} value={component.sharePercent} onChange={event => change({ sharePercent: Number(event.target.value) })}/><span>%</span></label><label className="supplier-input"><span className="sr-only">補充先</span><select aria-label={`${bean.name}の補充先`} value={component.offerId} onChange={event => change({ offerId: event.target.value })}>{blendData.beanOffers.filter(row => row.beanId === bean.id).map(row => <option key={row.id} value={row.id}>{data.suppliers.find(supplier => supplier.id === row.supplierId)?.name} / {row.qualification === 'approved' ? '承認済み' : '未承認'}</option>)}</select></label><span className="bean-spec">歩留まり {offer.roastYieldPercent === null ? '未確認' : `${offer.roastYieldPercent}%`}<span>{jpy(offer.costPerKgYen)} / 生豆 kg</span></span></div>;
      })}</div>
      <fieldset className="quantity-grid"><legend>店舗配分・製造袋数（200 g / 袋）</legend>{data.stores.map(store => <label key={store.id}><span>{store.name}</span><input aria-label={`${store.name}の袋数`} type="number" min={0} max={100000} step={1} value={scenario.storeBags[store.id] ?? 0} onChange={event => update({ ...scenario, storeBags: { ...scenario.storeBags, [store.id]: Number(event.target.value) } })}/><span>袋</span></label>)}</fieldset>
    </section>
    <div className="analysis-results">{result instanceof Error ? <p role="alert" className="message error">{result.message}</p> : <>
      <section className="metrics" aria-label="ブレンド指標"><div><span>製造数量</span><strong>{result.totalBags.toLocaleString('ja-JP')}<small>袋</small></strong><span>焙煎後 {kg(result.roastedGrams)}</span></div><div><span>生豆必要量</span><strong>{kg(result.greenGrams)}</strong><span>{result.facility.name}</span></div><div><span>見積原料・袋材費 / 袋（税抜）</span><strong>{jpy(result.unitCostYen)}</strong><span>合計 {jpy(result.totalCostYen)}</span></div><div><span>配合案 A との差 / 袋（税抜）</span><strong>{result.unitCostYen === null || baseline?.unitCostYen == null ? '未確認' : jpy(result.unitCostYen - baseline.unitCostYen)}</strong><span>同じ袋数・製造日で比較</span></div></section>
      <BlendGraph data={data} result={result} baseline={baseline} scenario={scenario}/>
      <section><div className="section-heading"><h2>生豆と中央在庫</h2><span>製造日前日までの確定入荷</span></div><div className="table-scroll"><table><thead><tr><th>生豆</th><th>必要量</th><th>既存引当</th><th>確定入荷</th><th>利用可能量</th><th>追加調達必要量</th></tr></thead><tbody>{result.requirements.map(row => <tr key={row.bean.id}><th>{row.bean.name}</th><td>{kg(row.greenGrams)}</td><td>{kg(row.reservedGrams)}</td><td>{kg(row.incomingGrams)}</td><td>{kg(row.availableGrams)}</td><td className={row.shortageGrams !== null && row.shortageGrams > 0 ? 'fail-text' : ''}>{kg(row.shortageGrams)}</td></tr>)}</tbody></table></div></section>
      <section><div className="section-heading"><h2>既存商品の引当</h2><span>引当維持・再配分なし</span></div><div className="table-scroll"><table><thead><tr><th>商品</th><th>共用する生豆</th><th>確保済み数量</th><th>引当 ID</th></tr></thead><tbody>{result.requirements.flatMap(row => row.allocations.map(allocation => <tr key={allocation.id}><th>{blendData.beanProducts.find(product => product.id === allocation.beanProductId)?.name}</th><td>{row.bean.name}</td><td>{kg(allocation.allocatedGrams)}</td><td>{allocation.id}</td></tr>))}</tbody></table></div></section>
      <section><div className="section-heading"><h2>補充先と製造条件</h2><span className={`status ${result.capacityStatus}`}>{statusLabel[result.capacityStatus]}</span></div><p className="scope-note">一日当たり生豆処理可能量：{kg(result.facility.dailyCapacityGrams)} / 他案件の確定負荷控除後の仮設定</p><div className="table-scroll"><table><thead><tr><th>生豆 / 補充先</th><th>輸入元</th><th>追加発注時の入荷目安</th><th>見積有効期限</th><th>確認事項</th></tr></thead><tbody>{result.requirements.map(row => <tr key={row.bean.id}><th>{row.bean.name}<br/>{data.suppliers.find(supplier => supplier.id === row.offer.supplierId)?.name}</th><td>{blendData.beanImporters.find(importer => importer.id === row.offer.importerId)?.name}</td><td>{row.earliestArrival ?? '未確認'}</td><td>{row.offer.validUntil}</td><td>{row.checks.join(' / ') || '登録条件内'}</td></tr>)}</tbody></table></div>
        <h3>補充先の共通依存</h3><div className="table-scroll"><table><thead><tr><th>輸入元</th><th>供給会社</th><th>対象生豆</th><th>追加調達必要量</th></tr></thead><tbody>{result.importerExposure.map(row => {
          const requirements = result.requirements.filter(requirement => requirement.offer.importerId === row.importer.id);
          const shortage = requirements.some(requirement => requirement.shortageGrams === null) ? null : requirements.reduce((total, requirement) => total + requirement.shortageGrams!, 0);
          return <tr key={row.importer.id}><th>{row.importer.name}</th><td>{row.supplierIds.map(id => data.suppliers.find(supplier => supplier.id === id)?.name).join(' / ')}</td><td>{row.beanIds.map(id => blendData.greenBeans.find(bean => bean.id === id)?.name).join(' / ')}</td><td>{kg(shortage)}</td></tr>;
        })}</tbody></table></div>
      </section>
      <p className="scope-note">数量・価格・歩留まり・供給関係は合成設定です。見積原料・袋材費は補充価格基準で、人件費・エネルギー・運賃は対象外です。官能評価、実ロット、供給可能数量、店舗への配送所要日数は未確認です。</p>
    </>}</div></div>
  </>;
}

function BlendGraph({ data, result, baseline, scenario }: { data: Dataset; result: BlendResult; baseline: BlendResult | null; scenario: BlendScenario }) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);
  const [lens, setLens] = useState<BlendLens>('upstream');
  const [detail, setDetail] = useState('補充条件・既存引当');
  useEffect(() => {
    if (!container.current) return;
    const elements = new Map<string, ElementDefinition>();
    const node = (id: string, label: string, kind: string, description: string) => elements.set(id, { data: { id, label, kind, description } });
    const edge = (source: string, target: string, label: string) => elements.set(`${source}:${target}`, { data: { id: `${source}:${target}`, source, target, label } });
    node('blend-root', result.draft.name, 'blend', `${result.totalBags} 袋 / 焙煎後 ${kg(result.roastedGrams)}`);
    node(result.facility.id, result.facility.name, 'facility', `生豆処理 ${kg(result.greenGrams)}`);
    edge('blend-root', result.facility.id, '製造');
    for (const [storeId, bags] of Object.entries(scenario.storeBags).filter(([, bags]) => bags > 0)) {
      node(storeId, data.stores.find(store => store.id === storeId)?.name ?? storeId, 'store', `${bags} 袋の配分案`);
      edge(result.facility.id, storeId, `${bags} 袋`);
    }
    for (const row of result.requirements) {
      node(row.bean.id, row.bean.name, 'bean', `生豆 ${kg(row.greenGrams)} / 追加調達 ${kg(row.shortageGrams)}`);
      edge('blend-root', row.bean.id, `${row.sharePercent}%`);
      node(row.offer.id, row.offer.id, 'offer', `補充条件 / ${row.checks.join(' / ') || '登録条件内'}`);
      edge(row.bean.id, row.offer.id, '補充条件');
      node(row.offer.supplierId, data.suppliers.find(supplier => supplier.id === row.offer.supplierId)?.name ?? row.offer.supplierId, 'supplier', '補充先の供給会社');
      edge(row.offer.id, row.offer.supplierId, '供給会社');
      const importer = blendData.beanImporters.find(importer => importer.id === row.offer.importerId)!;
      node(importer.id, importer.name, 'importer', '選択した補充条件の上流依存 / 既存在庫のロット来歴ではありません');
      edge(row.offer.id, importer.id, '輸入元');
      for (const allocation of row.allocations) {
        node(allocation.id, `引当 ${kg(allocation.allocatedGrams)}`, 'allocation', allocation.id);
        node(allocation.beanProductId, blendData.beanProducts.find(product => product.id === allocation.beanProductId)?.name ?? allocation.beanProductId, 'product', '既存商品の引当を維持');
        edge(row.bean.id, allocation.id, '既存引当');
        edge(allocation.id, allocation.beanProductId, '現行品');
      }
    }
    const css = getComputedStyle(document.documentElement);
    const color = (name: string) => css.getPropertyValue(`--cp-${name}`).trim();
    const instance = cytoscape({ container: container.current, elements: [...elements.values()], minZoom: 0.15, maxZoom: 2.5, layout: { name: 'breadthfirst', directed: true, spacingFactor: 1.15, padding: 24 }, style: [
      { selector: 'node, edge', style: { 'font-family': getComputedStyle(document.body).fontFamily } },
      { selector: 'node', style: { label: 'data(label)', 'background-color': color('surface'), 'border-color': color('border-strong'), 'border-width': 1, color: color('text'), shape: 'roundrectangle', width: 112, height: 44, 'font-size': 11, 'text-wrap': 'wrap', 'text-max-width': '100px', 'text-valign': 'center' } },
      { selector: 'edge', style: { label: 'data(label)', width: 1, 'line-color': color('border-strong'), 'target-arrow-color': color('border-strong'), 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': 9, color: color('text-muted'), 'text-background-color': color('surface-soft'), 'text-background-opacity': 1 } },
      { selector: 'node[kind="blend"]', style: { 'background-color': color('accent'), color: color('accent-fg'), 'border-width': 0, 'font-weight': 700 } },
      { selector: 'node[kind="bean"]', style: { 'border-color': color('accent'), 'border-width': 2 } },
      { selector: 'node[kind="importer"]', style: { 'border-color': color('warning'), 'border-width': 3 } },
      { selector: 'node[kind="product"]', style: { 'background-color': color('link'), color: color('surface'), 'border-width': 0 } },
      { selector: '.guide-muted', style: { opacity: 0.18 } },
      { selector: 'edge.guide-focus', style: { 'line-color': color('accent'), 'target-arrow-color': color('accent'), width: 2.5 } },
      { selector: 'node:selected', style: { 'border-color': color('success'), 'border-width': 3 } }
    ] });
    graph.current = instance;
    setDetail('補充条件・既存引当');
    instance.on('tap', 'node', event => setDetail(`${event.target.data('label')}：${event.target.data('description')}`));
    const observer = new ResizeObserver(() => { instance.resize(); instance.fit(undefined, 24); });
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.destroy(); graph.current = null; };
  }, [data, result, scenario]);
  useEffect(() => {
    const instance = graph.current;
    if (!instance) return;
    instance.batch(() => {
      instance.elements().removeClass('guide-muted guide-focus');
      if (!guideOpen) return;
      const kinds = new Set(lens === 'quantity' ? ['blend', 'bean', 'offer'] : lens === 'upstream' ? ['blend', 'bean', 'offer', 'supplier', 'importer'] : ['blend', 'bean', 'allocation', 'product']);
      const nodes = instance.nodes().filter(node => kinds.has(node.data('kind')));
      const ids = new Set(nodes.map(node => node.id()));
      const focused = nodes.union(instance.edges().filter(edge => ids.has(edge.source().id()) && ids.has(edge.target().id())));
      instance.elements().difference(focused).addClass('guide-muted');
      focused.addClass('guide-focus');
    });
  }, [guideOpen, lens, data, result, scenario]);
  return <section className="graph-section blend-graph-section">
    <div className="section-heading"><h2>影響関係図</h2><div className="graph-tools"><button className="blend-guide-toggle" aria-expanded={guideOpen} aria-controls="blend-guide" onClick={() => setGuideOpen(value => !value)}><BookOpen size={17}/>DEMO 解説</button><button title="拡大" aria-label="ブレンド関係図を拡大" onClick={() => { const instance = graph.current; if (instance) instance.zoom(instance.zoom() * 1.2); }}><ZoomIn size={17}/></button><button title="縮小" aria-label="ブレンド関係図を縮小" onClick={() => { const instance = graph.current; if (instance) instance.zoom(instance.zoom() / 1.2); }}><ZoomOut size={17}/></button><button title="全体を表示" aria-label="ブレンド関係図全体を表示" onClick={() => graph.current?.fit(undefined, 24)}><Maximize2 size={17}/></button></div></div>
    {guideOpen && <BlendGuide data={data} blendData={blendData} result={result} baseline={baseline} scenario={scenario} lens={lens} onLens={setLens}/>}
    <div ref={container} className="graph-canvas" role="img" aria-label={`ブレンド、生豆、補充先、共通輸入元、既存商品の引当の関係図。${guideOpen ? `強調中：${lens === 'quantity' ? '必要量と不足' : lens === 'upstream' ? '輸入元の集中' : '既存商品の引当'}。` : ''}数量と依存先は表にも記載。`}/>
    <p className="graph-selection" aria-live="polite">{detail}</p>
  </section>;
}