import { z } from 'zod';
import seed from '../v3/data/operations.json';
import type { Dataset, ImpactResult, ReviewFilter, Scenario } from './domain';
import { selectReviews } from './analytics';

const timestamp = z.iso.datetime({ offset: true });
const eventSchema = z.strictObject({
  datasetId: z.literal('maikuro-jp-v1'), eventId: z.string().min(1), businessAt: timestamp,
  review: z.strictObject({
    id: z.string().min(1), lineId: z.string().min(1), customerId: z.string().min(1),
    revision: z.number().int().positive(), rating: z.number().int().min(1).max(5),
    text: z.string().min(1).max(3000), publishedAt: timestamp, analyzedAt: timestamp.nullable(),
    status: z.enum(['published', 'pending', 'withdrawn'])
  }),
  topics: z.array(z.strictObject({ id: z.string().min(1), reviewId: z.string().min(1), revision: z.number().int().positive(), topic: z.string().min(1).max(40), classifierVersion: z.string().min(1) })).max(20)
});

export interface CoffeeAdapter {
  readonly kind: 'fixture';
  load(signal: AbortSignal): Promise<Dataset>;
  importReview(data: Dataset, input: unknown): { data: Dataset; message: string; receivedAt: string };
  save(data: Dataset, scenario: Scenario, impact: ImpactResult, reviewFilter: ReviewFilter): DecisionSnapshot;
}
export interface DecisionSnapshot {
  id: string; recordedAt: string; businessAsOf: string; datasetId: string; datasetVersion: string;
  dataOrigin: 'synthetic'; executionMode: 'fixture'; projectId: string;
  scenario: Scenario; impact: ImpactResult; evidence: Dataset['evidence']; history: Dataset['decisionReasons'];
  reviewFilter: ReviewFilter; reviewIds: string[]; retrievalStatus: 'not-connected'; approvalStatus: 'not-requested';
}

export function createFixtureAdapter(): CoffeeAdapter {
  const events = new Map<string, string>();
  return {
    kind: 'fixture',
    async load(signal) {
      if (signal.aborted) throw new DOMException('中断しました。', 'AbortError');
      if (new URLSearchParams(location.search).get('fail') === 'load') throw new Error('データ取得失敗（デモ用の障害設定）。');
      return structuredClone({ ...seed, materials: [], offers: [], concepts: [], recipeLines: [], currentRecipes: [], inventory: [], inbound: [], evidence: [], rules: [], decisionReasons: [] }) as Dataset;
    },
    importReview(data, input) {
      const event = eventSchema.parse(input);
      const previous = events.get(event.eventId);
      const normalized = JSON.stringify(event);
      if (previous && previous !== normalized) throw new Error('同じイベント ID に異なる内容が指定されました。');
      if (previous) return { data, message: '同じ投稿は反映済みです。', receivedAt: new Date().toISOString() };
      const review = event.review;
      const line = data.orderLines.find(row => row.id === review.lineId);
      const order = data.orders.find(row => row.id === line?.orderId);
      if (!order || order.customerId !== review.customerId || order.status !== 'completed' || order.fulfilledAt === null
        || Date.parse(order.fulfilledAt) > Date.parse(review.publishedAt)) throw new Error('本人の受取済み明細を確認できません。');
      if (Date.parse(event.businessAt) > Date.parse(data.asOf) || Date.parse(review.publishedAt) > Date.parse(event.businessAt)
        || (review.analyzedAt !== null && (Date.parse(review.analyzedAt) < Date.parse(review.publishedAt) || Date.parse(review.analyzedAt) > Date.parse(data.asOf)))) throw new Error('投稿・分析日時が基準時点と整合しません。');
      if (data.reviews.some(row => row.id === review.id || (row.lineId === review.lineId && row.revision >= review.revision))) throw new Error('レビュー ID または版が重複しています。更新は新しい ID と版が必要です。');
      if (new Set(event.topics.map(row => row.id)).size !== event.topics.length || event.topics.some(row => row.reviewId !== review.id || row.revision !== review.revision || data.reviewTopics.some(existing => existing.id === row.id))) throw new Error('分類の参照先または ID が不正です。');
      events.set(event.eventId, normalized);
      return {
        data: { ...data, reviews: [...data.reviews, review], reviewTopics: [...data.reviewTopics, ...event.topics] },
        message: review.status === 'published' && review.analyzedAt !== null ? '投稿をローカル集計へ反映しました。' : '受領済み・集計対象外です。',
        receivedAt: new Date().toISOString()
      };
    },
    save(data, scenario, impact, reviewFilter) {
      if (new URLSearchParams(location.search).get('fail') === 'save') throw new Error('保存失敗（デモ用の障害設定）。');
      const snapshot: DecisionSnapshot = {
        id: crypto.randomUUID(), recordedAt: new Date().toISOString(), businessAsOf: data.asOf,
        datasetId: data.datasetId, datasetVersion: data.version, dataOrigin: 'synthetic', executionMode: 'fixture',
        projectId: impact.concept.projectId, scenario, impact, evidence: data.evidence,
        history: data.decisionReasons, reviewFilter, reviewIds: selectReviews(data, reviewFilter).map(row => row.id), retrievalStatus: 'not-connected', approvalStatus: 'not-requested'
      };
      localStorage.setItem(`micro-coffee-demo:decision:${data.datasetId}`, JSON.stringify(snapshot));
      return snapshot;
    }
  };
}

export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}