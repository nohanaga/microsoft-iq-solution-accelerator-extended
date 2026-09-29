import { lazy, startTransition, Suspense, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Coffee, Database, Download, FileText, FlaskConical, MessageSquareText, PanelRightOpen, Save, Truck, X } from 'lucide-react';
import { analyzeConcept, inclusivePrice, jpy } from './analytics';
import { downloadJson } from './adapter';
import type { CoffeeAdapter, DecisionSnapshot } from './adapter';
import type { Dataset, Evidence, ReviewFilter, Scenario } from './domain';
import scenarioDefaults from '../data/scenario-defaults.json';
import blendSeed from '../data/blend-dataset.json';
import { defaultBlendScenario } from './blend';
import type { BlendData } from './blend';
import { CustomerVoices } from './CustomerVoices';
import { DashboardSkeleton } from './DashboardSkeleton';
import type { VoiceSourceFilter } from './voice';
import { DataCopilot } from './DataCopilot';
import { askFoundryCopilot, buildCopilotVoiceContext, cancelFoundrySignIn, loadFoundryCopilotHistory, resetFoundrySignIn, signInToFoundry, voiceContextLabel } from './copilot';
import type { CopilotContext } from './copilot';
import { copilotAgentLabel } from './copilot-config';
import { initialSupplyFilter, uiCommandLabel } from './copilot-ui-command';
import type { CopilotUiState, SupplyUiFilter, UiCommand } from './copilot-ui-command';
import { calculateBlend, initialBlendScenario } from './blend-workbench-model';
import { compareSupplyCase } from './supply-response-model';
import { createAllocationDemo, createAllocationState } from './supply-model';
import type { SupplyAllocationState } from './supply-model';
import { calculateMaterialOutlook } from './material-outlook';
import type { MaterialOutlookInput, MaterialOutlookSelection, MaterialResponseRequest } from './material-outlook';
import { supplyCaseSchema } from './workspace-schema';
import { DemoPlayer } from './DemoPlayer';
import type { RecordSelection } from './ontology-records';
import { useWorkspace } from './workspace-context';
import { WorkspaceModeSelector } from './WorkspaceRoot';
import { ThemePicker } from './ThemePicker';
import type { SupplyCase } from './supply-response-model';
import type { SavedRecord } from './workspace-schema';

const documents = import.meta.glob<string>('../knowledge/**/*.md', { query: '?raw', import: 'default', eager: true });
const blendData = blendSeed as BlendData;
const ImpactGraph = lazy(() => import('./ImpactGraph').then(module => ({ default: module.ImpactGraph })));
const BlendDevelopment = lazy(() => import('./BlendDevelopment').then(module => ({ default: module.BlendDevelopment })));
const DevelopmentDashboard = lazy(() => import('./DevelopmentDashboard').then(module => ({ default: module.DevelopmentDashboard })));
const SupplyDashboard = lazy(() => import('./SupplyDashboard').then(module => ({ default: module.SupplyDashboard })));
const SupplyResponse = lazy(() => import('./SupplyResponse').then(module => ({ default: module.SupplyResponse })));
const SupplyAllocation = lazy(() => import('./SupplyAllocation').then(module => ({ default: module.SupplyAllocation })));
const MaterialOutlook = lazy(() => import('./MaterialOutlook').then(module => ({ default: module.MaterialOutlook })));
type Page = 'reviews' | 'development' | 'blend' | 'supply';
type SupplyView = 'actual' | 'outlook' | 'response' | 'allocation';
const currentPage = (): Page => location.hash.includes('/development/DEV-002') ? 'blend' : location.hash.includes('/development') ? 'development' : location.hash.includes('/production') || location.hash.includes('/supply') ? 'supply' : 'reviews';
const currentSupplyView = (): SupplyView | undefined => {
  if (location.hash.includes('/production')) return 'outlook';
  if (!location.hash.includes('/supply')) return undefined;
  const view = new URLSearchParams(location.hash.split('?')[1]).get('view');
  return view === 'actual' || view === 'outlook' || view === 'response' || view === 'allocation' ? view : undefined;
};
const initialFilter: ReviewFilter = { productId: 'PRD-002', storeIds: ['STR-01','STR-02','STR-03','STR-04','STR-05','STR-06'], from: '2026-05-01', to: '2026-07-08' };
const initialScenario: Scenario = scenarioDefaults;
const dateTime = (value: string) => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
const statusLabel = { pass: '適合', fail: '不適合', unknown: '未確認', changed: '変化を確認', unresolved: '未解決' };

function SourceButton({ id, data, onOpen }: { id: string; data: Dataset; onOpen: (evidence: Evidence) => void }) {
  const evidence = data.evidence.find(row => row.id === id);
  return evidence ? <button className="source-button" type="button" onClick={() => onOpen(evidence)}><FileText size={14}/>{evidence.title}</button> : <span>確認不能</span>;
}

export function App({ adapter }: { adapter: CoffeeAdapter }) {
  const workspace = useWorkspace();
  const developmentData = workspace.data.development;
  const [data, setData] = useState<Dataset>(() => workspace.data.operations);
  const [page, setPage] = useState<Page>(currentPage);
  const [legacy, setLegacy] = useState(() => location.hash.endsWith('/legacy'));
  const [beverageScenario, setBeverageScenario] = useState<ReturnType<typeof initialBlendScenario> | null>(() => workspace.loadScope === 'full' ? initialBlendScenario('beverage', developmentData) : null);
  const [workbenchScenario, setWorkbenchScenario] = useState<ReturnType<typeof initialBlendScenario> | null>(() => workspace.loadScope === 'full' ? initialBlendScenario('blend', developmentData) : null);
  const [filter, setFilter] = useState<ReviewFilter>(initialFilter);
  const [topic, setTopic] = useState('');
  const [voiceSource, setVoiceSource] = useState<VoiceSourceFilter>('all');
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [blendScenario, setBlendScenario] = useState(() => defaultBlendScenario(blendData));
  const [supplyFilter, setSupplyFilter] = useState<SupplyUiFilter>(initialSupplyFilter);
  const [supplyView, setSupplyView] = useState<SupplyView>(() => currentSupplyView() ?? 'actual');
  const [allocationState, setAllocationState] = useState<SupplyAllocationState | null>(null);
  const [allocationSaveAttempt, setAllocationSaveAttempt] = useState<SavedRecord | null>(null);
  const [supplyCase, setSupplyCase] = useState<SupplyCase | null>(null);
  const [supplySaveAttempt, setSupplySaveAttempt] = useState<SavedRecord | null>(null);
  const [outlookInput, setOutlookInput] = useState<MaterialOutlookInput | null>(null);
  const [outlookSelection, setOutlookSelection] = useState<MaterialOutlookSelection | null>(null);
  const [demoActive, setDemoActive] = useState(false);
  const [demoCommandId, setDemoCommandId] = useState('');
  const [editingCaseId, setEditingCaseId] = useState<string | null>(() => new URLSearchParams(location.hash.split('?')[1]).get('case'));
  const [supplySelection, setSupplySelection] = useState<RecordSelection | null>(null);
  const [developmentSelection, setDevelopmentSelection] = useState<RecordSelection | null>(null);
  const appliedCommands = useRef(new Set<string>());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotSuggestion, setCopilotSuggestion] = useState<{ id: string; text: string }>();
  const copilotToggleRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [snapshot, setSnapshot] = useState<DecisionSnapshot | null>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => header.parentElement?.style.setProperty('--app-header-height', `${header.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(header); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const onHashChange = () => {
      const view = currentSupplyView();
      if (view) setSupplyView(view);
      if (location.hash.includes('/production')) history.replaceState(null, '', '#/ops/supply?view=outlook');
      setPage(currentPage()); setLegacy(location.hash.endsWith('/legacy')); setEditingCaseId(new URLSearchParams(location.hash.split('?')[1]).get('case')); setEvidence(null);
    };
    onHashChange();
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    if (page !== 'reviews' && workspace.loadScope !== 'full') void workspace.loadDeferred();
  }, [page, workspace.loadScope]);
  useEffect(() => { setData(workspace.data.operations); }, [workspace.data.operations]);
  useEffect(() => {
    if (workspace.loadScope !== 'full') return;
    setBeverageScenario(current => current ?? initialBlendScenario('beverage', developmentData));
    setWorkbenchScenario(current => current ?? initialBlendScenario('blend', developmentData));
  }, [workspace.loadScope, developmentData]);

  const deferredPage = page !== 'reviews' && workspace.loadScope !== 'full';
  const sharedView = workspace.loadScope === 'full' && (!legacy || workspace.mode === 'live') && (page === 'development' || page === 'blend');
  const editingSupply = (page === 'blend' || page === 'development') && !!supplyCase && editingCaseId === supplyCase.id;
  const activeDevelopmentScenario = editingSupply ? supplyCase.proposal : page === 'blend' ? workbenchScenario : beverageScenario;
  const go = (next: Page) => { location.hash = next === 'blend' ? '/ops/development/DEV-002' : `/ops/${next}${next === 'development' ? '/DEV-001' : ''}`; };
  const selectSupplyView = (next: SupplyView) => { setSupplyView(next); location.hash = `/ops/supply?view=${next}`; };
  const openMaterialResponse = (request: MaterialResponseRequest) => {
    if (demoActive) throw new Error('デモを終了してから対応検討を開始してください。');
    if (supplySaveAttempt) throw new Error('前回の保存結果を再確認してから、新しい対応検討を開始してください。');
    const { scenario: baseline, supplierId, ...outlook } = request;
    const next = supplyCaseSchema.parse({ id: crypto.randomUUID(), datasetVersion: developmentData.version,
      baseline, proposal: structuredClone(baseline), rationale: '', outlook,
      assumption: { enabled: false, supplierId, from: request.date, to: request.date, reason: '' } });
    compareSupplyCase(next, developmentData);
    if (supplyCase && !window.confirm('既存の対応検討の下書きを、選択した需要で置き換えますか？')) return;
    setSupplyCase(next); setDevelopmentSelection(null); selectSupplyView('response');
  };
  const closeCopilot = () => { setCopilotOpen(false); copilotToggleRef.current?.focus(); };
  const outlookResult = page === 'supply' && supplyView === 'outlook' && workspace.loadScope === 'full' ? calculateMaterialOutlook(workspace.data, outlookInput) : null;
  const copilotSnapshot: Record<string, unknown> = page === 'reviews'
    ? { productId: filter.productId, storeIds: filter.storeIds, from: filter.from, to: filter.to, source: voiceSource, topic }
    : (page === 'development' || page === 'blend')
      ? { datasetVersion: developmentData.version, scenario: activeDevelopmentScenario ?? scenario }
      : { datasetVersion: data.version, shipmentCount: data.shipments.length, orderCount: data.orders.length, view: supplyView,
        ...(supplyView === 'outlook' ? { outlook: { source: outlookResult?.input?.source ?? null, modelVersion: outlookResult?.input?.forecastModelVersion ?? null,
          converted: outlookResult?.demands.length ?? 0, excluded: outlookResult?.excluded.length ?? 0, error: outlookResult?.error,
          selection: outlookSelection, limits: '確認済み対応分の追加需要のみ。未対応・入荷未取得は不足なしを意味しない。個別受注の納期は未判定。' } } : { case: supplyCase }) };
  const copilotUiState: CopilotUiState = {
    page,
    reviews: { filter, source: voiceSource, topic },
    supply: supplyFilter,
  };
  const copilotContext: CopilotContext = {
    datasetId: sharedView ? developmentData.datasetId : data.datasetId, asOf: sharedView ? developmentData.asOf : data.asOf, page, filter, source: voiceSource,
    customerVoices: buildCopilotVoiceContext(data, workspace.data.voices, workspace.data.chats, workspace.data.sentiments.entries, filter, voiceSource, topic),
    snapshot: copilotSnapshot,
    uiState: copilotUiState,
    label: page === 'reviews'
      ? voiceContextLabel(data, filter, voiceSource)
      : page === 'blend' ? 'ブレンド調合 / DEV-002' : page === 'development' ? '飲料開発 / DEV-001' : supplyView === 'outlook' ? '供給と注文 / 需要と材料見通し' : '供給と注文'
  };
  const applyUiCommands = (commands: UiCommand[], source: 'copilot' | 'demo' = 'copilot') => {
    const applied: string[] = [];
    const failures: string[] = [];
    if (source === 'copilot' && demoActive) return ['デモを終了してからCopilotの画面操作を適用してください。'];
    startTransition(() => {
      for (const command of commands) {
        if (appliedCommands.current.has(command.commandId)) continue;
        appliedCommands.current.add(command.commandId);
        switch (command.type) {
          case 'navigate':
            go(command.page);
            break;
          case 'reviews.setFilter':
            setFilter(command.filter); setVoiceSource(command.source); setTopic(command.topic); go('reviews');
            break;
          case 'development.setScenario': {
            try { calculateBlend(command.scenario, developmentData); }
            catch (reason) { failures.push(reason instanceof Error ? reason.message : '配合を適用できません。'); continue; }
            if (command.view === 'blend') setWorkbenchScenario(command.scenario); else setBeverageScenario(command.scenario);
            setDevelopmentSelection(null); go(command.view === 'blend' ? 'blend' : 'development');
            break;
          }
          case 'supply.setFilter':
            setSupplyFilter(command.filter); setSupplySelection(null); setSupplyView('actual'); go('supply');
            break;
          case 'supply.setCase': {
            try {
              if (supplySaveAttempt) throw new Error('前回の保存を再確認してからデモを開始してください。');
              const next = supplyCaseSchema.parse(command.value);
              compareSupplyCase(next, developmentData);
              setSupplyCase(next); setSupplyView('response'); setDevelopmentSelection(null);
              if (command.edit) location.hash = `/ops/development/DEV-002?case=${encodeURIComponent(next.id)}`;
              else go('supply');
            } catch (reason) { failures.push(reason instanceof Error ? reason.message : '検討条件が不正です。'); continue; }
            break;
          }
          case 'ontology.selectRecord':
            if (command.model === 'supply') { setSupplySelection({ tableId: command.tableId, recordId: command.recordId }); selectSupplyView('actual'); }
            else { setDevelopmentSelection({ tableId: command.tableId, recordId: command.recordId }); if (page !== 'blend') go('development'); }
            break;
          case 'copilot.openReference':
            break;
        }
        applied.push(uiCommandLabel(command));
      }
      if (source === 'demo' && !failures.length) setDemoCommandId(commands.at(-1)?.commandId ?? '');
    });
    if (failures.length) setError(failures.join(' / '));
    if (source === 'copilot' && applied.length) setNotice(`Data Copilot が画面を更新しました：${applied.join(' / ')}`);
    return failures;
  };
  const captureDemoState = () => {
    const before = structuredClone({ hash: location.hash, filter, voiceSource, topic, beverageScenario, workbenchScenario, supplyFilter, supplySelection, developmentSelection, supplyView, supplyCase });
    return () => {
      setFilter(before.filter); setVoiceSource(before.voiceSource); setTopic(before.topic);
      setBeverageScenario(before.beverageScenario); setWorkbenchScenario(before.workbenchScenario);
      setSupplyFilter(before.supplyFilter); setSupplySelection(before.supplySelection); setDevelopmentSelection(before.developmentSelection);
      setSupplyView(before.supplyView); setSupplyCase(before.supplyCase); location.hash = before.hash;
    };
  };
  const importReview = async (file?: File) => {
    if (!file) return;
    setError(''); setNotice('');
    try {
      if (workspace.mode === 'live') throw new Error('実データのレビュー投稿は EC 側の取り込み経路を使用してください。');
      if (file.size > 100000) throw new Error('投稿ファイルは 100 KB 以下にしてください。');
      const result = adapter.importReview(data, JSON.parse(await file.text()));
      setData(result.data); setNotice(result.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '取り込みに失敗しました。'); }
  };

  return <div className={`app-shell${copilotOpen ? ' has-copilot' : ''}${demoActive ? ' has-demo' : ''}`} data-demo-page={page} data-demo-command={demoCommandId}>
    <header className="topbar" ref={headerRef}><a className="brand" href="#/ops/reviews"><Coffee size={24}/><strong>舞黒珈琲店</strong></a><span className="workspace-title">商品開発ワークスペース</span><div className="topbar-meta"><WorkspaceModeSelector/><ThemePicker/><DemoPlayer filter={filter} onCommands={commands => applyUiCommands(commands, 'demo')} onCapture={captureDemoState} onActiveChange={setDemoActive}/><span className="badge"><Database size={12}/>合成データ</span><button className="copilot-toggle" ref={copilotToggleRef} aria-label={copilotOpen ? 'Data Copilot を閉じる' : 'Data Copilot を開く'} title="Data Copilot" aria-controls="data-copilot" aria-expanded={copilotOpen} onClick={() => setCopilotOpen(value => !value)}><PanelRightOpen size={17}/>Data Copilot</button></div></header>
    <nav className="navigation" aria-label="業務画面">
      <span className="navigation-label">ワークスペース</span>
      <a href="#/ops/reviews" aria-current={page === 'reviews' ? 'page' : undefined}><MessageSquareText size={18}/>顧客の声</a>
      <a href="#/ops/development/DEV-001" aria-current={page === 'development' || page === 'blend' ? 'page' : undefined}><FlaskConical size={18}/>商品開発</a>
      <a href="#/ops/supply" aria-current={page === 'supply' ? 'page' : undefined}><Truck size={18}/>供給と注文</a>
      <div className="navigation-footer"><span>開発案件</span><a href="#/ops/development/DEV-001" aria-current={page === 'development' ? 'page' : undefined}><span>飲料</span><code>DEV-001</code></a><a href="#/ops/development/DEV-002" aria-current={page === 'blend' ? 'page' : undefined}><span>ブレンド</span><code>DEV-002</code></a></div>
    </nav>
    <div className="context-strip"><span>分析基準 <time>{dateTime(sharedView ? developmentData.asOf : data.asOf)} JST</time></span><details><summary>取得記録</summary><p>{sharedView ? `${developmentData.datasetId} / ${developmentData.version}` : `${data.datasetId} / ${data.version}`}</p><p>データ：合成 / 取得元：{workspace.source} / 受領：{dateTime(workspace.receivedAt)} JST</p><p>Data Copilot：Foundry Agent {copilotAgentLabel}</p></details></div>
    <main>
      {error && <div className="message error" role="alert">{error}<button title="閉じる" aria-label="エラーを閉じる" onClick={() => setError('')}><X size={18}/></button></div>}
      {notice && <div className="message" role="status"><CheckCircle2 size={18}/>{notice}</div>}
      {deferredPage && <DashboardSkeleton view={page === 'supply' ? 'supply' : 'development'} error={workspace.deferredError} onRetry={() => void workspace.loadDeferred()}/>}
      {page === 'reviews' && <div data-demo-target="reviews" data-demo-state="ready"><CustomerVoices data={data} filter={filter} setFilter={setFilter} topic={topic} setTopic={setTopic} source={voiceSource} setSource={setVoiceSource} onImport={importReview} onDevelopment={() => go('development')} onSupply={() => go('supply')} onDiscuss={text => { setCopilotSuggestion({ id: crypto.randomUUID(), text }); setCopilotOpen(true); }}/></div>} 
      {editingSupply && <div className="message"><span>供給検討 {supplyCase.id.slice(0, 8)} の対応案 / 通常の配合とは別の下書き</span><button onClick={() => { setSupplyView('response'); go('supply'); }}>供給の比較へ戻る</button></div>}
      {sharedView && activeDevelopmentScenario && <Suspense fallback={<p role="status">商品開発画面を読み込んでいます。</p>}><DevelopmentDashboard key={editingSupply ? supplyCase.id : page} view={page === 'blend' ? 'blend' : 'beverage'} scenario={activeDevelopmentScenario} onScenario={editingSupply ? next => setSupplyCase(current => current ? { ...current, proposal: next } : null) : page === 'blend' ? setWorkbenchScenario : setBeverageScenario} selection={developmentSelection} onSelection={setDevelopmentSelection} caseMode={editingSupply}/></Suspense>}
      {legacy && (page === 'development' || page === 'blend') && <nav className="project-navigation" aria-label="開発案件"><a href="#/ops/development/DEV-001">v2 飲料開発</a><a href="#/ops/development/DEV-002">v2 ブレンド開発</a></nav>}
      {workspace.loadScope === 'full' && legacy && workspace.mode === 'memory' && page === 'blend' && <Suspense fallback={<p role="status">ブレンド画面を読み込んでいます。</p>}><BlendDevelopment data={data} scenario={blendScenario} setScenario={setBlendScenario}/></Suspense>}
      {workspace.loadScope === 'full' && legacy && workspace.mode === 'memory' && page === 'development' && <Development data={data} scenario={scenario} setScenario={setScenario} onOpen={setEvidence} onSave={() => {
        setError(''); setNotice('');
        try { const result = analyzeConcept(data, scenario); const saved = adapter.save(data, scenario, result, filter); setSnapshot(saved); setNotice('判断材料をこのブラウザーに保存しました。承認・外部送信は行っていません。'); }
        catch (reason) { setError(reason instanceof Error ? reason.message : '保存できませんでした。'); }
      }}/>} 
      {workspace.loadScope === 'full' && page === 'supply' && <>
        <div className="supply-mode" role="group" aria-label="供給の業務ビュー"><button aria-pressed={supplyView === 'actual'} onClick={() => selectSupplyView('actual')}>実績</button><button aria-pressed={supplyView === 'outlook'} onClick={() => selectSupplyView('outlook')}>需要と材料見通し</button><button aria-pressed={supplyView === 'response'} onClick={() => selectSupplyView('response')}>対応検討</button><button aria-pressed={supplyView === 'allocation'} onClick={() => selectSupplyView('allocation')}>停止・受注引当</button></div>
        <Suspense fallback={<p role="status">供給画面を読み込んでいます。</p>}>
          {supplyView === 'actual' ? <SupplyDashboard data={data} filter={supplyFilter} onFilterChange={setSupplyFilter} selection={supplySelection} onSelectionChange={setSupplySelection}/>
            : supplyView === 'outlook' ? <MaterialOutlook input={outlookInput} onInput={next => { setOutlookInput(next); setOutlookSelection(null); }} selection={outlookSelection} onSelection={setOutlookSelection} onResponse={openMaterialResponse}/>
            : supplyView === 'allocation' ? <SupplyAllocation source={data} state={allocationState ?? (data.allocation ? createAllocationDemo(data) : createAllocationState(data))} onChange={setAllocationState} saveAttempt={allocationSaveAttempt} onSaveAttempt={setAllocationSaveAttempt}/>
            : <SupplyResponse value={supplyCase} onChange={setSupplyCase} saveAttempt={supplySaveAttempt} onSaveAttempt={setSupplySaveAttempt} onEdit={() => { if (supplyCase) { setDevelopmentSelection(null); const route = developmentData.products.find(row => row.id === supplyCase.proposal.productId)?.category === 'beverage' ? 'DEV-001' : 'DEV-002'; location.hash = `/ops/development/${route}?case=${encodeURIComponent(supplyCase.id)}`; } }}/>}</Suspense>
      </>}
      {snapshot && legacy && page === 'development' && <div className="saved-record"><Save size={17}/><span>保存記録：{dateTime(snapshot.recordedAt)} JST / {snapshot.impact.concept.name}</span><button onClick={() => downloadJson(snapshot, `maikuro-decision-${snapshot.id}.json`)}><Download size={16}/>判断材料 JSON</button><span className="badge">ローカル保存</span></div>}
    </main>
    {copilotOpen && <button className="copilot-backdrop" tabIndex={-1} aria-label="Data Copilot を閉じる" onClick={closeCopilot}/>}
    <DataCopilot open={copilotOpen} onClose={closeCopilot} context={copilotContext} onAsk={askFoundryCopilot} onLoadHistory={loadFoundryCopilotHistory} onSignIn={signInToFoundry} onCancelSignIn={cancelFoundrySignIn} onResetSignIn={resetFoundrySignIn} onUiCommands={commands => { const failures = applyUiCommands(commands); if (failures.length) setError(failures.join(' / ')); }} suggestion={copilotSuggestion}/>
    {evidence && <aside className="evidence-drawer" aria-label="根拠資料"><div className="section-heading"><h2>根拠資料</h2><button title="閉じる" aria-label="根拠資料を閉じる" onClick={() => setEvidence(null)}><X size={20}/></button></div><span className="badge">合成資料・{evidence.kind === 'work' ? 'Work IQ' : 'Foundry IQ'} 未接続</span><h3>{evidence.title}</h3><p>版 {evidence.version} / {dateTime(evidence.effectiveAt)} JST</p><blockquote>{evidence.quote}</blockquote><pre>{documents[`../${evidence.path}`] ?? '原文を取得できません。'}</pre><p className="scope-note">Microsoft 365 / ナレッジベースの取得証跡ではありません。</p></aside>}
  </div>;
}

function Development({ data, scenario, setScenario, onOpen, onSave }: { data: Dataset; scenario: Scenario; setScenario: (value: Scenario) => void; onOpen: (evidence: Evidence) => void; onSave: () => void }) {
  let result;
  try { result = analyzeConcept(data, scenario); } catch (reason) { result = reason instanceof Error ? reason : new Error('計算できません。'); }
  return <>
    <div className="page-heading"><div><span className="eyebrow">DEV-001</span><h1>商品開発</h1></div><button className="primary" onClick={onSave} disabled={result instanceof Error}><Save size={17}/>判断材料を保存</button></div>
    <div className="development-workbench">
    <section className="scenario-controls"><div className="concept-tabs" role="group" aria-label="商品候補">{data.concepts.map(concept => <button key={concept.id} aria-pressed={scenario.conceptId === concept.id} onClick={() => setScenario({ ...scenario, conceptId: concept.id })}><strong>{concept.name}</strong><span>{jpy(inclusivePrice(concept.priceExTax, concept.taxPercent))}（税込）</span></button>)}</div>
      <div className="scenario-dates"><label>展開開始<input type="date" value={scenario.start} min="2026-07-09" max={scenario.end} onChange={event => setScenario({ ...scenario, start: event.target.value })}/></label><label>展開終了<input type="date" value={scenario.end} min={scenario.start} onChange={event => setScenario({ ...scenario, end: event.target.value })}/></label><span className="badge">想定・未販売</span></div>
      <fieldset className="quantity-grid"><legend>対象店舗と期間全体の想定杯数</legend>{data.stores.map(store => <label key={store.id}><span>{store.name}</span><input type="number" aria-label={`${store.name}の想定杯数`} min={0} max={100000} step={1} value={scenario.storeQuantities[store.id] ?? 0} onChange={event => setScenario({ ...scenario, storeQuantities: { ...scenario.storeQuantities, [store.id]: Number(event.target.value) } })}/><span>杯</span></label>)}</fieldset>
    </section>
    <div className="analysis-results">{result instanceof Error ? <p className="message error" role="alert">{result.message}</p> : <>
      <section className="metrics"><div><span>想定数量</span><strong>{result.cups.toLocaleString('ja-JP')}<small>杯</small></strong><span>期間全体の入力値</span></div><div><span>変動費 / 杯（税抜）</span><strong>{jpy(result.unitCost)}</strong><span>原材料・包材の積上げ</span></div><div><span>変動費合計（税抜）</span><strong>{jpy(result.cost)}</strong><span>既存在庫の有無と費用を分離</span></div><div><span>限界利益 / 杯（税抜）</span><strong>{jpy(result.contribution)}</strong><span>固定費を含む営業利益ではありません</span></div></section>
      <p className="scope-note">{result.concept.description}</p>
      <Suspense fallback={<p role="status">影響図を読み込んでいます。</p>}><ImpactGraph data={data} scenario={scenario}/></Suspense>
      <section><div className="section-heading"><h2>原料必要量と供給条件</h2><span>展開開始時点の在庫との比較</span></div><div className="table-scroll"><table><thead><tr><th>店舗</th><th>原料 / ID</th><th>必要量</th><th>利用可能量</th><th>不足量</th><th>在庫を共用する現行品</th></tr></thead><tbody>{result.requirements.map(row => <tr key={`${row.storeId}-${row.materialId}`}><td>{data.stores.find(store => store.id === row.storeId)?.name}</td><td>{data.materials.find(material => material.id === row.materialId)?.name}<small>{row.materialId}</small></td><td>{row.required.toLocaleString('ja-JP')} {row.unit === 'each' ? '組' : row.unit}</td><td>{row.available?.toLocaleString('ja-JP') ?? '確認不能'}</td><td className={row.shortage === null ? 'unknown-text' : row.shortage > 0 ? 'fail-text' : ''}>{row.shortage?.toLocaleString('ja-JP') ?? '確認不能'}</td><td>{row.sharedProductIds.join(' / ') || '登録された現行配合なし'}</td></tr>)}</tbody></table></div><p className="scope-note">登録済みの既存予約を控除し、開始日までの確定入荷だけを加算します。期間途中の入荷・未確定便は加算しません。PRD-001/002 以外の配合は未収録です。</p></section>
      <section><div className="section-heading"><h2>設計・品質・調達の条件</h2><span>資料に基づく条件照合</span></div><div className="rule-list">{result.rules.map(row => <div className="rule-row" key={row.rule.id}><span className={`status ${row.status}`}>{statusLabel[row.status]}</span><div><strong>{row.rule.name}</strong><p>{row.detail}</p></div><SourceButton id={row.rule.evidenceId} data={data} onOpen={onOpen}/></div>)}</div></section>
    </>}</div></div>
    <section className="history"><div className="section-heading"><h2>過去と現在</h2><span className="badge">合成資料</span></div><div className="table-scroll"><table><thead><tr><th>当時の理由</th><th>当時の根拠</th><th>現在の変化・残る条件</th><th>現在の根拠</th><th>状態</th></tr></thead><tbody>{data.decisionReasons.map(row => <tr key={row.id}><th>{row.reason}</th><td><SourceButton id={row.pastEvidenceId} data={data} onOpen={onOpen}/></td><td>{row.change}</td><td>{row.currentEvidenceId ? <SourceButton id={row.currentEvidenceId} data={data} onOpen={onOpen}/> : '裏付けなし'}</td><td><span className={`status ${row.status}`}>{statusLabel[row.status]}</span></td></tr>)}</tbody></table></div><div className="conclusion"><h3>判断概要</h3><p>別の原料候補と仕様書が現れたため、以前とは異なる条件で検討できます。ただし、香り評価、原料別の供給資格、サンプル出荷日、実測の廃棄率は未確認です。</p><span>試作承認・発注・担当割当・外部通知は行いません。</span></div></section>
  </>;
}

function Supply({ data }: { data: Dataset }) {
  const lineIds = [...new Set(data.supplyImpacts.map(row => row.lineId))];
  const lines = data.orderLines.filter(row => lineIds.includes(row.id) && data.orders.find(order => order.id === row.orderId)?.status === 'cancelled');
  const amount = lines.reduce((sum, row) => sum + row.quantity * row.priceExTax - row.discountExTax, 0);
  const openingAmount = data.orderLines.filter(row => row.orderId === 'ORD-DEMO-0702').reduce((sum, row) => sum + inclusivePrice(row.quantity * row.priceExTax - row.discountExTax, row.taxPercent), 0);
  return <>
    <div className="page-heading"><h1>供給と注文</h1></div>
    <section className="metrics"><div><span>取消対象</span><strong>{lines.length}<small>明細</small></strong><span>明細 ID で重複排除</span></div><div><span>取消商品額（税抜）</span><strong>{jpy(amount)}</strong><span>会計上の損失額ではありません</span></div><div><span>神田店の冒頭購入</span><strong>{jpy(openingAmount)}</strong><span>7 月 2 日 / 受取完了 / 別注文</span></div><div><span>比較店舗</span><strong className="text-metric">吉祥寺・大宮</strong><span>同一供給元でも影響を一律に扱いません</span></div></section>
    <div className="table-scroll"><table><thead><tr><th>入荷便</th><th>店舗</th><th>予定到着</th><th>到着実績</th><th>背景</th></tr></thead><tbody>{data.shipments.map(row => <tr key={row.id}><th>{row.id}</th><td>{data.stores.find(store => store.id === row.storeId)?.name}</td><td>{dateTime(row.expectedAt)}</td><td>{row.arrivedAt ? dateTime(row.arrivedAt) : '未確認'}</td><td>{row.reason}</td></tr>)}</tbody></table></div>
    <h2>対象明細と欠品記録</h2><div className="table-scroll"><table><thead><tr><th>明細</th><th>商品</th><th>入荷便</th><th>欠品確認</th><th>根拠</th></tr></thead><tbody>{data.supplyImpacts.map(row => <tr key={row.id}><th>{row.lineId}</th><td>{row.productId}</td><td>{row.shipmentId}</td><td>{dateTime(row.shortageAt)}</td><td>{row.evidence}</td></tr>)}</tbody></table></div>
    <p className="scope-note">Shipment は供給会社から店舗への入荷です。顧客への配送を表しません。配送不満を甘さ控えめ商品の需要に合算しません。</p>
  </>;
}