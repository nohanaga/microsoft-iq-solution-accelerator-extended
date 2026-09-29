import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { ArrowRight, ArrowUpRight, Boxes, Check, CheckCircle2, Coffee, Database, Download, Maximize2, MessageSquareText, Minus, Network, Package, Plus, RotateCcw, Save, TriangleAlert, ZoomIn, ZoomOut } from 'lucide-react';
import { downloadJson } from './adapter';
import { calculateSharedDevelopment, developmentData, formatKg, initialSharedScenario } from './shared-development-model';
import type { DevelopmentView, SharedDevelopmentResult, SharedScenario } from './shared-development-model';
import './shared-development.css';

interface SharedDevelopmentProps {
  view: DevelopmentView; scenario: SharedScenario;
  onScenario: (value: SharedScenario) => void; onNavigate: (view: DevelopmentView) => void;
}
const photos = {
  beverage: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=720&q=85',
  blend: 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=720&q=85',
};
const lattePlan = developmentData.plans[0];
const latte = developmentData.products.find(product => product.id === lattePlan.productId)!;
const voice = developmentData.voices.find(row => row.productId === latte.id)!;
const latteLine = developmentData.recipeLines.find(line => line.recipeId === lattePlan.recipeId)!;

function ProductPhoto({ view }: { view: DevelopmentView }) {
  const [failed, setFailed] = useState(false);
  return <figure className="shared-photo">
    {failed ? <div className="shared-photo-fallback">{view === 'beverage' ? <Coffee size={72}/> : <Package size={72}/>}</div>
      : <img src={photos[view]} alt={view === 'beverage' ? '珈琲の参考写真' : '焙煎済みの珈琲豆の参考写真'} referrerPolicy="no-referrer" onError={() => setFailed(true)}/>}
    <figcaption>参考イメージ</figcaption>
  </figure>;
}

export function SharedDevelopment({ view, scenario, onScenario, onNavigate }: SharedDevelopmentProps) {
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [selection, setSelection] = useState('');
  const result = (() => {
    try { return calculateSharedDevelopment(scenario); }
    catch (reason) { return reason instanceof Error ? reason : new Error('計算できません。'); }
  })();
  const beverage = view === 'beverage';
  const changeScenario = (next: SharedScenario) => { onScenario(next); setMessage(''); };
  const navigate = (next: DevelopmentView) => { setSelection(''); onNavigate(next); };
  const save = (download: boolean) => {
    if (result instanceof Error) return;
    try {
      const snapshot = { id: crypto.randomUUID(), recordedAt: new Date().toISOString(), datasetId: developmentData.id,
        businessAsOf: developmentData.asOf, dataOrigin: 'synthetic', executionMode: 'fixture', approvalStatus: 'not-requested',
        view, scenario, result, sourceData: developmentData };
      if (download) downloadJson(snapshot, `maikuro-development-v2-${snapshot.id}.json`);
      else localStorage.setItem('micro-coffee-demo:shared-development-v2', JSON.stringify(snapshot));
      setSaveFailed(false); setMessage(download ? '判断材料 JSON を出力しました。' : '判断材料をこのブラウザーに保存しました。');
    } catch { setSaveFailed(true); setMessage('保存できませんでした。'); }
  };
  return <div className={`shared-development shared-view-${view}`}>
    <header className="shared-heading">
      <div><span className="eyebrow">{beverage ? 'DEV-001' : 'DEV-002'} / V2</span><h1>{beverage ? '飲料開発' : 'ブレンド開発'}</h1></div>
      <div className="shared-actions">
        <button aria-label="v2 の初期配合に戻す" title="初期配合に戻す" onClick={() => changeScenario({ ...initialSharedScenario })}><RotateCcw size={17}/></button>
        <button aria-label="v2 の判断材料 JSON をダウンロード" title="判断材料 JSON" disabled={result instanceof Error} onClick={() => save(true)}><Download size={17}/></button>
        <button aria-label="v2 の判断材料を保存" title="判断材料を保存" disabled={result instanceof Error} onClick={() => save(false)}><Save size={16}/><span>判断材料を保存</span></button>
      </div>
    </header>
    <nav className="shared-view-switch" aria-label="業務の視点">
      <a href="#/ops/development/DEV-001" aria-current={beverage ? 'page' : undefined}><Coffee size={18}/><span>飲料開発</span><small>要望から商品へ</small></a>
      <a href="#/ops/development/DEV-002" aria-current={!beverage ? 'page' : undefined}><Package size={18}/><span>ブレンド開発</span><small>配合から影響へ</small></a>
      <span className="shared-model-label"><Network size={15}/>共通の豆・在庫</span>
    </nav>
    {message && <p className={`message${saveFailed ? ' error' : ''}`} role="status">{message}</p>}
    <div className="shared-workbench">
      <aside className="shared-product" aria-label={beverage ? '飲料の計画' : 'ブレンドの配合'}>
        <ProductPhoto view={view} key={view}/>
        <div className="shared-product-title"><span className="shared-kicker">{beverage ? '飲料の企画案' : '200 g / 袋'}</span><h2>{beverage ? latte.name : 'オリジナルブレンド'}</h2></div>
        {beverage ? <>
          <div className="shared-voice"><MessageSquareText size={19}/><div><span>開発のきっかけ</span><blockquote>{voice.text}</blockquote><small>{voice.source}</small></div></div>
          <dl className="shared-plan-facts"><div><dt>提供計画</dt><dd><strong>{lattePlan.units}</strong> 杯</dd></div><div><dt>1 杯に使う豆</dt><dd><strong>{latteLine.gramsPerUnit}</strong> g</dd></div><div><dt>確保済み</dt><dd><strong>{formatKg(developmentData.reservations[0].grams)}</strong> kg</dd></div></dl>
          <div className="shared-plan-state"><CheckCircle2 size={16}/>豆を確保済み</div>
          <button className="shared-next" onClick={() => navigate('blend')}><Package size={16}/>ブレンドの配合を見る<ArrowRight size={16}/></button>
        </> : <>
          <div className="shared-recipe-options" role="group" aria-label="v2 配合案">{developmentData.recipes.filter(recipe => recipe.productId === 'V2-BLEND').map(recipe => {
            const lines = developmentData.recipeLines.filter(line => line.recipeId === recipe.id);
            const colombia = lines.find(line => line.materialId === 'ROASTED-CO')!;
            const percent = colombia.gramsPerUnit / 2;
            return <button key={recipe.id} aria-pressed={scenario.recipeId === recipe.id} onClick={() => changeScenario({ ...scenario, recipeId: recipe.id })}>
              <span className="shared-recipe-name"><strong>{recipe.name}</strong>{scenario.recipeId === recipe.id && <Check size={16}/>}</span>
              <span className="shared-mini-composition"><i style={{ width: `${100 - percent}%` }}/><i style={{ width: `${percent}%` }}/></span>
              <span className="shared-recipe-ratio">{100 - percent}<small>：</small>{percent}</span>
            </button>;
          })}</div>
          <div className="shared-composition-legend"><span><i className="shared-brazil-dot"/>ブラジル</span><span><i className="shared-colombia-dot"/>コロンビア</span></div>
          <label className="shared-quantity"><span>製造袋数</span><span className="shared-stepper"><button type="button" aria-label="袋数を10減らす" disabled={scenario.bags <= 1} onClick={() => changeScenario({ ...scenario, bags: Math.max(1, scenario.bags - 10) })}><Minus size={15}/></button><input aria-label="v2 製造袋数" type="number" min={1} max={1000} step={1} value={scenario.bags} onChange={event => changeScenario({ ...scenario, bags: Number(event.target.value) })}/><button type="button" aria-label="袋数を10増やす" disabled={scenario.bags >= 1000} onClick={() => changeScenario({ ...scenario, bags: Math.min(1000, scenario.bags + 10) })}><Plus size={15}/></button></span><small>袋</small></label>
          <dl className="shared-plan-facts"><div><dt>袋詰めする豆</dt><dd><strong>{Number.isFinite(scenario.bags) ? formatKg(scenario.bags * 200) : '-'}</strong> kg</dd></div></dl>
          <button className="shared-related-plan" onClick={() => navigate('beverage')}><Coffee size={21}/><span><strong>{latte.name}</strong><small>同じ豆を {formatKg(developmentData.reservations[0].grams)} kg 確保済み</small></span><ArrowUpRight size={16}/></button>
        </>}
      </aside>
      <div className="shared-analysis">
        {result instanceof Error ? <div className="shared-input-error" role="alert"><TriangleAlert size={24}/><p>{result.message}</p><button onClick={() => changeScenario({ ...initialSharedScenario })}>初期配合に戻す</button></div> : <>
          <section className="shared-stock-summary" aria-label="共通在庫"><div><span>コロンビア豆の在庫</span><strong>{formatKg(result.colombia.stock.grams)}<small>kg</small></strong></div><div><span><Coffee size={13}/>ラテ用に確保済み</span><strong>{formatKg(result.colombia.reservedGrams)}<small>kg</small></strong></div><div><span>ブレンドに使える</span><strong>{formatKg(result.colombia.availableGrams)}<small>kg</small></strong></div></section>
          <div className={`shared-decision${result.shortageGrams > 0 ? ' is-short' : ''}`} role="status" aria-live="polite">
            {result.shortageGrams > 0 ? <TriangleAlert size={24}/> : <CheckCircle2 size={24}/>}
            <div><strong>{result.shortageGrams > 0 ? `豆の追加調達が ${formatKg(result.shortageGrams)} kg 必要です` : 'ラテの分を残して、ブレンドを作れます'}</strong><p>{result.shortageGrams > 0 ? result.requirements.filter(row => row.shortageGrams > 0).map(row => `${row.material.name} ${formatKg(row.shortageGrams)} kg 不足`).join(' / ') : `${result.recipe.name} / ${scenario.bags} 袋・豆の在庫条件内`}</p></div>
            {!beverage && result.shortageGrams > 0 && scenario.recipeId !== initialSharedScenario.recipeId && <button onClick={() => changeScenario({ ...scenario, recipeId: initialSharedScenario.recipeId })}>案 A を比較<ArrowRight size={15}/></button>}
          </div>
          <SharedGraph view={view} result={result} onSelect={id => {
            if (id === 'latte' && !beverage) navigate('beverage');
            else if (id === 'blend' && beverage) navigate('blend');
            else setSelection(id);
          }}/>
          <div className="shared-graph-caption"><span><i className="shared-colombia-dot"/>{beverage ? '顧客の声 → 飲料案 → 豆の確保' : '配合案 → 共通の豆 → 飲料への影響'}</span><button aria-expanded={recordsOpen} aria-controls="shared-records" onClick={() => setRecordsOpen(value => !value)}><Database size={13}/>共通データ</button></div>
          {selection && <div className="shared-selection" role="status">{selection === 'voice' ? `${voice.source}：${voice.text}` : selection === 'brazil' ? 'ブラジル豆 / ROASTED-BR / 利用可能 30 kg' : selection === 'stock' ? `STOCK-CO / ${developmentData.facilityName} / 在庫 ${formatKg(result.colombia.stock.grams)} kg` : selection === 'reserve' || selection === 'latte' ? `PLAN-LATTE / ${lattePlan.units} 杯 / 確保済み ${formatKg(result.colombia.reservedGrams)} kg` : selection === 'blend' ? `${result.recipe.name} / ${scenario.bags} 袋の試算` : `${result.colombia.material.id} / ${result.colombia.material.specification}`}</div>}
          <StockAllocation result={result} onLatte={() => navigate('beverage')}/>
        </>}
      </div>
    </div>
    {recordsOpen && <section id="shared-records" className="shared-records" aria-label="共通データの根拠">
      <div className="section-heading"><h2><Database size={17}/>共通データ</h2><span>{developmentData.id} / {developmentData.version}</span></div>
      <p>どちらの業務も、同じ豆 ID・同じ拠点の在庫・同じラテ計画を参照します。</p>
      <div className="table-scroll"><table><thead><tr><th>データ</th><th>ID</th><th>内容</th></tr></thead><tbody>
        {developmentData.materials.map(material => <tr key={material.id}><th>豆</th><td>{material.id}</td><td>{material.name} / {material.specification}</td></tr>)}
        {developmentData.stocks.map(stock => <tr key={stock.id}><th>在庫</th><td>{stock.id}</td><td>{stock.materialId} / {formatKg(stock.grams)} kg / {stock.facilityId}</td></tr>)}
        <tr><th>飲料計画</th><td>{lattePlan.id}</td><td>{latte.name} / {lattePlan.units} 杯 / {lattePlan.recipeId}</td></tr>
        {developmentData.reservations.map(reservation => <tr key={reservation.id}><th>確保数量</th><td>{reservation.id}</td><td>{reservation.planId} → {reservation.materialId} / {formatKg(reservation.grams)} kg</td></tr>)}
        {developmentData.recipeLines.map(line => <tr key={line.id}><th>豆の配合明細</th><td>{line.id}</td><td>{line.recipeId} → {line.materialId} / {line.gramsPerUnit} g・{line.recipeId === lattePlan.recipeId ? '杯' : '袋'}</td></tr>)}
      </tbody></table></div>
      <p>合成データのローカル関係図です。Fabric Ontology の照会結果ではありません。<a href="https://learn.microsoft.com/fabric/iq/ontology/overview" target="_blank" rel="noreferrer">オントロジーの公式説明</a></p>
    </section>}
    <footer className="shared-footer"><span>焙煎済み豆の在庫条件のみ。品質・販売承認・実発注は対象外。</span><a href={`#/ops/development/${beverage ? 'DEV-001' : 'DEV-002'}/legacy`}>従来の詳細シナリオ<ArrowUpRight size={12}/></a></footer>
  </div>;
}

function StockAllocation({ result, onLatte }: { result: SharedDevelopmentResult; onLatte: () => void }) {
  const row = result.colombia;
  const scale = Math.max(row.stock.grams, row.reservedGrams + row.requiredGrams);
  const covered = Math.min(row.availableGrams, row.requiredGrams);
  const free = Math.max(0, row.availableGrams - row.requiredGrams);
  return <section className="shared-allocation" aria-label="コロンビア豆の配分">
    <div className="shared-allocation-heading"><h3><Boxes size={16}/>コロンビア豆の配分</h3><span>必要 <strong>{formatKg(row.requiredGrams)}</strong> / 利用可能 <strong>{formatKg(row.availableGrams)}</strong> kg</span></div>
    <div className="shared-allocation-chart">
      <div className="shared-allocation-bar" role="img" aria-label={`コロンビア豆：在庫 ${formatKg(row.stock.grams)} kg、ラテ用 ${formatKg(row.reservedGrams)} kg、ブレンド必要量 ${formatKg(row.requiredGrams)} kg、不足 ${formatKg(row.shortageGrams)} kg`}>
        <span className="shared-allocation-latte" style={{ width: `${row.reservedGrams / scale * 100}%` }}/>
        <span className="shared-allocation-blend" style={{ width: `${covered / scale * 100}%` }}/>
        <span className="shared-allocation-free" style={{ width: `${free / scale * 100}%` }}/>
        <span className="shared-allocation-short" style={{ width: `${row.shortageGrams / scale * 100}%` }}/>
      </div>
      <span className="shared-stock-limit" style={{ left: `${row.stock.grams / scale * 100}%` }}>在庫 {formatKg(row.stock.grams)} kg</span>
    </div>
    <div className="shared-allocation-legend"><button onClick={onLatte}><i className="shared-latte-dot"/>ラテ {formatKg(row.reservedGrams)} kg<ArrowUpRight size={12}/></button><span><i className="shared-colombia-dot"/>ブレンド {formatKg(row.requiredGrams)} kg</span>{row.shortageGrams > 0 && <strong className="shared-short-label">不足 {formatKg(row.shortageGrams)} kg</strong>}</div>
  </section>;
}

function SharedGraph({ view, result, onSelect }: { view: DevelopmentView; result: SharedDevelopmentResult; onSelect: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  useEffect(() => {
    if (!container.current) return;
    const css = getComputedStyle(document.documentElement);
    const color = (token: string) => css.getPropertyValue(`--cp-${token}`).trim();
    const instance = cytoscape({ container: container.current, layout: { name: 'preset' }, minZoom: .3, maxZoom: 2,
      userPanningEnabled: false, userZoomingEnabled: false, autoungrabify: true, boxSelectionEnabled: false,
      elements: [
        { data: { id: 'voice', label: '顧客の声\n甘さ控えめのラテ' } },
        { data: { id: 'latte', label: `${latte.name}\n${lattePlan.units} 杯の計画` } },
        { data: { id: 'reserve', label: 'ラテ用に確保\n10 kg' } },
        { data: { id: 'bean', label: 'コロンビア豆\nROASTED-CO', shared: true } },
        { data: { id: 'stock', label: '共通の在庫\n20 kg', shared: true } },
        { data: { id: 'blend', label: '新ブレンド\n案 A / 100 袋' } },
        { data: { id: 'brazil', label: 'ブラジル豆\n10 kg 使用' } },
        { data: { id: 'voice-latte', source: 'voice', target: 'latte', label: '要望に応える' } },
        { data: { id: 'latte-reserve', source: 'latte', target: 'reserve', label: '計画分' } },
        { data: { id: 'reserve-bean', source: 'reserve', target: 'bean', label: '10 kg 確保' } },
        { data: { id: 'blend-bean', source: 'blend', target: 'bean', label: '10 kg 必要' } },
        { data: { id: 'bean-stock', source: 'bean', target: 'stock', label: '保管' } },
        { data: { id: 'blend-brazil', source: 'blend', target: 'brazil', label: '配合' } },
      ], style: [
        { selector: 'node', style: { label: 'data(label)', width: 156, height: 76, shape: 'roundrectangle',
          'background-color': color('surface'), 'border-color': color('border'), 'border-width': 1.5,
          color: color('text'), 'font-family': getComputedStyle(document.body).fontFamily, 'font-size': 13,
          'text-wrap': 'wrap', 'text-max-width': '145px', 'text-valign': 'center', 'line-height': 1.7,
          'transition-property': 'opacity, border-color, background-color', 'transition-duration': matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 } },
        { selector: 'node[shared]', style: { height: 94, 'border-width': 2.5, 'border-color': color('accent'), 'font-weight': 600 } },
        { selector: 'edge', style: { label: 'data(label)', width: 2, 'line-color': color('border-strong'),
          'target-arrow-color': color('border-strong'), 'target-arrow-shape': 'triangle', 'curve-style': 'bezier',
          'font-family': getComputedStyle(document.body).fontFamily, 'font-size': 11, color: color('text-muted'),
          'text-background-color': color('surface-soft'), 'text-background-opacity': 1, 'text-background-padding': '4px',
          'text-rotation': 'none', 'transition-property': 'opacity, line-color, target-arrow-color', 'transition-duration': matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 } },
        { selector: '.muted', style: { opacity: .24 } },
        { selector: 'node.beverage-focus', style: { 'border-color': color('link'), 'background-color': color('surface'), 'border-width': 2.5 } },
        { selector: 'edge.beverage-focus', style: { 'line-color': color('link'), 'target-arrow-color': color('link'), width: 2.8 } },
        { selector: 'node.blend-focus', style: { 'border-color': color('accent'), 'border-width': 2.5 } },
        { selector: 'edge.blend-focus', style: { 'line-color': color('accent'), 'target-arrow-color': color('accent'), width: 2.8 } },
        { selector: 'node.conflict', style: { 'border-color': color('danger'), 'border-width': 3 } },
        { selector: 'edge.conflict', style: { 'line-color': color('danger'), 'target-arrow-color': color('danger'), width: 3 } },
        { selector: 'edge.portrait-route', style: { 'curve-style': 'unbundled-bezier', 'control-point-distances': [-200], 'control-point-weights': [.5], 'text-margin-x': 9 } },
        { selector: 'edge.portrait-reservation', style: { 'text-margin-y': -55 } },
        { selector: 'node:selected', style: { 'underlay-color': color('link'), 'underlay-opacity': .1, 'underlay-padding': 7 } },
      ] });
    graph.current = instance;
    let portrait: boolean | undefined;
    const resize = () => {
      instance.resize();
      const nextPortrait = (container.current?.clientWidth ?? 900) < 580;
      if (portrait !== nextPortrait) {
        portrait = nextPortrait;
        instance.getElementById('blend-bean').toggleClass('portrait-route', portrait);
        instance.getElementById('reserve-bean').toggleClass('portrait-reservation', portrait);
        const positions: Record<string, [number, number]> = portrait
          ? { voice: [90, 60], latte: [90, 205], reserve: [90, 350], bean: [290, 350], stock: [290, 515], blend: [290, 60], brazil: [290, 205] }
          : { voice: [100, 65], latte: [100, 245], reserve: [310, 350], bean: [540, 245], stock: [755, 245], blend: [310, 65], brazil: [540, 65] };
        instance.nodes().positions(node => ({ x: positions[node.id()][0], y: positions[node.id()][1] }));
      }
      instance.fit(undefined, 26);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current); resize();
    instance.on('tap', 'node', event => selectRef.current(event.target.id()));
    return () => { observer.disconnect(); instance.destroy(); graph.current = null; };
  }, []);
  useEffect(() => {
    const instance = graph.current;
    if (!instance) return;
    const row = result.colombia;
    const brazil = result.requirements.find(requirement => requirement.material.id === 'ROASTED-BR')!;
    instance.batch(() => {
      instance.getElementById('bean').data({ materialId: row.material.id, label: `${row.material.name}\n${row.material.id}` });
      instance.getElementById('stock').data({ stockId: row.stock.id, label: `共通の在庫\n${formatKg(row.stock.grams)} kg` });
      instance.getElementById('reserve').data({ planId: lattePlan.id, label: `ラテ用に確保\n${formatKg(row.reservedGrams)} kg` });
      instance.getElementById('reserve-bean').data('label', `${formatKg(row.reservedGrams)} kg 確保`);
      instance.getElementById('blend').data('label', `新ブレンド\n${result.recipe.name} / ${result.totalGrams / 200} 袋`);
      instance.getElementById('brazil').data('label', `ブラジル豆\n${formatKg(brazil.requiredGrams)} kg 使用`);
      instance.getElementById('blend-bean').data('label', `${formatKg(row.requiredGrams)} kg 必要`);
      instance.elements().removeClass('muted beverage-focus blend-focus conflict');
      if (view === 'beverage') {
        instance.elements('#voice, #latte, #reserve, #bean, #stock, #voice-latte, #latte-reserve, #reserve-bean, #bean-stock').addClass('beverage-focus');
        instance.elements('#blend, #brazil, #blend-bean, #blend-brazil').addClass('muted');
      } else {
        instance.elements('#blend, #bean, #stock, #brazil, #blend-bean, #blend-brazil, #bean-stock').addClass('blend-focus');
        instance.elements('#latte, #reserve, #latte-reserve, #reserve-bean').addClass('beverage-focus');
        instance.elements('#voice, #voice-latte').addClass('muted');
      }
      if (row.shortageGrams > 0) instance.elements('#blend, #bean, #reserve, #blend-bean, #reserve-bean').removeClass('muted').addClass('conflict');
      if (brazil.shortageGrams > 0) instance.elements('#brazil, #blend-brazil').removeClass('muted').addClass('conflict');
    });
  }, [result, view]);
  return <section className="shared-graph-section" aria-label="共通オントロジーの関係図">
    <div className="shared-graph-heading"><h2><Network size={17}/>{view === 'beverage' ? '顧客の声と飲料計画' : '配合と共有在庫'}</h2><div className="graph-tools"><button title="関係図を拡大" aria-label="v2 関係図を拡大" onClick={() => { const instance = graph.current; if (instance) instance.zoom({ level: instance.zoom() * 1.15, renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 } }); }}><ZoomIn size={15}/></button><button title="関係図を縮小" aria-label="v2 関係図を縮小" onClick={() => { const instance = graph.current; if (instance) instance.zoom({ level: instance.zoom() / 1.15, renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 } }); }}><ZoomOut size={15}/></button><button title="全体を表示" aria-label="v2 関係図全体を表示" onClick={() => graph.current?.fit(undefined, 26)}><Maximize2 size={15}/></button></div></div>
    <div className="shared-graph-canvas" ref={container} role="img" aria-label={`顧客の声から新作ラテ、確保数量、コロンビア豆、在庫への関係と、新ブレンドから同じ豆への関係。ラテ用 ${formatKg(result.colombia.reservedGrams)} kg、ブレンド必要 ${formatKg(result.colombia.requiredGrams)} kg、コロンビア不足 ${formatKg(result.colombia.shortageGrams)} kg。`}/>
    <div className="shared-graph-access" aria-label="関係図の対象"><button onClick={() => onSelect('latte')}><Coffee size={14}/>ラテの計画</button><button onClick={() => onSelect('bean')}><Network size={14}/>共通の豆</button><button onClick={() => onSelect('stock')}><Boxes size={14}/>在庫</button><button onClick={() => onSelect('blend')}><Package size={14}/>ブレンド</button></div>
  </section>;
}