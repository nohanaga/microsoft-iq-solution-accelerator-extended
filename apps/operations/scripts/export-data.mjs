import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import Papa from 'papaparse';

const root = new URL('../', import.meta.url);
const seedText = await readFile(new URL('data/seed.json', root), 'utf8');
const blendText = await readFile(new URL('data/blend-seed.json', root), 'utf8');
const blend = JSON.parse(blendText);
const { asOf: blendAsOf, version: blendVersion, ...blendTables } = blend;
const { reviewSeeds, recipeSeeds, inventorySeeds, ...seed } = JSON.parse(seedText);
const orders = [], orderLines = [], reviews = [], reviewTopics = [];
for (const [index, [storeId, productId, rating, topic, text, date]] of reviewSeeds.entries()) {
  const suffix = String(index + 1).padStart(3, '0');
  const product = seed.products.find(row => row.id === productId);
  const customerId = `CUS-${suffix}`, orderId = `ORD-${suffix}`, lineId = `LINE-${suffix}`, reviewId = `REV-${suffix}`;
  orders.push({ id: orderId, customerId, storeId, orderedAt: `${date}T09:00:00+09:00`, fulfilledAt: `${date}T12:00:00+09:00`, status: 'completed' });
  orderLines.push({ id: lineId, orderId, productId, quantity: 1, priceExTax: product.priceExTax, taxPercent: product.taxPercent, discountExTax: 0 });
  reviews.push({ id: reviewId, lineId, customerId, revision: 1, rating, text, publishedAt: `${date}T16:00:00+09:00`, analyzedAt: `${date}T16:05:00+09:00`, status: 'published' });
  reviewTopics.push({ id: `TOP-${suffix}`, reviewId, revision: 1, topic, classifierVersion: 'synthetic-author-v1' });
}
orders.push({ id: 'ORD-DEMO-0702', customerId: 'CUS-DEMO', storeId: 'STR-04', orderedAt: '2026-07-02T10:00:00+09:00', fulfilledAt: '2026-07-02T15:00:00+09:00', status: 'completed' });
orderLines.push({ id: 'LINE-DEMO-0702', orderId: 'ORD-DEMO-0702', productId: 'PRD-002', quantity: 2, priceExTax: 600, taxPercent: 8, discountExTax: 0 });
for (const [suffix, storeId, date] of [['04', 'STR-04', '2026-07-03'], ['06', 'STR-06', '2026-07-04']]) {
  orders.push({ id: `ORD-CANCEL-${suffix}`, customerId: `CUS-CANCEL-${suffix}`, storeId, orderedAt: `${date}T09:00:00+09:00`, fulfilledAt: null, status: 'cancelled' });
  orderLines.push({ id: `LINE-CANCEL-${suffix}`, orderId: `ORD-CANCEL-${suffix}`, productId: 'PRD-002', quantity: 2, priceExTax: 600, taxPercent: 8, discountExTax: 0 });
}
const recipeLines = recipeSeeds.flatMap(({ conceptId, components }) => components.map(([materialId, offerId, quantity], index) => ({ id: `${conceptId}-REC-${index + 1}`, conceptId, materialId, offerId, quantity, yieldPercent: 100 })));
const inventory = inventorySeeds.flatMap(({ storeId, rows }) => rows.map(([materialId, onHand, reserved]) => ({ id: `${storeId}-${materialId}`, storeId, materialId, onHand, reserved, asOf: seed.asOf })));
const serviceFeedback = [
  { id: 'SVC-01', orderId: 'ORD-CANCEL-04', rating: 1, text: '予約商品が欠品となりキャンセルしました。', dissatisfied: true, publishedAt: '2026-07-03T16:00:00+09:00' },
  { id: 'SVC-02', orderId: 'ORD-CANCEL-06', rating: 2, text: '入荷の案内が遅く予定を変更しました。', dissatisfied: true, publishedAt: '2026-07-04T16:00:00+09:00' },
  { id: 'SVC-03', orderId: 'ORD-DEMO-0702', rating: 5, text: '指定時刻に受け取れました。', dissatisfied: false, publishedAt: '2026-07-02T16:00:00+09:00' },
  { id: 'SVC-04', orderId: 'ORD-020', rating: 5, text: '定刻で受け取れました。', dissatisfied: false, publishedAt: '2026-06-28T16:00:00+09:00' }
];
const supplyImpacts = ['04', '06'].map(suffix => ({ id: `IMPACT-${suffix}`, shipmentId: `SHP-JP-0703-${suffix}`, lineId: `LINE-CANCEL-${suffix}`, productId: 'PRD-002', shortageAt: `2026-07-0${suffix === '04' ? '3' : '4'}T10:00:00+09:00`, evidence: '合成欠品記録。対象商品・店舗・期間・取消明細を照合。顧客配送ではなく店舗への入荷。' }));
const customers = [...new Set(orders.map(order => order.customerId))].map((id, index) => ({ id, displayName: `珈琲好き${String(index + 1).padStart(3, '0')}`, loyaltyTier: '一般' }));
const data = { ...seed, customers, orders, orderLines, reviews, reviewTopics, serviceFeedback, recipeLines, inventory, supplyImpacts };
const entityNames = {
  products: 'Product', stores: 'Store', suppliers: 'Supplier', customers: 'Customer', orders: 'Order', orderLines: 'OrderLine',
  reviews: 'ProductReview', reviewTopics: 'ReviewTopic', serviceFeedback: 'ServiceFeedback',
  materials: 'Material', offers: 'SupplyOffer', concepts: 'ProductConcept', recipeLines: 'RecipeLine',
  currentRecipes: 'CurrentRecipe', inventory: 'MaterialInventory', inbound: 'PlannedInbound',
  shipments: 'Shipment', supplyImpacts: 'SupplyImpact', evidence: 'EvidenceDocument', rules: 'DesignRule', decisionReasons: 'DecisionReason'
};
const relationSpecs = [
  ['orderCustomer','orders','customers','customerId'],
  ['productSupplier','products','suppliers','supplierId'], ['orderStore','orders','stores','storeId'],
  ['lineOrder','orderLines','orders','orderId'], ['lineProduct','orderLines','products','productId'],
  ['reviewLine','reviews','orderLines','lineId'], ['topicReview','reviewTopics','reviews','reviewId'],
  ['serviceOrder','serviceFeedback','orders','orderId'], ['offerMaterial','offers','materials','materialId'],
  ['offerSupplier','offers','suppliers','supplierId'], ['offerEvidence','offers','evidence','evidenceId'],
  ['recipeConcept','recipeLines','concepts','conceptId'], ['recipeMaterial','recipeLines','materials','materialId'],
  ['recipeOffer','recipeLines','offers','offerId'], ['currentProduct','currentRecipes','products','productId'],
  ['currentMaterial','currentRecipes','materials','materialId'], ['inventoryStore','inventory','stores','storeId'],
  ['inventoryMaterial','inventory','materials','materialId'], ['inboundStore','inbound','stores','storeId'],
  ['inboundMaterial','inbound','materials','materialId'], ['shipmentSupplier','shipments','suppliers','supplierId'],
  ['shipmentStore','shipments','stores','storeId'], ['impactShipment','supplyImpacts','shipments','shipmentId'],
  ['impactLine','supplyImpacts','orderLines','lineId'], ['impactProduct','supplyImpacts','products','productId'],
  ['ruleEvidence','rules','evidence','evidenceId'], ['reasonPast','decisionReasons','evidence','pastEvidenceId']
];
const specialTables = {
  projects: [{ id: 'DEV-001', name: '甘さひかえめ バニラ水出し珈琲（仮称）', sourceProductId: 'PRD-002', status: '検討中', asOf: data.asOf }],
  needs: [{ id: 'NEED-01', name: '香りを残して甘さ控えめに', projectId: 'DEV-001', topic: '甘さ控えめ' }],
  needReviews: reviewTopics.filter(row => row.topic === '甘さ控えめ').map(row => ({ id: `NEED-${row.reviewId}`, needId: 'NEED-01', reviewId: row.reviewId })),
  conceptRules: data.concepts.flatMap(concept => data.rules.map(rule => ({ id: `${concept.id}-${rule.id}`, conceptId: concept.id, ruleId: rule.id }))),
  currentEvidenceLinks: data.decisionReasons.filter(row => row.currentEvidenceId).map(row => ({ id: `CURRENT-${row.id}`, reasonId: row.id, evidenceId: row.currentEvidenceId })),
  scenarios: [{ id: 'SCN-001', name: '神田・横浜 7 月展開案', projectId: 'DEV-001', conceptId: 'CON-A', startDate: '2026-07-14', endDate: '2026-07-20', status: '仮定', asOf: data.asOf }],
  scenarioStores: [{ id: 'SCN-001-04', scenarioId: 'SCN-001', storeId: 'STR-04', quantity: 100 }, { id: 'SCN-001-06', scenarioId: 'SCN-001', storeId: 'STR-06', quantity: 60 }]
};
Object.assign(entityNames, { projects: 'DevelopmentProject', needs: 'CustomerNeed', needReviews: 'NeedReview', conceptRules: 'ConceptRule', currentEvidenceLinks: 'CurrentEvidenceLink', scenarios: 'DevelopmentScenario', scenarioStores: 'ScenarioStore' });
relationSpecs.push(
  ['scenarioConcept','scenarios','concepts','conceptId'], ['scenarioProject','scenarios','projects','projectId'],
  ['scenarioStoreScenario','scenarioStores','scenarios','scenarioId'], ['scenarioStoreStore','scenarioStores','stores','storeId'],
  ['projectProduct','projects','products','sourceProductId'], ['conceptProject','concepts','projects','projectId'],
  ['needProject','needs','projects','projectId'], ['linkNeed','needReviews','needs','needId'], ['linkReview','needReviews','reviews','reviewId'],
  ['conceptRuleConcept','conceptRules','concepts','conceptId'], ['conceptRuleRule','conceptRules','rules','ruleId'],
  ['reasonProject','decisionReasons','projects','projectId'], ['currentReason','currentEvidenceLinks','decisionReasons','reasonId'], ['currentEvidence','currentEvidenceLinks','evidence','evidenceId']
);
Object.assign(entityNames, {
  blendProjects: 'BlendProject', roastingFacilities: 'RoastingFacility', greenBeans: 'GreenBean', beanImporters: 'BeanImporter',
  beanOffers: 'BeanOffer', beanStocks: 'BeanStock', beanInbounds: 'BeanInbound', beanProducts: 'BeanProduct',
  beanAllocations: 'BeanAllocation', blendDrafts: 'BlendDraft', blendComponents: 'BlendComponent', blendDestinations: 'BlendDestination'
});
relationSpecs.push(
  ['blendProjectFacility','blendProjects','roastingFacilities','facilityId'],
  ['beanOfferBean','beanOffers','greenBeans','beanId'], ['beanOfferSupplier','beanOffers','suppliers','supplierId'], ['beanOfferImporter','beanOffers','beanImporters','importerId'],
  ['beanStockFacility','beanStocks','roastingFacilities','facilityId'], ['beanStockBean','beanStocks','greenBeans','beanId'],
  ['beanInboundFacility','beanInbounds','roastingFacilities','facilityId'], ['beanInboundBean','beanInbounds','greenBeans','beanId'],
  ['beanAllocationFacility','beanAllocations','roastingFacilities','facilityId'], ['beanAllocationBean','beanAllocations','greenBeans','beanId'], ['beanAllocationProduct','beanAllocations','beanProducts','beanProductId'],
  ['blendDraftProject','blendDrafts','blendProjects','projectId'], ['blendComponentDraft','blendComponents','blendDrafts','draftId'], ['blendComponentOffer','blendComponents','beanOffers','offerId'],
  ['blendDestinationDraft','blendDestinations','blendDrafts','draftId'], ['blendDestinationStore','blendDestinations','stores','storeId']
);
const allTables = { ...data, ...specialTables, ...blendTables };
const ontologyTables = Object.fromEntries(Object.keys(entityNames).map(table => [table, allTables[table].map(row => Object.fromEntries(
  Object.entries({ ...row, datasetId: data.datasetId }).map(([key, value]) => [key, value === null ? '未確認' : typeof value === 'boolean' ? String(value) : value])
))]));
const hash = text => createHash('sha256').update(text).digest('hex');
const numericId = key => BigInt(`0x${hash(key).slice(0, 15)}`).toString();
const guid = key => { const value = hash(key); return `${value.slice(0,8)}-${value.slice(8,12)}-4${value.slice(13,16)}-8${value.slice(17,20)}-${value.slice(20,32)}`; };
const entityId = table => numericId(`entity:${table}`);
const propertyId = (table, column) => numericId(`property:${table}:${column}`);
const tables = [];
const decodedParts = [{ path: '.platform', payload: { metadata: { type: 'Ontology', displayName: 'MaikuroCoffeeDevelopment' } } }, { path: 'definition.json', payload: {} }];
const workspaceId = '<workspace-id>', lakehouseId = '<lakehouse-id>';
const sourceTable = table => ({ sourceType: 'LakehouseTable', workspaceId, itemId: lakehouseId, sourceTableName: table, sourceSchema: 'dbo' });
const bindings = { ontology: 'ontology.ttl', dataRoot: 'apps/operations/ontology/data', datasetId: data.datasetId, entities: {}, relationships: {} };
const ttl = ['@prefix mc: <https://example.org/maikuro-jp-v1/> .', '@prefix owl: <http://www.w3.org/2002/07/owl#> .', '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .', '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .', 'mc: a owl:Ontology ; rdfs:label "Maikuro coffee development - synthetic" .'];
const output = new Map([['data/dataset.json', JSON.stringify(data, null, 2) + '\n']]);
output.set('data/blend-dataset.json', JSON.stringify({ asOf: blendAsOf, version: blendVersion, ...blendTables }, null, 2) + '\n');
output.set('data/scenario-defaults.json', JSON.stringify({ conceptId: specialTables.scenarios[0].conceptId, start: specialTables.scenarios[0].startDate, end: specialTables.scenarios[0].endDate, storeQuantities: Object.fromEntries(specialTables.scenarioStores.map(row => [row.storeId, row.quantity])) }, null, 2) + '\n');
for (const [table, entity] of Object.entries(entityNames)) {
  const rows = ontologyTables[table];
  const headers = Object.keys(rows[0]);
  const typeFor = column => rows.every(row => Number.isSafeInteger(row[column])) ? 'BigInt' : 'String';
  bindings.entities[entity] = { table: `${table}.csv`, identifier: 'id' };
  output.set(`data/${table}.csv`, Papa.unparse(allTables[table].map(row => ({ ...row, datasetId: data.datasetId })), { newline: '\n' }) + '\n');
  output.set(`ontology/data/${table}.csv`, Papa.unparse(rows, { newline: '\n' }) + '\n');
  const columns = headers.map(column => ({ name: column, type: typeFor(column) === 'BigInt' ? 'long' : 'string', nullable: false }));
  const foreignKeys = relationSpecs.filter(([, source]) => source === table).map(([, , target, key]) => ({ columns: [key], referencedTable: target, referencedColumns: ['id'], allowNull: false }));
  tables.push({ sourceFile: `data/${table}.csv`, sourcePath: `Files/workshops/micro-coffee-demo/${hash(seedText + blendText).slice(0,16)}/${table}.csv`, targetSchema: 'dbo', targetTable: table, mode: 'overwrite', columns, primaryKey: ['id'], foreignKeys, rows: rows.length });
  decodedParts.push({ path: `EntityTypes/${entityId(table)}/definition.json`, payload: { id: entityId(table), namespace: 'usertypes', baseEntityTypeId: null, name: entity, entityIdParts: [propertyId(table,'id')], displayNamePropertyId: propertyId(table, headers.includes('name') ? 'name' : headers.includes('title') ? 'title' : 'id'), namespaceType: 'Custom', visibility: 'Visible', properties: headers.map(column => ({ id: propertyId(table,column), name: column, redefines: null, baseTypeNamespaceType: null, valueType: typeFor(column) })), timeseriesProperties: [] } });
  const bindingId = guid(`binding:${table}`);
  decodedParts.push({ path: `EntityTypes/${entityId(table)}/DataBindings/${bindingId}.json`, payload: { id: bindingId, dataBindingConfiguration: { dataBindingType: 'NonTimeSeries', propertyBindings: headers.map(column => ({ sourceColumnName: column, targetPropertyId: propertyId(table,column) })), sourceTableProperties: sourceTable(table) } } });
  ttl.push(`mc:${entity} a owl:Class ; rdfs:label "${entity}" .`);
  for (const column of headers) ttl.push(`mc:${entity}_${column} a owl:DatatypeProperty ; rdfs:domain mc:${entity} ; rdfs:range xsd:${typeFor(column) === 'BigInt' ? 'integer' : 'string'} .`);
}
for (const [name, source, target, key] of relationSpecs) {
  bindings.relationships[name] = { from: entityNames[source], to: entityNames[target], table: `${source}.csv`, toKey: key };
  const relationshipId = numericId(`relation:${name}`), contextId = guid(`context:${name}`);
  decodedParts.push({ path: `RelationshipTypes/${relationshipId}/definition.json`, payload: { namespace: 'usertypes', id: relationshipId, name, namespaceType: 'Custom', source: { entityTypeId: entityId(source) }, target: { entityTypeId: entityId(target) } } });
  decodedParts.push({ path: `RelationshipTypes/${relationshipId}/Contextualizations/${contextId}.json`, payload: { id: contextId, dataBindingTable: sourceTable(source), sourceKeyRefBindings: [{ sourceColumnName: 'id', targetPropertyId: propertyId(source,'id') }], targetKeyRefBindings: [{ sourceColumnName: key, targetPropertyId: propertyId(target,'id') }] } });
  ttl.push(`mc:${name} a owl:ObjectProperty ; rdfs:domain mc:${entityNames[source]} ; rdfs:range mc:${entityNames[target]} .`);
}
output.set('ontology/ontology.ttl', ttl.join('\n') + '\n');
output.set('ontology/bindings.json', JSON.stringify(bindings, null, 2) + '\n');
const generatorText = await readFile(new URL(import.meta.url), 'utf8');
const contentId = `sha256:${hash(seedText + blendText + generatorText)}`;
const artifact = {
  schemaVersion: '1.0', workshop: { id: 'micro-coffee-demo', path: 'apps/operations/ontology', contentId },
  target: { mode: 'plan', workspaceId, lakehouseId: null, ontologyId: null },
  lakehouse: { displayName: 'MaikuroCoffeeLakehouse', uploadRoot: `Files/workshops/micro-coffee-demo/${hash(seedText + blendText).slice(0,16)}`, tables },
  ontology: { displayName: 'MaikuroCoffeeDevelopment', description: 'Synthetic Japanese coffee product development', decodedParts, definition: { parts: decodedParts.map(part => ({ path: part.path, payload: Buffer.from(JSON.stringify(part.payload)).toString('base64'), payloadType: 'InlineBase64' })) } },
  changes: { create: Object.keys(bindings.entities).concat(Object.keys(bindings.relationships)), update: [], delete: [], typeChange: [] },
  assumptions: ['合成データ専用の独立 Lakehouse。候補と現行 SKU は別エンティティ。', 'raw CSV は null を保持。ontology/data は null を未確認、Boolean を文字列へ投影。価格・杯数の既知整数は BigInt。', '飲料の依存図は PRD-001/002 の配合のみ収録。豆は BEAN-001/002 の合成引当のみ。他商品に影響がないという意味ではない。', 'ブレンド比率は焙煎後質量比。中央在庫は豆単位に一度だけ集計。輸入元は選択した補充条件の依存先で、在庫ロットの追跡ではない。'],
  warnings: ['未配置。全行検証、型照合、Graph 構築・照会確認は未実施。', '実行時の独自供給能力・安全性の保証には使用しない。'],
  exclusions: ['EC 画面・顧客認証・注文更新 API', '承認・通知・メール送信', '実テナントの機密文書、IQ 取得履歴'],
  unresolved: ['Fabric Workspace ID', 'Lakehouse Item ID', '配置承認', '全行検証と実 Delta 型の照合', 'Ontology Item ID と GraphModel Item ID は作成後に記録'],
  sourceEvidence: [{ decision: '再生成の入力と識別子', sources: [{ path: '../data/seed.json', pointer: '/' }, { path: '../data/blend-seed.json', pointer: '/' }, { path: '../scripts/export-data.mjs', pointer: 'entityNames / relationSpecs' }], hashing: 'SHA-256 of UTF-8 seed.json, blend-seed.json, then export-data.mjs; identifiers derive from logical names, not row values.' }]
};
output.set('ontology/fabric.plan.json', JSON.stringify(artifact, null, 2) + '\n');
output.set('data/manifest.json', JSON.stringify({ datasetId: data.datasetId, version: data.version, asOf: data.asOf, contentId, tables: tables.map(table => ({ name: table.targetTable, rows: table.rows, columns: table.columns, primaryKey: table.primaryKey, foreignKeys: table.foreignKeys })), validationStatus: 'not-run', generatedFilesOnly: true }, null, 2) + '\n');
const event = { datasetId: data.datasetId, eventId: 'EVT-REVIEW-0708', businessAt: '2026-07-08T12:00:00+09:00', review: { id: 'REV-DEMO-0708', lineId: 'LINE-DEMO-0702', customerId: 'CUS-DEMO', revision: 1, rating: 4, text: '香りを残して甘さ控えめの商品も選べるとうれしいです。', publishedAt: '2026-07-08T12:00:00+09:00', analyzedAt: '2026-07-08T12:05:00+09:00', status: 'published' }, topics: [{ id: 'TOP-DEMO-0708', reviewId: 'REV-DEMO-0708', revision: 1, topic: '甘さ控えめ', classifierVersion: 'synthetic-author-v1' }] };
output.set('data/events/review-published.json', JSON.stringify(event, null, 2) + '\n');
for (const [path, text] of output) {
  const url = new URL(path, root);
  await mkdir(new URL('./', url), { recursive: true });
  await writeFile(url, text, 'utf8');
}
console.log(`Generated ${output.size} local files; ${tables.length} tables, ${relationSpecs.length} relationships. No remote calls or validation performed.`);