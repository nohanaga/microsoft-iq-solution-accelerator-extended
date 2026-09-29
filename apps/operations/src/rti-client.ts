import { z } from 'zod';
import { rtiConnection as liveConfig } from './connection-config';
import { getAccessTokenForScopes, signInForScopes } from './fabric-graph-auth';
import type { SocialVoiceEvent } from './social-voice-demo';

const resourceLabel = 'Eventhouse';
const serviceUri = liveConfig.queryServiceUri.replace(/\/$/, '');
const clusterOrigin = serviceUri ? new URL(serviceUri).origin : '';
// Kusto grants delegated access through user_impersonation; .default only works when the scope is pre-consented.
const scopeCandidates = [[`${clusterOrigin}/user_impersonation`], [`${clusterOrigin}/.default`]];

export const rtiConfig = liveConfig;

export interface SocialVoiceWindow {
  productId: string;
  windowStart: number;
  windowEnd: number;
  totalSocialCount: number;
  negativeCount: number;
  negativeRate: number;
}

export interface SocialVoicePost {
  eventId: string;
  productId: string;
  storeId: string | null;
  scenarioId: string;
  authorAlias: string;
  text: string;
  sentiment: string;
  publishedAt: number;
  ingestedAt: number;
}

const responseSchema = z.object({
  Tables: z.array(z.object({
    Columns: z.array(z.object({ ColumnName: z.string() })),
    Rows: z.array(z.array(z.unknown())),
  })).min(1),
});
const productIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const kustoIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export class EventhouseSignInRequiredError extends Error {
  constructor() {
    super('Eventhouse にサインインしてください。');
    this.name = 'EventhouseSignInRequiredError';
  }
}

export async function signInToEventhouse(): Promise<void> {
  if (!serviceUri || !liveConfig.databaseName) throw new Error('Eventhouse の接続設定がありません。');
  let failure: unknown;
  for (const scopes of scopeCandidates) {
    try { await signInForScopes(scopes, resourceLabel); return; }
    catch (reason) { failure = reason; }
  }
  throw failure instanceof Error ? failure : new Error('Eventhouse の認証に失敗しました。');
}

async function eventhouseToken() {
  if (!serviceUri || !liveConfig.databaseName) throw new Error('Eventhouse の接続設定がありません。');
  for (const scopes of scopeCandidates) {
    try { return await getAccessTokenForScopes(scopes, resourceLabel); }
    catch { continue; }
  }
  throw new EventhouseSignInRequiredError();
}

function rows(body: unknown) {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Eventhouse から不正な応答を受信しました。');
  const table = parsed.data.Tables[0];
  const names = table.Columns.map(column => column.ColumnName);
  return table.Rows.map(row => Object.fromEntries(names.map((name, index) => [name, row[index]])));
}

async function queryEventhouse(csl: string, signal: AbortSignal) {
  return rows(await callEventhouse('query', csl, signal, { 'x-ms-readonly': 'true' }));
}

async function callEventhouse(route: 'query' | 'mgmt', csl: string, signal: AbortSignal, extraHeaders: Record<string, string> = {}) {
  const accessToken = await eventhouseToken();
  signal.throwIfAborted();
  const response = await fetch(`${serviceUri}/v1/rest/${route}`, {
    method: 'POST', signal,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'x-ms-app': 'MaikuroSocialVoice',
      ...extraHeaders,
    },
    body: JSON.stringify({ db: liveConfig.databaseName, csl }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).safeParse(body);
    const detail = error.success ? `${error.data.error.code}: ${error.data.error.message}` : response.statusText;
    throw new Error(`Eventhouse の HTTP ${response.status}: ${detail}`);
  }
  return body;
}

function timestamp(value: unknown) {
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error('Eventhouse から不正な日時を受信しました。');
  return parsed;
}

function assertProductId(productId: string) {
  if (!productIdPattern.test(productId)) throw new Error('商品 ID に使用できない文字が含まれています。');
}

export async function readSocialVoiceWindows(productId: string, lookbackMinutes: number, signal: AbortSignal): Promise<SocialVoiceWindow[]> {
  assertProductId(productId);
  if (!Number.isInteger(lookbackMinutes) || lookbackMinutes < 0) throw new Error('取得範囲が不正です。');
  const recent = lookbackMinutes ? `\n| where windowStart > ago(${lookbackMinutes}m)` : '';
  const csl = `${liveConfig.windowFunction}()\n| where productId == '${productId}'${recent}\n| order by windowStart asc\n| take ${liveConfig.query.rowLimit}`;
  return (await queryEventhouse(csl, signal)).map(row => ({
    productId: String(row.productId),
    windowStart: timestamp(row.windowStart),
    windowEnd: timestamp(row.windowEnd),
    totalSocialCount: Number(row.totalSocialCount),
    negativeCount: Number(row.negativeCount),
    negativeRate: Number(row.negativeRate),
  }));
}

export async function readSocialVoicePosts(productId: string, lookbackMinutes: number, signal: AbortSignal): Promise<SocialVoicePost[]> {
  assertProductId(productId);
  if (!Number.isInteger(lookbackMinutes) || lookbackMinutes < 0) throw new Error('取得範囲が不正です。');
  const recent = lookbackMinutes ? `\n| where publishedAt > ago(${lookbackMinutes}m)` : '';
  const csl = `${liveConfig.latestFunction}()\n| where source == 'social' and productId == '${productId}'${recent}\n| order by publishedAt desc\n| take ${liveConfig.query.rowLimit}\n| project eventId, productId, storeId, scenarioId, authorAlias, text, sentiment, publishedAt, ingestedAt`;
  return (await queryEventhouse(csl, signal)).map(row => ({
    eventId: String(row.eventId),
    productId: String(row.productId),
    storeId: row.storeId === null || row.storeId === '' ? null : String(row.storeId),
    scenarioId: String(row.scenarioId),
    authorAlias: String(row.authorAlias),
    text: String(row.text),
    sentiment: String(row.sentiment),
    publishedAt: timestamp(row.publishedAt),
    ingestedAt: timestamp(row.ingestedAt),
  }));
}

// Eventstream は AMQP なのでブラウザーからは叩けない。取り込み先テーブルと配備済みの
// JSON マッピングは同じまま、Kusto の inline ingestion で同じ行を書き込む。
export async function ingestSocialVoiceEvents(events: SocialVoiceEvent[], signal: AbortSignal): Promise<number> {
  if (!events.length) return 0;
  const { tableName, mappingRuleName } = liveConfig.ingestion;
  if (!kustoIdentifierPattern.test(tableName) || !kustoIdentifierPattern.test(mappingRuleName)) {
    throw new Error('取り込み先テーブルの設定が不正です。');
  }
  for (const event of events) assertProductId(event.productId);
  const payload = events.map(event => JSON.stringify(event)).join('\n');
  const csl = `.ingest inline into table ${tableName} with (format="json", ingestionMappingReference="${mappingRuleName}") <|\n${payload}`;
  await callEventhouse('mgmt', csl, signal);
  return events.length;
}
