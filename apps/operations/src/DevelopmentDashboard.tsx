import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, CheckCircle2, Coffee, Database, Download, Globe2, Package, Plus, RotateCcw, Save, SlidersHorizontal, Trash2, TriangleAlert } from 'lucide-react';
import { downloadJson } from './adapter';
import { jpy } from './analytics';
import { beanChanges, beanImpactFocusIds, beanImpactScopeIds, buildBeanImpact } from './bean-impact';
import { BeanImpactFlow } from './BeanImpactFlow';
import { clearImpactGraphCache, collectImpactGraph, graphCacheChangedEvent } from './fabric-impact';
import type { FabricGraphSnapshot } from './fabric-impact';
import { graphAuthenticationEvent, GraphSignInRequiredError, signInToGraph } from './fabric-graph-auth';
import { calculateBlend, formatKg, initialBlendScenario, materializeBlend, scenarioComponents } from './blend-workbench-model';
import type { BlendComponent, BlendScenario, DevelopmentView } from './blend-workbench-model';
import { blendGraphScope, developmentOntology } from './ontology-records';
import type { RecordSelection } from './ontology-records';
import { OntologyExplorer } from './OntologyExplorer';
import { BeanDepletionPanel } from './MlPredictions';
import { useWorkspace } from './workspace-context';
import { scenarioSchema } from './workspace-schema';
import type { SavedRecord } from './workspace-schema';
import './development-dashboard.css';

interface DevelopmentDashboardProps { view: DevelopmentView; scenario: BlendScenario; onScenario: (next: BlendScenario) => void; selection: RecordSelection | null; onSelection: (next: RecordSelection | null) => void; caseMode?: boolean }
const beanColors = ['--cp-accent', '--cp-link', '--cp-success', '--cp-warning', '--cp-text-soft', '--cp-border-strong'];

export function DevelopmentDashboard({ view, scenario, onScenario, selection, onSelection, caseMode = false }: DevelopmentDashboardProps) {
  const { data, repository, mode } = useWorkspace();
  const predictions = data.predictions;
  const workbenchData = data.development;
  const colorFor = (materialId: string) => `var(${beanColors[Math.max(0, workbenchData.materials.findIndex(row => row.id === materialId)) % beanColors.length]})`;
  const [saved, setSaved] = useState<SavedRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const [newBean, setNewBean] = useState('');
  const [includeStock, setIncludeStock] = useState(false);
  const [impactDepth, setImpactDepth] = useState(2);
  const [simplified, setSimplified] = useState(true);
  const [includeSupply, setIncludeSupply] = useState(true);
  const [impactGraph, setImpactGraph] = useState<{ snapshot: FabricGraphSnapshot | null; loading: boolean; error: string; authRequired: boolean }>({ snapshot: null, loading: false, error: '', authRequired: false });
  const [graphRevision, setGraphRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const products = workbenchData.products.filter(row => row.category === view);
  const product = products.find(row => row.id === scenario.productId) ?? products[0];
  const recipes = workbenchData.recipes.filter(row => row.productId === product.id);
  const components = scenarioComponents(scenario, workbenchData);
  const totalPercent = components.reduce((total, row) => total + row.percent, 0);
  const sourceData = materializeBlend(scenario, workbenchData);
  const model = developmentOntology(sourceData);
  let result;
  try { result = calculateBlend(scenario, workbenchData); } catch (reason) { result = reason instanceof Error ? reason : new Error('配合を確認してください。'); }
  useEffect(() => {
    if (caseMode) return;
    const controller = new AbortController();
    setSaved([]);
    repository.listRecords(view, controller.signal).then(rows => { if (!controller.signal.aborted) setSaved(rows); })
      .catch(reason => { if (!controller.signal.aborted) setNotice(`保存履歴を取得できません: ${reason instanceof Error ? reason.message : '接続エラー'}`); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, [repository, view, caseMode]);
  const change = (next: BlendScenario) => { onScenario(next); setNotice(''); onSelection(null); };
  const custom = (rows: BlendComponent[]) => change({ ...scenario, custom: rows });
  const edit = (materialId: string, percent: number) => custom(components.map(row => row.materialId === materialId ? { ...row, percent } : { ...row }));
  const addBean = () => {
    if (!newBean || components.some(row => row.materialId === newBean)) return;
    const rows = Math.abs(totalPercent - 100) < .001 ? components.map(row => ({ ...row, percent: Math.round(row.percent * .9 * 10) / 10 })) : components.map(row => ({ ...row }));
    if (Math.abs(totalPercent - 100) < .001 && rows.length) rows[rows.length - 1].percent += Number((90 - rows.reduce((total, row) => total + row.percent, 0)).toFixed(1));
    custom([...rows, { materialId: newBean, percent: 10 }]); setNewBean('');
  };
  const save = async (download: boolean) => {
    if (caseMode || result instanceof Error || pending.current) return;
    const snapshot = { id: crypto.randomUUID(), datasetId: sourceData.datasetId, recordedAt: new Date().toISOString(), dataOrigin: sourceData.dataOrigin, executionMode: mode, status: 'draft', scenario, calculation: result, tables: sourceData };
    const controller = new AbortController();
    pending.current = controller; setSaving(true);
    try {
      if (download) downloadJson(snapshot, `maikuro-blend-${snapshot.id}.json`);
      else {
        const record = await repository.saveRecord({ id: snapshot.id, kind: view, recordedAt: snapshot.recordedAt, datasetVersion: sourceData.version, payload: snapshot }, controller.signal);
        if (!controller.signal.aborted) setSaved(previous => [record, ...previous.filter(row => row.id !== record.id)]);
      }
      if (!controller.signal.aborted) setNotice(download ? '配合データを出力しました。' : mode === 'live' ? '試算を SQL に保存しました。' : '試算をメモリーに保存しました。');
    } catch (reason) { if (!controller.signal.aborted) setNotice(`保存結果を確認できません: ${reason instanceof Error ? reason.message : '接続エラー'}`); }
    finally { if (!controller.signal.aborted) setSaving(false); pending.current = null; }
  };
  const restore = (recordId: string) => {
    const record = saved.find(row => row.id === recordId);
    if (!record) return;
    try {
      const restored = scenarioSchema.parse(record.payload.scenario);
      const target = workbenchData.products.find(row => row.id === restored.productId && row.category === view);
      if (!target) throw new Error('対象商品が現在のデータにありません。');
      calculateBlend(restored, workbenchData);
      change(restored);
      setNotice(`保存日時 ${record.recordedAt} / 現在のデータで再計算しています。`);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '試算を再開できません。'); }
  };
  const calculation = result instanceof Error ? null : result;
  const failure = result instanceof Error ? result : null;
  const changes = useMemo(() => beanChanges(scenario, workbenchData), [scenario, workbenchData]);
  // 取得範囲は登録済みの焺煎豆全体に固定する。配合をいじってもキーが変わらないので再取得が発生しない。
  const scopeKey = useMemo(
    () => beanImpactScopeIds(changes, workbenchData.materials.map(row => row.id)).join(','),
    [changes, workbenchData],
  );
  const focusRecordIds = useMemo(() => beanImpactFocusIds(changes), [changes]);
  const graphAvailable = mode === 'live';
  useEffect(() => {
    const retry = () => setGraphRevision(value => value + 1);
    window.addEventListener(graphAuthenticationEvent, retry);
    window.addEventListener(graphCacheChangedEvent, retry);
    return () => { window.removeEventListener(graphAuthenticationEvent, retry); window.removeEventListener(graphCacheChangedEvent, retry); };
  }, []);
  useEffect(() => {
    if (!graphAvailable || !scopeKey) {
      setImpactGraph({ snapshot: null, loading: false, error: '', authRequired: false });
      return;
    }
    const controller = new AbortController();
    setImpactGraph(current => ({ ...current, loading: true, error: '', authRequired: false }));
    collectImpactGraph({
      expand: (request, signal) => repository.graphExpand(request, signal),
      scopeTableId: 'materials', scopeRecordIds: scopeKey.split(','),
      depth: impactDepth, includeSupply, signal: controller.signal,
    }).then(snapshot => { if (!controller.signal.aborted) setImpactGraph({ snapshot, loading: false, error: '', authRequired: false }); })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setImpactGraph({ snapshot: null, loading: false, authRequired: reason instanceof GraphSignInRequiredError,
          error: reason instanceof Error ? reason.message : 'Fabric Graph に接続できません。' });
      });
    return () => controller.abort();
  }, [repository, graphAvailable, scopeKey, impactDepth, includeSupply, graphRevision]);
  const impact = useMemo(() => impactGraph.snapshot
    ? buildBeanImpact({ snapshot: impactGraph.snapshot, changes, focusRecordIds, calculation, depth: impactDepth, simplified })
    : null, [impactGraph.snapshot, changes, focusRecordIds, calculation, impactDepth, simplified]);
  const reloadGraph = () => { void clearImpactGraphCache(); };
  const signIn = async () => {
    try { await signInToGraph(); }
    catch (reason) { setImpactGraph(current => ({ ...current, error: reason instanceof Error ? reason.message : 'Graph にサインインできません。' })); }
  };
  const disabled = calculation === null || caseMode;
  return <div className="development-dashboard" data-demo-target="development" data-demo-state={failure ? 'error' : 'ready'} data-case-mode={caseMode}>
    <header className="dd-heading"><div><span className="eyebrow">商品ポートフォリオ</span><h1>商品開発</h1></div><div className="dd-actions"><button title="初期配合に戻す" aria-label="初期配合に戻す" onClick={() => change(initialBlendScenario(view, workbenchData))}><RotateCcw size={17}/></button><button title="配合 JSON を出力" aria-label="配合 JSON を出力" disabled={disabled || saving} onClick={() => void save(true)}><Download size={17}/></button><button title="配合を保存" aria-label="配合を保存" disabled={disabled || saving} onClick={() => void save(false)}><Save size={16}/><span>{saving ? '保存中' : '配合を保存'}</span></button></div></header>
    {!caseMode && <div className="workspace-record-actions"><label>保存した試算<select aria-label="保存した試算を再開" value="" onChange={event => restore(event.target.value)}><option value="">選択してください</option>{saved.map(record => <option key={record.id} value={record.id}>{new Date(record.recordedAt).toLocaleString('ja-JP')} / {record.datasetVersion}</option>)}</select></label><span>{saved.length} 件</span></div>}
    <nav className="dd-navigation" aria-label="商品開発の業務"><a href="#/ops/development/DEV-001" aria-current={view === 'beverage' ? 'page' : undefined}><Coffee size={17}/>飲料開発</a><a href="#/ops/development/DEV-002" aria-current={view === 'blend' ? 'page' : undefined}><Package size={17}/>ブレンド調合</a><span>{workbenchData.products.length} 商品 / {workbenchData.materials.length} 種の豆 / {workbenchData.origins.length} 産地</span></nav>
    {notice && <p className="message" role="status">{notice}</p>}
    <div className="dd-workbench"><aside className="dd-controls" aria-label="ブレンド調合条件">
      <div className="dd-product"><img src={view === 'beverage' ? 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=240&q=80' : 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=240&q=80'} alt="珈琲の参考イメージ" referrerPolicy="no-referrer"/><label>対象商品<select aria-label="開発する商品" value={product.id} onChange={event => { const recipe = workbenchData.recipes.find(row => row.productId === event.target.value)!; change({ ...scenario, productId: event.target.value, recipeId: recipe.id, custom: null }); }} >{products.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><small>{product.gramsPerUnit} g / {product.unit}</small></label></div>
      <div className="dd-controls-heading"><h2><SlidersHorizontal size={16}/>豆の配合</h2><span className={Math.abs(totalPercent - 100) < .001 ? '' : 'dd-error-text'}>{Number(totalPercent.toFixed(2))}%</span></div>
      <div className="dd-presets" role="group" aria-label="配合案">{recipes.map(recipe => { const lines = workbenchData.recipeLines.filter(row => row.recipeId === recipe.id); return <button key={recipe.id} aria-pressed={!scenario.custom && scenario.recipeId === recipe.id} onClick={() => change({ ...scenario, recipeId: recipe.id, custom: null })}><strong>{recipe.name}</strong><span>{lines.map(row => workbenchData.materials.find(material => material.id === row.materialId)?.name.replace('豆', '')).join(' + ')}</span></button>; })}<button aria-pressed={!!scenario.custom} onClick={() => custom(components.map(row => ({ ...row })))}><strong>カスタム</strong><span>オリジナル配合</span></button></div>
      <div className="dd-composition" role="img" aria-label={components.map(row => `${workbenchData.materials.find(material => material.id === row.materialId)?.name} ${row.percent}%`).join('、')}>{components.map(row => <span key={row.materialId} style={{ width: `${totalPercent > 0 ? row.percent / totalPercent * 100 : 0}%`, background: colorFor(row.materialId) }}/>)}</div>
      <div className="dd-components">{components.map(component => { const material = workbenchData.materials.find(row => row.id === component.materialId)!; const origin = workbenchData.origins.find(row => row.id === material.originId)!; return <div className="dd-component" key={component.materialId}>
        <div className="dd-component-heading"><i style={{ background: colorFor(material.id) }}/><strong>{material.name}</strong><button title={`${material.name}を除く`} aria-label={`${material.name}を除く`} disabled={components.length <= 1} onClick={() => custom(components.filter(row => row.materialId !== material.id))}><Trash2 size={14}/></button></div>
        <span className="dd-origin"><Globe2 size={12}/>{origin.name} / {origin.region}<span>{jpy(material.pricePerKg)} / kg</span></span>
        <div className="dd-ratio-control"><input type="range" aria-label={`${material.name}の比率スライダー`} min={1} max={100} step={1} value={component.percent} onChange={event => edit(material.id, Number(event.target.value))}/><input type="number" aria-label={`${material.name}の配合率`} min={0.1} max={100} step={0.1} value={component.percent} onChange={event => edit(material.id, Number(event.target.value))}/><span>%</span></div>
      </div>; })}</div>
      <div className="dd-add-bean"><select aria-label="追加する豆の産地" value={newBean} onChange={event => setNewBean(event.target.value)}><option value="">豆・産地を選択</option>{workbenchData.materials.filter(row => !components.some(component => component.materialId === row.id)).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button title="豆を追加" aria-label="豆を追加" disabled={!newBean} onClick={addBean}><Plus size={17}/></button></div>
      <div className="dd-production"><label>追加製造数<div><input aria-label="追加製造数" type="number" min={1} max={10000} step={1} value={scenario.units} onChange={event => change({ ...scenario, units: Number(event.target.value) })}/><span>{product.unit}</span></div></label><label>製造拠点<select aria-label="製造拠点" value={scenario.facilityId} onChange={event => change({ ...scenario, facilityId: event.target.value })}>{workbenchData.facilities.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>
      <div className="dd-catalog-link"><button onClick={() => onSelection({ tableId: 'materials' })}><Database size={14}/>豆のマスター</button><span>参考価格・税抜</span></div>
    </aside><div className="dd-analysis">
      <section className="dd-metrics" aria-label="配合の集計"><div><span>焙煎豆の必要量</span><strong>{calculation ? formatKg(calculation.totalGrams) : '-'}<small>kg</small></strong><span>{scenario.units.toLocaleString('ja-JP')} {product.unit} × {product.gramsPerUnit} g</span></div><div><span>豆の原価 / {product.unit}</span><strong>{calculation ? jpy(calculation.costPerUnit) : '-'}</strong><span>牛乳・包材・加工費を除く</span></div><div><span>使用する産地</span><strong>{new Set(components.map(row => workbenchData.materials.find(material => material.id === row.materialId)?.originId)).size}<small>産地</small></strong><span>{scenario.custom ? 'カスタム' : recipes.find(row => row.id === scenario.recipeId)?.name}</span></div></section>
      <div className={`dd-outcome${!calculation || calculation.shortageGrams > 0 ? ' is-risk' : calculation.unknownCount ? ' is-unknown' : ''}`} role="status">{!calculation || calculation.shortageGrams > 0 || calculation.unknownCount ? <TriangleAlert size={19}/> : <CheckCircle2 size={19}/>}<div><strong>{calculation ? (calculation.unknownCount ? `在庫未確認 ${calculation.unknownCount} 種` : calculation.shortageGrams > 0 ? `追加調達 ${formatKg(calculation.shortageGrams)} kg` : '在庫条件内') : failure?.message}</strong><span>{calculation ? (calculation.unknownCount ? `確認済みの不足 ${formatKg(calculation.shortageGrams)} kg` : '既存の確保数量を控除した追加製造の試算') : '配合を調整してください'}</span></div></div>
      <BeanImpactFlow impact={impact} depth={impactDepth} onDepth={setImpactDepth} onSelect={onSelection}
        simplified={simplified} onSimplified={setSimplified} includeSupply={includeSupply} onIncludeSupply={setIncludeSupply}
        status={{ loading: impactGraph.loading, error: impactGraph.error, authRequired: impactGraph.authRequired, available: graphAvailable }}
        onRetry={reloadGraph} onSignIn={() => void signIn()}/>
      <div className="dd-graph-options"><span>{product.name} / {scenario.custom ? 'カスタム' : recipes.find(row => row.id === scenario.recipeId)?.name}</span><label><input type="checkbox" checked={includeStock} onChange={event => setIncludeStock(event.target.checked)}/>在庫・調達先</label></div>
      <OntologyExplorer model={model} fabricModel="development" scope={blendGraphScope(scenario, includeStock, sourceData)} columns={[[ 'products' ], [ 'recipes' ], [ 'recipeLines' ], [ 'materials' ], [ 'origins', 'stocks', 'suppliers' ], ['plans', 'reservations', 'facilities']]} selection={selection} onSelection={onSelection} highlights={calculation ? calculation.requirements.filter(row => (row.shortageGrams ?? 0) > 0).map(row => `materials:${row.material.id}`) : []} title="配合と産地のオントロジー"/>
      {calculation && <section className="dd-stock"><div className="section-heading"><h2><Boxes size={16}/>豆の必要量と在庫</h2><span>kg / {workbenchData.facilities.find(row => row.id === scenario.facilityId)?.name}</span></div><div className="table-scroll"><table><thead><tr><th>豆・産地</th><th>配合</th><th>必要量</th><th>在庫</th><th>確保済み</th><th>利用可能</th><th>不足</th></tr></thead><tbody>{calculation.requirements.map(row => <tr key={row.material.id}><td><button className="dd-record-link" onClick={() => onSelection({ tableId: 'materials', recordId: row.material.id })}><i style={{ background: colorFor(row.material.id) }}/>{row.material.name}</button></td><td>{row.percent}%</td><td>{formatKg(row.requiredGrams)}</td><td>{row.stockGrams === null ? '未確認' : formatKg(row.stockGrams)}</td><td>{formatKg(row.reservedGrams)}</td><td>{row.availableGrams === null ? '未確認' : formatKg(row.availableGrams)}</td><td className={(row.shortageGrams ?? 0) > 0 ? 'dd-error-text' : ''}>{row.shortageGrams === null ? '未確認' : formatKg(row.shortageGrams)}</td></tr>)}</tbody></table></div></section>}
      <BeanDepletionPanel rows={predictions.beanDepletion} materialName={id => workbenchData.materials.find(row => row.id === id)?.name ?? id}/>
    </div></div>
    <footer className="dd-footer"><span>合成データ / 配合は下書き / 品質・販売承認は別途</span><a href={`#/ops/development/${view === 'beverage' ? 'DEV-001' : 'DEV-002'}/legacy`}>従来の詳細シナリオ</a></footer>
  </div>;
}