import { useState } from 'react';
import { ArrowRight, CheckCircle2, FlaskConical, Plus, RotateCcw, TriangleAlert } from 'lucide-react';
import { jpy } from './analytics';
import { formatKg } from './blend-workbench-model';
import { compareSupplyCase, createSupplyCase, stockLimitedScenario } from './supply-response-model';
import type { SupplyCase } from './supply-response-model';
import { useWorkspace } from './workspace-context';
import { SupplyImpactGraph } from './SupplyImpactGraph';
import type { FabricGraphSnapshot } from './fabric-impact';
import { SupplyDecisionHistory } from './SupplyDecisionHistory';
import type { SavedRecord } from './workspace-schema';
import './supply-dashboard.css';

interface SupplyResponseProps {
  value: SupplyCase | null;
  onChange: (value: SupplyCase) => void;
  onEdit: () => void;
  saveAttempt: SavedRecord | null;
  onSaveAttempt: (record: SavedRecord | null) => void;
}

export function SupplyResponse({ value, onChange, onEdit, saveAttempt, onSaveAttempt }: SupplyResponseProps) {
  const workspace = useWorkspace();
  const data = workspace.data.development;
  const suppliers = data.suppliers.filter(row => workspace.data.operations.suppliers.some(supplier => supplier.id === row.id));
  const [supplierId, setSupplierId] = useState(value?.assumption.supplierId ?? suppliers.find(row => row.id === 'SUP-02')?.id ?? suppliers[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState<'comparison' | 'evidence'>('comparison');
  const [graphEvidence, setGraphEvidence] = useState<FabricGraphSnapshot | null>(null);
  const begin = () => {
    try { onChange(createSupplyCase(data, supplierId)); setMessage(''); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '検討を開始できません。'); }
  };
  let comparison: ReturnType<typeof compareSupplyCase> | null = null;
  let problem = '';
  if (value) {
    try { comparison = compareSupplyCase(value, data); }
    catch (reason) { problem = reason instanceof Error ? reason.message : '条件を確認してください。'; }
  }
  const change = (next: Partial<SupplyCase>) => { if (value) onChange({ ...value, ...next }); setMessage(''); };
  const company = data.suppliers.find(row => row.id === value?.assumption.supplierId);
  const materials = data.materials.filter(row => row.supplierId === company?.id);
  const planIds = new Set(data.reservations.filter(row => materials.some(material => material.id === row.materialId)).map(row => row.planId));
  const columns = comparison ? [
    { key: 'baseline', label: '元条件', scenario: value!.baseline, result: comparison.baseline },
    { key: 'suspended', label: '停止仮定', scenario: value!.baseline, result: comparison.suspended },
    { key: 'proposal', label: '対応案', scenario: value!.proposal, result: comparison.proposal },
  ] : [];
  const applyQuantity = () => {
    if (!value) return;
    try { change({ proposal: stockLimitedScenario(value.baseline, data) }); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '数量案を適用できません。'); }
  };
  return <div className="supply-response" data-demo-target="supply-response" data-demo-state={problem ? 'error' : value ? 'ready' : 'empty'}>
    <header className="sd-heading"><div><span className="eyebrow">SUPPLY RESPONSE</span><h1>対応検討</h1></div><span className="badge">合成データ / 下書き</span></header>
    <div className="sr-context"><span>{company?.name ?? '未選択'}</span><span>基準 {data.asOf}</span><span>{data.version}</span><span>{workspace.mode === 'live' ? '実接続' : 'メモリー'}</span>{value && <code title={value.id}>検討 {value.id.slice(0, 8)}</code>}</div>
    {value?.outlook && <section aria-label="材料見通しからの対象需要"><h2>材料見通しの対象需要</h2><p>{data.materials.find(row => row.id === value.outlook?.materialId)?.name ?? value.outlook.materialId} / 材料必要日 {value.outlook.date} / 販売予測日 {value.outlook.basis.salesDate}</p><p>{value.outlook.basis.productId} / {value.outlook.basis.storeId} / 製造換算 {value.outlook.basis.productionUnits.toLocaleString('ja-JP', { maximumFractionDigits: 2 })} → 元条件 {value.baseline.units}</p><p className="scope-note">選択需要を整数に切り上げ、基準時点の在庫で比較しています。日別累積不足・将来入荷を含む比較ではありません。</p><details><summary>対応の根拠</summary><p>{value.outlook.basis.source} / {value.outlook.basis.mappingId} / {value.outlook.basis.evidence} / {value.outlook.basis.modelVersion}</p></details><a href="#/ops/supply?view=outlook">需要と材料見通しへ戻る</a></section>}
    <div className="sr-start"><label>対象供給会社<select aria-label="検討する供給会社" value={supplierId} onChange={event => setSupplierId(event.target.value)}>{suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><button onClick={() => { if (!value || window.confirm('現在の下書きを置き換え、新しい検討を開始しますか？')) begin(); }} disabled={!supplierId}><Plus size={16}/>{value ? '新しい検討' : '検討を開始'}</button></div>
    {message && <p className="message error" role="alert">{message}</p>}
    {!value ? <p className="empty">対象会社を選択してください。</p> : <>
      <div className="sr-command-center">
        <aside className="sr-targets" aria-label="供給の依存対象"><h2>対象と既存確保</h2><h3>{company?.name ?? value.assumption.supplierId}</h3><span className="badge">共通会社IDによる対応</span><ul>{materials.map(row => <li key={row.id}><strong>{row.name}</strong><code>{row.id}</code></li>)}</ul><h3>関連する確定計画</h3><ul>{data.plans.filter(row => planIds.has(row.id) && row.status === 'confirmed').map(row => <li key={row.id}><strong>{data.products.find(product => product.id === row.productId)?.name ?? row.productId}</strong><span>{row.units} 単位 / {row.id}</span></li>)}</ul><p className="scope-note">既存確保は維持。個別注文の欠品判定ではありません。</p></aside>
        <section className="sr-comparison" data-demo-target="supply-comparison" aria-label="供給の比較">
          <div className="section-heading"><h2>数量と判断条件</h2><span>税抜 / 焙煎豆</span></div>
          {problem && <p className="message error" role="alert">{problem}</p>}
          {comparison && <><div className="sr-summary">{columns.map(column => <div key={column.key}>
            <span>{column.label}</span><strong>{column.scenario.units}<small> {column.result.calculation.product.unit}</small></strong>
            <span className={column.result.status === 'within-stock' ? 'sr-ok' : 'sr-risk'}>{column.result.status === 'within-stock' ? <CheckCircle2 size={15}/> : <TriangleAlert size={15}/>}{column.result.status === 'within-stock' ? '在庫条件内' : column.result.status === 'unknown' ? '在庫未確認' : '追加調達が必要'}</span>
            <dl><dt>確認済み不足</dt><dd>{formatKg(column.result.calculation.shortageGrams)} kg</dd><dt>在庫未確認</dt><dd>{column.result.calculation.unknownCount} 種</dd><dt>豆代</dt><dd>{jpy(column.result.calculation.totalCost)}</dd><dt>豆代 / 単位</dt><dd>{jpy(column.result.calculation.costPerUnit)}</dd><dt>使用豆の未確保残量</dt><dd>{column.result.remainingGrams === null ? '未確認' : `${formatKg(column.result.remainingGrams)} kg`}</dd></dl>
          </div>)}</div><p className="scope-note">停止仮定は補充に対する制約です。手元在庫は消失せず、期間別の補充可否・製造能力は未確認です。</p></>}
          <SupplyImpactGraph key={`${value.assumption.supplierId}:${value.outlook?.materialId ?? ''}`} supplierId={value.assumption.supplierId} materialId={value.outlook?.materialId} onSnapshot={setGraphEvidence}/>
          <div className="sr-candidates"><h3>対応候補</h3><button onClick={applyQuantity} disabled={value.datasetVersion !== data.version}><RotateCcw size={16}/>在庫内の数量案を試算</button><button onClick={onEdit} disabled={value.datasetVersion !== data.version}><FlaskConical size={16}/>商品開発で配合を検討<ArrowRight size={15}/></button><button title="対応案を元条件に戻す" aria-label="対応案を元条件に戻す" onClick={() => change({ proposal: structuredClone(value.baseline) })}><RotateCcw size={16}/></button></div>
        </section>
        <aside className="sr-decision" aria-label="停止仮定と判断" data-demo-target="supply-assumption">
          <h2>補充停止の仮定</h2><label className="sr-toggle"><input type="checkbox" checked={value.assumption.enabled} onChange={event => change({ assumption: { ...value.assumption, enabled: event.target.checked } })}/>仮定を有効にする</label>
          <label>開始日<input type="date" aria-label="停止仮定の開始日" value={value.assumption.from} onChange={event => change({ assumption: { ...value.assumption, from: event.target.value } })}/></label>
          <label>終了日<input type="date" aria-label="停止仮定の終了日" value={value.assumption.to} onChange={event => change({ assumption: { ...value.assumption, to: event.target.value } })}/></label>
          <label>仮定の理由<textarea aria-label="停止仮定の理由" value={value.assumption.reason} maxLength={1000} onChange={event => change({ assumption: { ...value.assumption, reason: event.target.value } })}/></label>
          <h3>未確認条件</h3><ul>{comparison?.proposal.unknowns.map(item => <li key={item}>{item}</li>)}</ul>
          <label>選択理由<textarea aria-label="対応案の選択理由" value={value.rationale} maxLength={2000} onChange={event => change({ rationale: event.target.value })}/></label>
        </aside>
      </div>
      <section className="sr-detail" data-demo-target="supply-evidence"><div className="sd-view-tabs" role="group" aria-label="検討の詳細"><button aria-pressed={detail === 'comparison'} onClick={() => setDetail('comparison')}>比較明細</button><button aria-pressed={detail === 'evidence'} onClick={() => setDetail('evidence')}>根拠</button></div>
        {detail === 'comparison' && comparison && <div className="table-scroll"><table><caption>対応案の必要量・既存確保・不足（kg）</caption><thead><tr><th>豆</th><th>比率</th><th>必要量</th><th>手元在庫</th><th>確保済み</th><th>利用可能</th><th>不足</th></tr></thead><tbody>{comparison.proposal.calculation.requirements.map(row => <tr key={row.material.id}><th>{row.material.name}</th><td>{row.percent}%</td><td>{formatKg(row.requiredGrams)}</td><td>{row.stockGrams === null ? '未確認' : formatKg(row.stockGrams)}</td><td>{formatKg(row.reservedGrams)}</td><td>{row.availableGrams === null ? '未確認' : formatKg(row.availableGrams)}</td><td>{row.shortageGrams === null ? '未確認' : formatKg(row.shortageGrams)}</td></tr>)}</tbody></table></div>}
        {detail === 'evidence' && <dl className="sr-evidence"><dt>計算元</dt><dd>{data.datasetId} / {data.version}</dd><dt>業務基準時点</dt><dd>{data.asOf}</dd><dt>受領日時</dt><dd>{workspace.receivedAt}</dd><dt>取得元</dt><dd>{workspace.source}</dd><dt>Graph照会</dt><dd>{graphEvidence ? `${graphEvidence.retrievedAt} / ${graphEvidence.nodes.length} レコード / ${graphEvidence.truncated || graphEvidence.missingScopeIds.length ? '部分取得' : '指定範囲取得済み'}` : '未取得'}</dd><dt>仮定</dt><dd>{value.assumption.enabled ? `${company?.name ?? value.assumption.supplierId} / ${value.assumption.from} - ${value.assumption.to} / ${value.assumption.reason}` : '無効'}</dd><dt>境界</dt><dd>補充予定・設備能力・商品系譜の根拠は未取得。関連会社や豆が同じでも、注文の損失額は算定しません。</dd></dl>}
      </section>
      <SupplyDecisionHistory value={value} graph={graphEvidence} onRestore={onChange} attempt={saveAttempt} onAttempt={onSaveAttempt}/>
    </>}
  </div>;
}