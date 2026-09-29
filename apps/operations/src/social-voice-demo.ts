import { rtiConnection as liveConfig } from './connection-config';

// scripts/generate-social-voice.py の demo モードをブラウザーへ移植したもの。
// eventId の名前空間だけは `-ui` を付けて分けており、同じ窓へ両方から送っても
// SocialVoiceConflicts() で衝突しない。
const eventIdNamespace = 'maikuro-social-voice-ui';
const uuidNamespaceUrl = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const phaseOrder = ['normal', 'negative-spike', 'recovery'] as const;

export type SocialVoicePhase = typeof phaseOrder[number];

export interface SocialVoiceEvent {
  schemaVersion: string;
  eventId: string;
  scenarioId: SocialVoicePhase;
  source: 'social';
  productId: string;
  storeId: string | null;
  postId: string;
  authorAlias: string;
  text: string;
  topics: string[];
  sentiment: string;
  classifierVersion: string;
  publishedAt: string;
  producedAt: string;
  isSynthetic: true;
}

const phaseSentiments: Record<SocialVoicePhase, string[]> = {
  normal: [...Array<string>(6).fill('positive'), ...Array<string>(3).fill('neutral'), 'negative'],
  'negative-spike': Array<string>(10).fill('negative'),
  recovery: Array<string>(30).fill('positive'),
};

const templates: Record<string, readonly (readonly [string, readonly string[]])[]> = {
  positive: [
    ['{product} は香りが立っていて、朝の一杯にちょうどよかったです。', ['香り']],
    ['{product} のすっきりした後味が好みでした。', ['後味']],
    ['{product} は甘さと香りのバランスを楽しめました。', ['甘さ', '香り']],
  ],
  neutral: [
    ['{product} を試しました。次は抽出温度を変えてみます。', ['抽出']],
    ['{product} を今日はミルクと合わせました。', ['ミルク']],
  ],
  negative: [
    ['{product} は今日は苦味が強く、後味が重く感じました。', ['苦味', '後味']],
    ['{product} は香りが弱く、期待した印象とは違いました。', ['香り']],
    ['{product} は酸味が目立ち、飲みにくく感じました。', ['酸味']],
  ],
};

// data/reference/FNF-2026-06-01-01002-0268.csv の FullName から採用した 12 名。
const approvedNames = [
  'Arif Ramadhan', 'Jaroslav Cerny', 'Sumber Agvaan', 'Ivet Castelló',
  'Joyikutty Thankachan', 'Margrét Magnúsdóttir', 'Dwi Ananda', 'Ramin Chiya',
  'Konstantina Roussou', 'Rasika Moktan', 'Agung Raharjo', 'Lai Chou',
];

export interface SocialVoiceAct {
  phase: SocialVoicePhase;
  windowOffset: number;
  title: string;
  story: string;
  events: number;
}

export const demoActs: readonly SocialVoiceAct[] = [
  { phase: 'normal', windowOffset: 3, title: '通常運転', story: '否定 1 / 10 件で閾値を下回ります。', events: 10 },
  { phase: 'negative-spike', windowOffset: 2, title: '炎上の始まり', story: '否定 10 / 10 件で閾値を超えます。', events: 10 },
  { phase: 'negative-spike', windowOffset: 1, title: '連続 2 回目', story: 'アラートが発動します。', events: 10 },
  { phase: 'recovery', windowOffset: 0, title: '回復', story: '肯定 30 件で回復閾値を下回ります。', events: 30 },
];

export const demoSeed = 260912;
export const demoStoreId = 'STR-04';
const windowLength = liveConfig.alert.windowMinutes * 60_000;

export function demoBaseTime(now: number = Date.now()) {
  return Math.floor(now / windowLength) * windowLength;
}

export function actWindowStart(baseTime: number, actIndex: number) {
  return baseTime - demoActs[actIndex].windowOffset * windowLength;
}

function iso(epochMs: number) {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function randomizer(seedText: string) {
  let state = 2166136261 >>> 0;
  for (let index = 0; index < seedText.length; index += 1) {
    state = Math.imul(state ^ seedText.charCodeAt(index), 16777619) >>> 0;
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], next: () => number) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(next() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

async function uuid5(name: string) {
  const namespace = (uuidNamespaceUrl.replace(/-/g, '').match(/../g) ?? []).map(pair => Number.parseInt(pair, 16));
  const suffix = new TextEncoder().encode(name);
  const input = new Uint8Array(namespace.length + suffix.length);
  input.set(namespace);
  input.set(suffix, namespace.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function buildWindowEvents(seed: number, windowStart: number, productId: string, storeId: string | null) {
  const runKey = `${seed}:${iso(windowStart)}:${productId}:${storeId ?? '-'}`;
  const aliases = shuffle([...approvedNames], randomizer(`aliases:${seed}`)).map(name => `${name} (synthetic)`);
  const events: SocialVoiceEvent[] = [];
  let globalIndex = 0;
  for (const phase of phaseOrder) {
    const next = randomizer(`sentiments:${runKey}:${phase}`);
    const sentiments = shuffle([...phaseSentiments[phase]], next);
    for (let phaseIndex = 0; phaseIndex < sentiments.length; phaseIndex += 1) {
      const sentiment = sentiments[phaseIndex];
      const choices = templates[sentiment];
      const [template, topics] = choices[Math.floor(next() * choices.length)];
      const publishedAt = windowStart + globalIndex * 1000;
      const eventId = await uuid5(`${eventIdNamespace}:${runKey}:${phase}:${phaseIndex}`);
      events.push({
        schemaVersion: liveConfig.data.requiredSchemaVersion,
        eventId,
        scenarioId: phase,
        source: 'social',
        productId,
        storeId,
        postId: `SYN-${eventId.slice(0, 8).toUpperCase()}`,
        authorAlias: aliases[globalIndex % aliases.length],
        text: template.replace('{product}', productId),
        topics: [...topics],
        sentiment,
        classifierVersion: liveConfig.data.classifierVersion,
        publishedAt: iso(publishedAt),
        producedAt: iso(publishedAt + 1000),
        isSynthetic: true,
      });
      globalIndex += 1;
    }
  }
  if (events.at(-1)!.publishedAt.slice(0, 16) !== events[0].publishedAt.slice(0, 16)) {
    throw new Error('合成イベントが想定の 5 分窓からはみ出しました。');
  }
  return events;
}

export async function buildActEvents(actIndex: number, baseTime: number, productId: string, storeId: string | null, seed = demoSeed) {
  const act = demoActs[actIndex];
  if (!act) throw new Error('送信できる幕がありません。');
  const events = await buildWindowEvents(seed, actWindowStart(baseTime, actIndex), productId, storeId);
  return events.filter(event => event.scenarioId === act.phase);
}
