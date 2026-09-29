import { useEffect, useRef, useState } from 'react';
import { Download, RotateCcw, Save } from 'lucide-react';
import { downloadJson } from './adapter';
import { jpy } from './analytics';
import { compareSupplyCase } from './supply-response-model';
import type { SupplyAssessment, SupplyCase } from './supply-response-model';
import type { FabricGraphSnapshot } from './fabric-impact';
import { savedRecordSchema, supplyDecisionSchema } from './workspace-schema';
import type { SavedRecord } from './workspace-schema';
import { useWorkspace } from './workspace-context';

interface Props {
  value: SupplyCase; graph: FabricGraphSnapshot | null;
  onRestore: (value: SupplyCase) => void;
  attempt: SavedRecord | null;
  onAttempt: (record: SavedRecord | null) => void;
}
const summarize = (assessment: SupplyAssessment) => ({
  status: assessment.status, shortageGrams: assessment.calculation.shortageGrams, unknownCount: assessment.calculation.unknownCount,
  totalCost: assessment.calculation.totalCost, costPerUnit: assessment.calculation.costPerUnit, remainingGrams: assessment.remainingGrams,
  exposedMaterialIds: assessment.exposedMaterialIds, exposedShortageGrams: assessment.exposedShortageGrams, unknowns: assessment.unknowns,
  requirements: assessment.calculation.requirements.map(({ material, ...requirement }) => ({ materialId: material.id, ...requirement })),
});

export function SupplyDecisionHistory({ value, graph, onRestore, attempt, onAttempt }: Props) {
  const workspace = useWorkspace();
  const [records, setRecords] = useState<SavedRecord[]>([]);
  const [author, setAuthor] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<SavedRecord | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    workspace.repository.listRecords('supply', controller.signal).then(rows => {
      if (!controller.signal.aborted) setRecords(current => [...current, ...rows.filter(row => !current.some(existing => existing.id === row.id))]);
    }).catch(reason => { if (!controller.signal.aborted) setNotice(`履歴取得失敗: ${reason instanceof Error ? reason.message : '接続エラー'}`); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, [workspace.repository]);
  const capture = () => {
    const comparison = compareSupplyCase(value, workspace.data.development);
    const recordedAt = new Date().toISOString();
    const payload = supplyDecisionSchema.parse({
      schemaVersion: 1, status: 'draft', case: value, datasetId: workspace.data.development.datasetId,
      asOf: workspace.data.development.asOf, receivedAt: workspace.receivedAt, recordedAt,
      executionMode: workspace.mode, recordedBy: author,
      comparison: { baseline: summarize(comparison.baseline), suspended: summarize(comparison.suspended), proposal: summarize(comparison.proposal) },
      graph: graph ? { graphIds: Object.fromEntries(Object.entries(graph.graphIds).filter(([, id]) => !!id)), retrievedAt: graph.retrievedAt, truncated: graph.truncated,
        missingScopeIds: graph.missingScopeIds, nodeIds: graph.nodes.map(node => node.id), derivedEdgeIds: graph.edges.filter(edge => edge.kind === 'derived').map(edge => edge.id) } : null,
    });
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 64000) throw new Error('判断記録が64KBを超えています。探索範囲を減らしてください。');
    return savedRecordSchema.parse({ id: crypto.randomUUID(), kind: 'supply', recordedAt, datasetVersion: value.datasetVersion, payload });
  };
  const save = async () => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller; setBusy(true); setNotice('');
    try {
      const record = attempt ?? capture();
      onAttempt(record);
      const saved = await workspace.repository.saveRecord(record, controller.signal);
      if (!controller.signal.aborted) {
        setRecords(current => [saved, ...current.filter(row => row.id !== saved.id)]);
        onAttempt(null);
        setNotice(workspace.mode === 'live' ? '判断材料をSQLへ保存し、読戻しを確認しました。' : '判断材料をメモリーへ保存しました。再読み込みすると失われます。');
      }
    } catch (reason) { if (!controller.signal.aborted) setNotice(`保存未完了: ${reason instanceof Error ? reason.message : '接続エラー'}`); }
    finally { if (!controller.signal.aborted) setBusy(false); pending.current = null; }
  };
  const exportRecord = () => {
    try { const record = capture(); downloadJson(record, `maikuro-supply-${record.id}.json`); setNotice('判断材料をJSON出力しました。SQL保存ではありません。'); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : '出力できません。'); }
  };
  const restore = () => {
    if (!selected) return;
    try {
      const previous = supplyDecisionSchema.parse(selected.payload);
      const next = { ...previous.case, id: crypto.randomUUID(), datasetVersion: workspace.data.development.version };
      compareSupplyCase(next, workspace.data.development);
      onRestore(next);
      setNotice(`保存時点 ${selected.recordedAt} の条件を、現在のデータで再計算しました。保存記録は変更していません。`);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '履歴を再開できません。'); }
  };
  const historical = selected ? supplyDecisionSchema.safeParse(selected.payload) : null;
  return <section className="sr-history" data-demo-target="supply-save" aria-label="供給判断の保存と履歴">
    <div className="section-heading"><h2>判断材料の保存</h2><span className="badge">下書き / 承認・発注なし</span></div>
    <div className="sr-start"><label>記録者（自己申告）<input aria-label="判断の記録者" value={author} maxLength={128} onChange={event => setAuthor(event.target.value)}/></label><button disabled={busy || (!attempt && (!author.trim() || !value.rationale.trim()))} onClick={() => void save()}><Save size={16}/>{busy ? '保存確認中' : attempt ? '前回の保存を再確認' : '判断材料を保存'}</button><button title="判断材料をJSON出力" aria-label="供給判断のJSON出力" disabled={busy || !!attempt} onClick={exportRecord}><Download size={16}/></button></div>
    {attempt && <p className="message" role="status">前回の保存結果を確認中です。再確認では同じID・同じ内容を使います。</p>}
    {notice && <p className="message" role="status">{notice}</p>}
    <p className="scope-note">{workspace.mode === 'live' ? '既存の認証済み利用者向け共有履歴です。記録者名は認証主体の証明ではありません。' : 'メモリー履歴はページ再読み込みで失われます。'} 品質・販売承認は別途必要です。</p>
    <div className="sr-start"><label>保存履歴<select aria-label="供給判断の保存履歴" value={selected?.id ?? ''} onChange={event => setSelected(records.find(row => row.id === event.target.value) ?? null)}><option value="">保存記録を選択</option>{records.map(row => <option key={row.id} value={row.id}>{row.recordedAt} / {row.datasetVersion}</option>)}</select></label><button disabled={!historical?.success || busy || !!attempt} onClick={restore}><RotateCcw size={16}/>現在のデータで再開</button></div>
    {historical?.success && <div className="sr-evidence"><strong>保存時の数値</strong><span>{historical.data.comparison.proposal.shortageGrams / 1000} kg不足 / {jpy(historical.data.comparison.proposal.totalCost)} / 未確認在庫 {historical.data.comparison.proposal.unknownCount} 種</span><strong>保存時の理由</strong><span>{historical.data.case.rationale}</span></div>}
  </section>;
}