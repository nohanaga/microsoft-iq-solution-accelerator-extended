import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition } from 'cytoscape';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { Dataset, Scenario } from './domain';

function elementsFor(data: Dataset, scenario: Scenario): ElementDefinition[] {
  const nodes = new Map<string, ElementDefinition>();
  const edges = new Map<string, ElementDefinition>();
  const node = (id: string, label: string, kind: string, detail: string) => nodes.set(id, { data: { id, label, kind, detail } });
  const edge = (source: string, target: string, label: string, detail: string) => {
    const id = `${source}:${target}`;
    edges.set(id, { data: { id, source, target, label, detail } });
  };
  const concept = data.concepts.find(row => row.id === scenario.conceptId)!;
  node('concept', concept.name, 'concept', `${concept.id} / v${concept.version} / 検討案。現行 SKU とは別です。`);
  node('NEED-01', '甘さ控えめの要望', 'need', 'NEED-01 / ProductReview と ReviewTopic に由来。件数・原文は顧客の声で確認。');
  edge('NEED-01', 'concept', '対応する案', 'DevelopmentProject DEV-001 の企画。需要予測ではありません。');
  for (const recipe of data.recipeLines.filter(row => row.conceptId === concept.id)) {
    const material = data.materials.find(row => row.id === recipe.materialId)!;
    const offer = data.offers.find(row => row.id === recipe.offerId)!;
    const supplier = data.suppliers.find(row => row.id === offer.supplierId)!;
    const recipeNode = `recipe:${material.id}`;
    node(recipeNode, `${recipe.quantity} ${material.unit === 'each' ? '組' : material.unit}`, 'recipe', `${recipe.id} / 歩留まり ${recipe.yieldPercent}%（仮定）`);
    node(material.id, material.name, 'material', `${material.id} / 基準単位 ${material.unit}`);
    node(supplier.id, supplier.name, 'supplier', `${supplier.id} / ${supplier.city}`);
    edge('concept', recipeNode, '配合', recipe.id);
    edge(recipeNode, material.id, '使用原料', `${recipe.id} → ${material.id}`);
    edge(material.id, supplier.id, offer.qualification === 'approved' ? '資格登録済み' : '供給候補・未確認', `${offer.id} / 原料別の供給条件 / 根拠 ${offer.evidenceId}`);
    for (const current of data.currentRecipes.filter(row => row.materialId === material.id)) {
      const product = data.products.find(row => row.id === current.productId)!;
      node(product.id, product.name, 'product', `${product.id} / 現行品。在庫共用は数量・時点を別途比較。`);
      edge(material.id, product.id, '現行品でも使用', `${current.id} / ${current.quantity} ${material.unit}`);
    }
    for (const [storeId, count] of Object.entries(scenario.storeQuantities).filter(([, count]) => count > 0)) {
      const store = data.stores.find(row => row.id === storeId)!;
      node(store.id, `${store.name}\n想定 ${count} 杯`, 'store', `${store.id} / ${scenario.start} ～ ${scenario.end} / 未販売の展開仮定`);
      edge(material.id, store.id, '必要量を計算', `${store.id} / ${material.id} / 在庫不足・未登録は必要量表で確認。`);
    }
  }
  for (const rule of data.rules) {
    node(rule.id, rule.name, 'rule', `${rule.id} / 根拠 ${rule.evidenceId} / 適合判定は条件表で確認。`);
    edge('concept', rule.id, '条件を照合', `${concept.id} / ${rule.id}`);
  }
  return [...nodes.values(), ...edges.values()];
}

export function ImpactGraph({ data, scenario }: { data: Dataset; scenario: Scenario }) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  const [selected, setSelected] = useState('');
  useEffect(() => {
    if (!host.current) return;
    const current = elementsFor(data, scenario);
    const baseline = elementsFor(data, { ...scenario, conceptId: 'CON-A' });
    const currentIds = new Set(current.map(row => row.data.id));
    const baselineIds = new Set(baseline.map(row => row.data.id));
    const elements = current.map(row => ({ ...row, classes: baselineIds.has(row.data.id) ? '' : 'added' }));
    for (const row of baseline) if (!currentIds.has(row.data.id)) elements.push({ ...row, classes: 'removed' });
    const css = getComputedStyle(document.documentElement);
    const color = (name: string) => css.getPropertyValue(`--cp-${name}`).trim();
    const instance = cytoscape({
      container: host.current, elements, minZoom: 0.18, maxZoom: 2.5,
      layout: { name: 'breadthfirst', directed: true, roots: ['NEED-01'], padding: 35, spacingFactor: 1.15 },
      style: [
        { selector: 'node, edge', style: { 'font-family': getComputedStyle(document.body).fontFamily } },
        { selector: 'node', style: { label: 'data(label)', 'background-color': color('surface'), 'border-color': color('border-strong'), 'border-width': 1.5, color: color('text'), width: 86, height: 48, shape: 'round-rectangle', 'font-size': 10, 'text-wrap': 'wrap', 'text-max-width': '80px', 'text-valign': 'center', 'text-halign': 'center' } },
        { selector: 'node[kind="concept"]', style: { 'background-color': color('accent'), color: color('accent-fg'), width: 130, height: 60, 'text-max-width': '120px' } },
        { selector: 'node[kind="material"]', style: { shape: 'ellipse', 'border-color': color('link') } },
        { selector: 'node[kind="supplier"]', style: { shape: 'hexagon', 'border-color': color('success') } },
        { selector: 'node[kind="rule"]', style: { shape: 'diamond', 'border-color': color('warning'), width: 96, height: 72 } },
        { selector: 'edge', style: { label: 'data(label)', 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'line-color': color('border-strong'), 'target-arrow-color': color('border-strong'), width: 1.2, 'font-size': 8, color: color('text-muted'), 'text-background-color': color('surface'), 'text-background-opacity': 0.9, 'text-background-padding': '2px', 'text-rotation': 'autorotate' } },
        { selector: '.added', style: { 'border-color': color('success'), 'line-color': color('success'), 'target-arrow-color': color('success'), 'border-width': 3, width: 3 } },
        { selector: 'node.added', style: { width: 86 } },
        { selector: '.removed', style: { 'border-style': 'dashed', 'line-style': 'dashed', opacity: 0.4 } },
        { selector: ':selected', style: { 'border-color': color('accent'), 'line-color': color('accent'), 'target-arrow-color': color('accent'), 'border-width': 4 } }
      ]
    });
    graph.current = instance;
    setSelected('');
    instance.on('tap', 'node, edge', event => setSelected(String(event.target.data('detail'))));
    const observer = new ResizeObserver(() => { instance.resize(); instance.fit(undefined, 35); });
    observer.observe(host.current);
    return () => { observer.disconnect(); instance.destroy(); graph.current = null; };
  }, [data, scenario]);
  return <section className="graph-section" aria-label="商品案の影響関係図">
    <div className="section-heading"><h3>影響関係図</h3><div className="graph-tools">
      <span className="legend added">追加</span><span className="legend removed">A から除外</span>
      <button type="button" title="拡大" aria-label="関係図を拡大" onClick={() => graph.current?.zoom(Math.min(2.5, (graph.current?.zoom() ?? 1) * 1.2))}><Plus size={16}/></button>
      <button type="button" title="縮小" aria-label="関係図を縮小" onClick={() => graph.current?.zoom(Math.max(0.18, (graph.current?.zoom() ?? 1) / 1.2))}><Minus size={16}/></button>
      <button type="button" title="全体表示" aria-label="関係図の全体表示" onClick={() => graph.current?.fit(undefined, 35)}><Maximize size={16}/></button>
    </div></div>
    <div ref={host} className="graph-canvas" role="img" aria-label="候補、配合、原料、供給元、現行品、対象店舗、設計条件の関係。詳細な必要量と原料 ID は後続の表に掲載。"/>
    <p className="graph-selection" aria-live="polite">{selected || '基準案 A との依存関係差分'}</p>
  </section>;
}