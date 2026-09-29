import schemas from '../../../scenarios/micro-coffee/table-schemas.json';

const environment = import.meta.env;
export const liveConfigured = Boolean(environment.VITE_RAYFIN_API_URL && environment.VITE_RAYFIN_PUBLISHABLE_KEY
  && environment.VITE_FABRIC_WORKSPACE_ID && environment.VITE_FABRIC_ITEM_ID && environment.VITE_SEMANTIC_MODEL_ID);
export const analyticsConfig = {
  timestampOffset: environment.VITE_ANALYTICS_TIMESTAMP_OFFSET || '+00:00',
  tables: [
    ...schemas.tables.map(({ name, source, table, fields }) => ({ name, source, table, fields })),
    { name: 'gold_shipment_risk', source: 'predictions', table: 'shipmentRisk', fields: [
      'shipmentId', 'supplierId', 'storeId', 'isValidation', 'delayProbability', 'predictedDelayHours',
      'shortageProbability', 'jointShortageProbability', 'expectedLossExTax', 'expectedImpactedLines',
      'actualDelayed', 'actualShortage', 'actualAmountExTax', 'modelVersion',
    ] },
    { name: 'gold_demand_forecast', source: 'predictions', table: 'demandForecast', fields: [
      'date', 'storeId', 'productId', 'category', 'yhat', 'yhatLower', 'yhatUpper', 'horizonDay', 'modelVersion',
    ] },
    { name: 'gold_bean_depletion', source: 'predictions', table: 'beanDepletion', fields: [
      'materialId', 'closingGrams', 'reservedGrams', 'availableGrams', 'meanDailyGrams', 'coverDays',
      'depletionDate', 'depletionDayIndex', 'withinHorizon', 'horizonDays', 'modelVersion',
    ] },
  ],
  graphs: { development: environment.VITE_DEVELOPMENT_GRAPH_ID || '', supply: environment.VITE_SUPPLY_GRAPH_ID || '' },
};
export const graphAuthConfig = {
  tenantId: environment.VITE_ENTRA_TENANT_ID || '',
  clientId: environment.VITE_ENTRA_CLIENT_ID || '',
  scopes: ['https://api.fabric.microsoft.com/Item.Read.All'],
};
export const rtiConnection = {
  queryServiceUri: environment.VITE_RTI_QUERY_URI || '',
  databaseName: environment.VITE_RTI_DATABASE || '',
  windowFunction: 'SocialVoiceWindow', latestFunction: 'SocialVoiceLatest',
  ingestion: { tableName: 'SocialVoiceIngress', mappingRuleName: 'social_voice_json_v1' },
  data: { origin: 'synthetic', requiredSchemaVersion: '1.0', classifierVersion: 'synthetic-rule-v1' },
  alert: { windowMinutes: 5, evaluationIntervalSeconds: 30, minimumSocialCount: 10, negativeRateThreshold: 0.4,
    consecutiveOccurrences: 2, recoveryRateThreshold: 0.25, heartbeatSeconds: 120 },
  query: { rowLimit: 100, pollIntervalMs: 5000 },
};