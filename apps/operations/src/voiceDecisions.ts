import type { CustomerVoice } from './voice';
import { voiceSentiment, voiceSentiments } from './sentiment';
import type { VoiceSentimentAnnotation } from './sentiment';

export interface ProductProposal {
  id: string;
  topic: string;
  title: string;
  hypothesis: string;
  checks: string[];
  evidence: CustomerVoice[];
  counterEvidence: CustomerVoice[];
  total: number;
}

const proposalRules = [
  { id: 'less-sweet', topic: '甘さ控えめ', title: '甘さ控えめの別商品を試す', hypothesis: '香りとクリームを残した甘さ控えめ版を、現行品と併売する案です。', checks: ['現行品との官能比較', '原料・原価・供給資格', '希望者への購入意向の確認'] },
  { id: 'small-size', topic: 'サイズ', title: '小容量サイズを試す', hypothesis: '飲みきれる量の選択肢として、小容量の商品を試験提供する案です。', checks: ['希望容量の聞き取り', '包材と一杯当たり原価', '既存サイズからの置換影響'] },
  { id: 'less-ice', topic: '氷の量', title: '氷量を選べる提供方法を試す', hypothesis: '持ち帰り時の薄まり方を確認し、氷少なめを選べる提供方法を検討する案です。', checks: ['温度・衛生・味の時間変化', '提供量と価格表示', '店舗作業と待ち時間'] }
];

export function proposeProducts(voices: CustomerVoice[], annotations: VoiceSentimentAnnotation[] = voiceSentiments): ProductProposal[] {
  return proposalRules.map(rule => {
    const evidence = voices.filter(voice => voice.topics.includes(rule.topic)
      && ['negative', 'neutral'].includes(voiceSentiment(voice, annotations, rule.topic)));
    const counterEvidence = voices.filter(voice => rule.id === 'less-sweet'
      ? voice.topics.includes('現行支持')
      : voice.topics.includes(rule.topic) && voiceSentiment(voice, annotations, rule.topic) === 'positive');
    return { ...rule, evidence, counterEvidence, total: voices.length };
  }).filter(proposal => proposal.evidence.length >= 3)
    .sort((left, right) => right.evidence.length - left.evidence.length || left.id.localeCompare(right.id));
}

export interface SpikeSettings {
  windowHours: number;
  minPosts: number;
  minNegative: number;
  negativePercent: number;
  growth: number;
}
export const defaultSpikeSettings: SpikeSettings = { windowHours: 24, minPosts: 10, minNegative: 5, negativePercent: 50, growth: 2 };
export interface SpikeWindow {
  total: number;
  negative: number;
  classified: number;
  negativeRate: number | null;
  coverage: number | null;
}
export interface SpikeEvaluation {
  status: 'invalid' | 'insufficient' | 'normal' | 'candidate';
  reason: string;
  start: number;
  end: number;
  previousStart: number;
  current: SpikeWindow;
  previous: SpikeWindow;
  growth: number | null;
  evidence: CustomerVoice[];
}

export function evaluateVoiceSpike(voices: CustomerVoice[], end: number, availableFrom: number, settings: SpikeSettings, annotations: VoiceSentimentAnnotation[] = voiceSentiments): SpikeEvaluation {
  const duration = settings.windowHours * 3_600_000;
  const start = end - duration;
  const previousStart = start - duration;
  const unique = [...new Map(voices.filter(voice => voice.source === 'social').map(voice => [voice.id, voice])).values()];
  const currentVoices = unique.filter(voice => Date.parse(voice.publishedAt) > start && Date.parse(voice.publishedAt) <= end);
  const previousVoices = unique.filter(voice => Date.parse(voice.publishedAt) > previousStart && Date.parse(voice.publishedAt) <= start);
  const summarize = (rows: CustomerVoice[]): SpikeWindow => {
    const classified = rows.filter(voice => voiceSentiment(voice, annotations) !== 'unknown').length;
    const negative = rows.filter(voice => voiceSentiment(voice, annotations) === 'negative').length;
    return { total: rows.length, classified, negative, negativeRate: classified ? negative / classified : null, coverage: rows.length ? classified / rows.length : null };
  };
  const current = summarize(currentVoices);
  const previous = summarize(previousVoices);
  const growth = previous.total ? current.total / previous.total : null;
  const result = { start, end, previousStart, current, previous, growth, evidence: currentVoices.filter(voice => voiceSentiment(voice, annotations) === 'negative') };
  if (![end, availableFrom, ...Object.values(settings)].every(Number.isFinite)
    || ![24, 72, 168].includes(settings.windowHours) || settings.minPosts < 1 || !Number.isInteger(settings.minPosts)
    || settings.minNegative < 1 || !Number.isInteger(settings.minNegative) || settings.negativePercent < 1 || settings.negativePercent > 100 || settings.growth <= 1) {
    return { ...result, status: 'invalid', reason: '有効な集計期間と検知条件を指定してください。' };
  }
  if (availableFrom > previousStart || !current.total || !previous.total || (current.coverage ?? 0) < 0.8 || (previous.coverage ?? 0) < 0.8) {
    return { ...result, status: 'insufficient', reason: '前後 2 期間の SNS 投稿と、各期間 80% 以上の分類済みデータが必要です。' };
  }
  const candidate = current.total >= settings.minPosts && current.negative >= settings.minNegative
    && (current.negativeRate ?? 0) * 100 >= settings.negativePercent && growth !== null && growth >= settings.growth;
  return { ...result, status: candidate ? 'candidate' : 'normal', reason: candidate ? '投稿数と否定的な投稿が検知条件を満たしました。原文と拡散状況を確認してください。' : '現在の条件では急増を検知していません。' };
}