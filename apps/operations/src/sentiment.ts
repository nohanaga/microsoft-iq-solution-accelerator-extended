import type { Dataset } from './domain';
import type { CustomerVoice } from './voice';
import fixture from '../v3/data/voice-sentiments.json';

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'unknown';
export type SentimentDimension = 'store' | 'topic';
export const sentimentLabels: Record<Sentiment, string> = { positive: '肯定', neutral: '中立', negative: '否定', unknown: '未分類' };
export const sentimentOrder: Sentiment[] = ['positive', 'neutral', 'negative', 'unknown'];
export interface VoiceSentimentAnnotation {
  voiceId: string;
  text: string;
  overall: Exclude<Sentiment, 'unknown'>;
  topics: Record<string, Exclude<Sentiment, 'unknown'>>;
}
export const voiceSentiments = fixture.entries as unknown as VoiceSentimentAnnotation[];
export interface SentimentGroup {
  id: string;
  name: string;
  voices: CustomerVoice[];
  counts: Record<Sentiment, number>;
  classified: number;
  negativeRate: number | null;
}

export function voiceSentiment(voice: CustomerVoice, annotations: VoiceSentimentAnnotation[], topic?: string): Sentiment {
  const annotation = annotations.find(row => row.voiceId === voice.id && row.text === voice.text);
  return (topic ? annotation && Object.hasOwn(annotation.topics, topic) ? annotation.topics[topic] : undefined : annotation?.overall) ?? 'unknown';
}

export function groupVoiceSentiments(voices: CustomerVoice[], stores: Dataset['stores'], dimension: SentimentDimension, annotations: VoiceSentimentAnnotation[]): SentimentGroup[] {
  const categories = dimension === 'store'
    ? [...stores.map(store => ({ id: store.id, name: store.name })), ...(voices.some(voice => voice.storeId === null) ? [{ id: 'unknown-store', name: '店舗不明' }] : [])]
    : [...new Set(voices.flatMap(voice => voice.topics.length ? voice.topics : ['話題未分類']))].map(topic => ({ id: topic, name: topic }));
  return categories.map(category => {
    const members = voices.filter(voice => dimension === 'store'
      ? (voice.storeId ?? 'unknown-store') === category.id
      : category.id === '話題未分類' ? !voice.topics.length : voice.topics.includes(category.id));
    const counts: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0, unknown: 0 };
    for (const voice of members) counts[voiceSentiment(voice, annotations, dimension === 'topic' ? category.id : undefined)]++;
    const classified = members.length - counts.unknown;
    return { ...category, voices: members, counts, classified, negativeRate: classified ? counts.negative / classified : null };
  }).sort((left, right) => (right.negativeRate ?? -1) - (left.negativeRate ?? -1) || right.voices.length - left.voices.length || left.name.localeCompare(right.name, 'ja'));
}