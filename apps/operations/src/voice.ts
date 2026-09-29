import { jstEnd, jstStart, selectReviews } from './analytics';
import type { Dataset, ReviewFilter } from './domain';

export type VoiceSource = 'review' | 'survey' | 'social' | 'chat';
export type VoiceSourceFilter = VoiceSource | 'all';
export const voiceSourceLabels: Record<VoiceSourceFilter, string> = { all: 'すべて', review: 'レビュー', survey: 'アンケート', social: 'SNS 口コミ', chat: 'EC チャット' };
export interface ExternalVoice {
  id: string; source: 'survey' | 'social'; revision: number;
  productId: string; storeId: string | null; rating: number | null;
  text: string; topics: string[]; publishedAt: string; analyzedAt: string | null;
  status: 'published' | 'pending' | 'withdrawn';
}
export interface VoiceSources {
  datasetId: string; version: string; asOf: string; dataOrigin: 'synthetic'; entries: ExternalVoice[];
}
export interface EcChatMessage {
  id: string; role: 'customer' | 'assistant'; text: string; sentAt: string;
  productId: string | null; topics: string[];
}
export interface EcChatConversation {
  id: string; storeId: string | null; channel: 'text' | 'voice';
  status: 'included' | 'withdrawn'; analyzedAt: string | null; messages: EcChatMessage[];
}
export interface EcChatHistory {
  datasetId: string; version: string; asOf: string; dataOrigin: 'synthetic'; conversations: EcChatConversation[];
}
export interface CustomerVoice {
  id: string; recordId: string; source: VoiceSource; productId: string; storeId: string | null;
  rating: number | null; text: string; topics: string[]; publishedAt: string;
  conversation?: EcChatConversation;
}
export interface VoiceWord { text: string; count: number }
export interface VoiceTimelinePoint { timestamp: number; count: number }
export interface StoreRating {
  storeId: string; name: string; count: number; total: number;
  average: number | null; rank: number | null;
}

export function selectVoices(data: Dataset, external: VoiceSources, filter: ReviewFilter, source: VoiceSourceFilter = 'all', chats?: EcChatHistory): CustomerVoice[] {
  if (external.datasetId !== data.datasetId || external.dataOrigin !== 'synthetic') throw new Error('顧客の声のデータセットが一致しません。');
  const from = Date.parse(jstStart(filter.from));
  const to = Date.parse(jstEnd(filter.to));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return [];
  const voices: CustomerVoice[] = selectReviews(data, filter).map(review => ({
    id: `review:${review.id}`, recordId: review.id, source: 'review', productId: review.productId,
    storeId: review.storeId, rating: validRating(review.rating), text: review.text, topics: review.topics, publishedAt: review.publishedAt
  }));
  const asOf = Math.min(Date.parse(data.asOf), Date.parse(external.asOf));
  const latest = new Map<string, ExternalVoice>();
  for (const entry of external.entries) {
    if (!Number.isFinite(Date.parse(entry.publishedAt)) || Date.parse(entry.publishedAt) > asOf) continue;
    const key = `${entry.source}:${entry.id}`;
    const previous = latest.get(key);
    if (!previous || entry.revision > previous.revision) latest.set(key, entry);
  }
  const allStoresSelected = data.stores.every(store => filter.storeIds.includes(store.id));
  for (const entry of latest.values()) {
    if (entry.status !== 'published' || entry.analyzedAt === null || !(Date.parse(entry.analyzedAt) <= asOf)
      || entry.productId !== filter.productId || (entry.storeId === null ? !allStoresSelected : !filter.storeIds.includes(entry.storeId))
      || Date.parse(entry.publishedAt) < from || Date.parse(entry.publishedAt) > to) continue;
    voices.push({ id: `${entry.source}:${entry.id}`, recordId: entry.id, source: entry.source, productId: entry.productId,
      storeId: entry.storeId, rating: entry.source === 'social' ? null : validRating(entry.rating), text: entry.text,
      topics: [...new Set(entry.topics)], publishedAt: entry.publishedAt });
  }
  if (chats) {
    if (chats.datasetId !== data.datasetId || chats.dataOrigin !== 'synthetic') throw new Error('EC チャットのデータセットが一致しません。');
    const chatAsOf = Math.min(Date.parse(data.asOf), Date.parse(chats.asOf));
    const seen = new Set<string>();
    for (const conversation of chats.conversations) {
      if (conversation.status !== 'included' || conversation.analyzedAt === null || !(Date.parse(conversation.analyzedAt) <= chatAsOf)
        || (conversation.storeId === null ? !allStoresSelected : !filter.storeIds.includes(conversation.storeId))) continue;
      const context = { ...conversation, messages: conversation.messages.filter(message => Date.parse(message.sentAt) <= chatAsOf) };
      for (const message of context.messages) {
        const id = `chat:${conversation.id}:${message.id}`;
        if (seen.has(id) || message.role !== 'customer' || !message.text.trim() || message.productId !== filter.productId
          || Date.parse(message.sentAt) < from || Date.parse(message.sentAt) > to) continue;
        seen.add(id);
        voices.push({ id, recordId: message.id, source: 'chat', productId: message.productId, storeId: conversation.storeId,
          rating: null, text: message.text, topics: [...new Set(message.topics)], publishedAt: message.sentAt, conversation: context });
      }
    }
  }
  return voices.filter(voice => source === 'all' || voice.source === source)
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || left.id.localeCompare(right.id));
}

function validRating(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
const stopWords = new Set('です ます でした ました ません だっ だった ある あり あります いる いま います する して しまう しまい し した ので から まで だけ こと もの これ それ ここ この その どの よう ほう ため もう また もっと とても かなり ちょっと 少し 思い 思う 感じ でき できる 欲しい ほしい 嬉しい うれしい 今日 今回 自分 私 店 店舗 商品 注文 購入 飲ん 飲み 飲む 買っ 買い 選べる 選び 選ぶ ほか なく ない なり なっ なる なかった ください つい について ほとんど のでした'.split(' '));
const phrases = ['甘さ控えめ', '甘さひかえめ', '待ち時間', '水出し', '後味', '飲みやすい', '香り', '口当たり', '甘さ', '酸味', '苦味', 'ミルク', 'クリーム', 'シロップ', 'バニラ', '接客', '価格', '予約', '受取', '受け取り', '持ち帰り', '氷', '量', '泡'];
const wordAliases = new Map([['甘さひかえめ', '甘さ控えめ'], ['受け取り', '受取'], ['コーヒー', '珈琲']]);
const canonicalWord = (word: string) => wordAliases.get(word) ?? word;

export function wordsInVoice(text: string): Set<string> {
  let remaining = text.normalize('NFKC');
  const words = new Set<string>();
  for (const phrase of phrases) {
    if (remaining.includes(phrase)) { words.add(canonicalWord(phrase)); remaining = remaining.replaceAll(phrase, ' '); }
  }
  for (const part of segmenter.segment(remaining)) {
    const word = canonicalWord(part.segment);
    if (part.isWordLike && word.length >= 2 && word.length <= 14 && !stopWords.has(word)
      && !/^[\p{Number}\p{Script=Hiragana}]+$/u.test(word) && !/^https?|www$/i.test(word)) words.add(word);
  }
  return words;
}

export function countVoiceWords(voices: CustomerVoice[]): VoiceWord[] {
  const counts = new Map<string, number>();
  for (const voice of voices) for (const word of wordsInVoice(voice.text)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts].map(([text, count]) => ({ text, count }))
    .sort((left, right) => right.count - left.count || left.text.localeCompare(right.text, 'ja')).slice(0, 28);
}

export function countVoiceTimeline(voices: CustomerVoice[]): VoiceTimelinePoint[] {
  const dayMilliseconds = 86_400_000;
  const jstOffset = 9 * 60 * 60 * 1000;
  const counts = new Map<number, number>();
  for (const voice of voices) {
    const publishedAt = Date.parse(voice.publishedAt);
    if (!Number.isFinite(publishedAt)) continue;
    const timestamp = Math.floor((publishedAt + jstOffset) / dayMilliseconds) * dayMilliseconds - jstOffset;
    counts.set(timestamp, (counts.get(timestamp) ?? 0) + 1);
  }
  return [...counts].map(([timestamp, count]) => ({ timestamp, count }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function rankVoiceStores(voices: CustomerVoice[], stores: Dataset['stores'], source: VoiceSource, minimumCount = 1): StoreRating[] {
  const rows: StoreRating[] = stores.map(store => {
    const ratings = voices.filter(voice => voice.source === source && voice.storeId === store.id && voice.rating !== null).map(voice => voice.rating!);
    const total = ratings.reduce((sum, rating) => sum + rating, 0);
    return { storeId: store.id, name: store.name, count: ratings.length, total, average: ratings.length >= minimumCount ? total / ratings.length : null, rank: null };
  });
  rows.sort((left, right) => (right.average ?? -1) - (left.average ?? -1) || right.count - left.count || left.storeId.localeCompare(right.storeId));
  for (const [index, row] of rows.entries()) {
    if (row.average === null) continue;
    const previous = rows[index - 1];
    row.rank = previous && previous.average !== null && row.total * previous.count === previous.total * row.count ? previous.rank : index + 1;
  }
  return rows;
}