import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, Upload, X } from 'lucide-react';
import { downloadJson } from './adapter';
import { useWorkspace } from './workspace-context';
import { SupplyImpactGraph } from './SupplyImpactGraph';
import { calculateMaterialOutlook, materialOutlookInputSchema, materialOutlookTemplate, materialResponseRequest } from './material-outlook';
import type { MaterialOutlookInput, MaterialOutlookSelection, MaterialResponseRequest } from './material-outlook';
import './supply-dashboard.css';
import './material-outlook.css';

interface MaterialOutlookProps {
  input: MaterialOutlookInput | null;
  onInput: (input: MaterialOutlookInput | null) => void;
  selection: MaterialOutlookSelection | null;
  onSelection: (selection: MaterialOutlookSelection) => void;
  onResponse: (request: MaterialResponseRequest) => void;
}
const kg = (value: number | null) => value === null ? '未確認' : value > 0 && value < 1 ? '< 0.001' : value < 0 && value > -1 ? '> -0.001' : (value / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 3 });
const quantity = (value: number) => value.toLocaleString('ja-JP', { maximumFractionDigits: 2 });

export function MaterialOutlook({ input, onInput, selection, onSelection, onResponse }: MaterialOutlookProps) {
  const { data } = useWorkspace();
  const result = calculateMaterialOutlook(data, input);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [facilityId, setFacilityId] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => { setBusy(false); return () => { generation.current += 1; }; }, [data]);
  const materialName = (id: string) => data.development.materials.find(row => row.id === id)?.name ?? id;
  const productName = (id: string) => data.operations.products.find(row => row.id === id)?.name ?? id;
  const storeName = (id: string) => data.operations.stores.find(row => row.id === id)?.name ?? id;
  const cells = result.cells.filter(row => !facilityId || row.facilityId === facilityId);
  const selected = cells.find(row => row.materialId === selection?.materialId && row.facilityId === selection.facilityId && row.date === selection.date)
    ?? cells.find(row => (row.shortageGrams ?? 0) > 0) ?? cells.find(row => row.requiredGrams > 0);
  const pools = [...new Map(cells.map(row => [JSON.stringify([row.facilityId, row.materialId]), row])).values()];
  const cellIndex = new Map(cells.map(row => [row.key, row]));
  const excluded = [...new Map(result.excluded.map(row => [JSON.stringify([row.productId, row.storeId, row.reason]), row])).values()];
  const firstShortage = cells.filter(row => (row.shortageGrams ?? 0) > 0).map(row => row.date).sort()[0];
  const upload = async (file?: File) => {
    if (!file) return;
    const current = ++generation.current;
    setBusy(true); setMessage('');
    try {
      if (file.size > 2_000_000) throw new Error('入力ファイルは 2 MB 以下にしてください。');
      const raw: unknown = JSON.parse(await file.text());
      if (current !== generation.current) return;
      const parsed = materialOutlookInputSchema.parse(raw);
      const candidate = calculateMaterialOutlook(data, parsed);
      if (candidate.error) throw new Error(candidate.error);
      onInput(parsed);
    } catch (reason) {
      if (current === generation.current) setMessage(reason instanceof Error ? reason.message : '入力を読み込めません。');
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const metrics = [
    { key: 'requiredGrams', label: '必要量' }, { key: 'availableGrams', label: '利用可能量' },
    { key: 'receiptGrams', label: '入荷予定' }, { key: 'shortageGrams', label: '不足残量' },
  ] as const;
  return <div className="material-outlook" data-demo-target="material-outlook">
    <header className="sd-heading"><div><span className="eyebrow">SUPPLY OUTLOOK</span><h1>需要と材料見通し</h1></div><span className="badge">確認済み対応分 / 予測</span></header>
    <div className="mo-toolbar">
      <label>製造拠点<select value={facilityId} onChange={event => setFacilityId(event.target.value)}><option value="">すべて</option>{data.development.facilities.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <button onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={16}/>{busy ? '読み込み中' : '確認済みデータを取り込む'}</button>
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}/>
      <button onClick={() => downloadJson(materialOutlookTemplate(data), 'material-outlook-input.json')} title="入力ひな形 JSON" aria-label="入力ひな形 JSON をダウンロード"><Download size={16}/></button>
      {input && <button disabled={busy} title="取り込みを解除" aria-label="取り込みを解除" onClick={() => { onInput(null); setMessage(''); }}><X size={16}/></button>}
    </div>
    {(message || result.error) && <p className="message error" role="alert">{message || result.error}</p>}
    <dl className="mo-summary"><div><dt>変換できた予測</dt><dd>{result.demands.length} / {data.predictions.demandForecast.length} 件</dd></div><div><dt>対象材料・拠点</dt><dd>{pools.length} 組</dd></div><div><dt>最初の不足日</dt><dd>{firstShortage ?? (cells.length && cells.every(row => row.shortageGrams !== null) ? '対象範囲内なし' : '未確認')}</dd></div><div><dt>未確認の材料・日付</dt><dd>{cells.length ? cells.filter(row => row.shortageGrams === null).length.toLocaleString('ja-JP') : '未算定'}</dd></div></dl>
    {!result.input && !result.error && <p className="message" role="status">確認済みの商品・配合対応は未登録です。材料需要・不足は未算定です。</p>}
    {!data.predictions.demandForecast.length && <p className="empty">需要予測がありません。</p>}
    {result.input && <details className="mo-basis"><summary>算定根拠</summary><dl className="sr-evidence">
      <dt>対応原本</dt><dd>{result.input.source} / 確認 {result.input.confirmedAt}</dd>
      <dt>予測モデル</dt><dd>{result.input.forecastModelVersion}</dd><dt>材料在庫基準</dt><dd>{data.development.asOf} / {data.development.version}</dd>
      <dt>需要の範囲</dt><dd>既存の確定計画に含まれない追加需要 / {result.input.demandBasisEvidence}</dd>
      <dt>材料必要日</dt><dd>販売予測日から確認済みの所要日数（暦日）を控除</dd>
      <dt>利用可能量</dt><dd>前日残高と当日に利用可能な確定入荷の合計。初期残高は手元在庫から既存確保を控除。</dd>
      <dt>不足残量</dt><dd>必要量を控除した累積残高の不足分。日付間の合計は不可。入荷確認範囲に欠落がある場合、その日以降は未確認。</dd>
    </dl></details>}
    {!!cells.length && <>
      <p className="scope-note">確認済み対応分のみ・kg。利用可能量には当日の入荷予定を含みます。予測の不確実性、未対応商品、個別受注の納期は判定対象外です。</p>
      <div className="mo-matrix" role="region" aria-label="材料と日付の見通し" tabIndex={0}><table><caption>材料必要日別の見通し（kg）</caption><thead><tr><th scope="col">材料 / 拠点</th><th scope="col">指標</th>{result.dates.map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead><tbody>
        {pools.flatMap(pool => metrics.map((metric, index) => <tr key={`${pool.key}-${metric.key}`}>
          {index === 0 && <th scope="rowgroup" rowSpan={4}>{materialName(pool.materialId)}<small>{data.development.facilities.find(row => row.id === pool.facilityId)?.name ?? pool.facilityId}</small></th>}
          <th scope="row">{metric.label}</th>{result.dates.map(day => {
            const cell = cellIndex.get(JSON.stringify([pool.facilityId, pool.materialId, day]))!;
            const amount = cell[metric.key];
            return <td key={day} data-shortage={metric.key === 'shortageGrams' && amount !== null && amount > 0} data-unknown={amount === null}>
              {metric.key === 'shortageGrams' ? <button aria-pressed={selected?.key === cell.key} aria-label={`${materialName(pool.materialId)} ${day} 不足 ${kg(amount)}${amount === null ? '' : ' kg'}`} onClick={() => onSelection({ materialId: cell.materialId, facilityId: cell.facilityId, date: cell.date })}>{kg(amount)}</button> : kg(amount)}
            </td>;
          })}</tr>))}
      </tbody></table></div>
    </>}
    {selected && <section className="mo-detail" aria-label="選択した材料需要"><div className="section-heading"><h2>{materialName(selected.materialId)} / {selected.date}</h2><span>不足残量 {kg(selected.shortageGrams)}{selected.shortageGrams === null ? '' : ' kg'}</span></div>
      <p className="scope-note">対応検討は選択した商品・日付の予測数量を切り上げ、基準時点の在庫と比較します。日別の累積不足や将来入荷を、その比較には転記しません。</p>
      {!selected.demands.length && <p className="empty">この日の対象需要はありません。前日からの残高を参照してください。</p>}
      <div className="table-scroll"><table><caption>選択日の材料需要の内訳</caption><thead><tr><th>販売商品 / 店舗</th><th>予測日</th><th>配合</th><th>予測 / 製造数</th><th>材料必要量</th><th>対応</th></tr></thead><tbody>{selected.demands.map(demand => <tr key={demand.key}>
        <th>{productName(demand.productId)}<small>{storeName(demand.storeId)}</small></th><td>{demand.salesDate}</td><td>{data.development.recipes.find(row => row.id === demand.mapping.recipeId)?.name ?? demand.mapping.recipeId}<small>{demand.mapping.evidence}</small></td>
        <td>{quantity(demand.forecastUnits)} / {quantity(demand.productionUnits)}</td><td>{kg(demand.materials.find(row => row.materialId === selected.materialId)!.grams)} kg</td>
        <td><button disabled={selected.shortageGrams === null || selected.shortageGrams <= 0 || demand.productionUnits <= 0 || Math.ceil(demand.productionUnits) > 10000} onClick={() => { try { onResponse(materialResponseRequest(data, result, selected, demand)); setMessage(''); } catch (reason) { setMessage(reason instanceof Error ? reason.message : '対応検討を開けません。'); } }}><ArrowRight size={16}/>対応検討</button></td>
      </tr>)}</tbody></table></div>
      <SupplyImpactGraph key={`${selected.facilityId}:${selected.materialId}`} supplierId={data.development.materials.find(row => row.id === selected.materialId)!.supplierId} materialId={selected.materialId} onSnapshot={() => undefined}/>
    </section>}
    {!!result.excluded.length && <details className="mo-exclusions" open={!result.demands.length}><summary>未変換の予測 {result.excluded.length} 件</summary><div className="table-scroll"><table><caption>商品・店舗・理由ごとの未変換一覧</caption><thead><tr><th>商品</th><th>店舗</th><th>理由</th></tr></thead><tbody>{excluded.map(row => <tr key={JSON.stringify([row.productId, row.storeId, row.reason])}><th>{productName(row.productId)}</th><td>{storeName(row.storeId)}</td><td>{row.reason}</td></tr>)}</tbody></table></div></details>}
  </div>;
}