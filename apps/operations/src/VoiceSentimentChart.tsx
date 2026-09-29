import { MessageSquareText, Store } from 'lucide-react';
import type { Dataset } from './domain';
import type { CustomerVoice } from './voice';
import { groupVoiceSentiments, sentimentLabels, sentimentOrder, voiceSentiment } from './sentiment';
import type { Sentiment, SentimentDimension, VoiceSentimentAnnotation } from './sentiment';
import { useWorkspace } from './workspace-context';

export interface SentimentSelection { dimension: SentimentDimension; groupId: string; sentiment: Sentiment | 'all' }

export function matchesSentimentSelection(voice: CustomerVoice, selection: SentimentSelection, voiceSentiments: VoiceSentimentAnnotation[]): boolean {
  const inGroup = selection.dimension === 'store' ? (voice.storeId ?? 'unknown-store') === selection.groupId
    : selection.groupId === '話題未分類' ? !voice.topics.length : voice.topics.includes(selection.groupId);
  return inGroup && (selection.sentiment === 'all' || voiceSentiment(voice, voiceSentiments, selection.dimension === 'topic' ? selection.groupId : undefined) === selection.sentiment);
}

interface VoiceSentimentChartProps {
  voices: CustomerVoice[];
  stores: Dataset['stores'];
  dimension: SentimentDimension;
  setDimension: (dimension: SentimentDimension) => void;
  selection: SentimentSelection | null;
  onSelect: (selection: SentimentSelection) => void;
}

export function VoiceSentimentChart({ voices, stores, dimension, setDimension, selection, onSelect }: VoiceSentimentChartProps) {
  const voiceSentiments = useWorkspace().data.sentiments.entries;
  const groups = groupVoiceSentiments(voices, stores, dimension, voiceSentiments);
  const negative = voices.filter(voice => voiceSentiment(voice, voiceSentiments) === 'negative').length;
  const unknown = voices.filter(voice => voiceSentiment(voice, voiceSentiments) === 'unknown').length;
  const highest = groups.find(group => group.negativeRate !== null);
  return <section className="voice-sentiment" aria-label="声の感情分析">
    <div className="section-heading"><h2>声の傾向</h2><span className="badge">合成分類</span></div>
    <div className="sentiment-toolbar"><div className="rating-source" role="group" aria-label="感情グラフの集計軸">
      <button aria-pressed={dimension === 'store'} onClick={() => setDimension('store')}><Store size={14}/>店舗別</button>
      <button aria-pressed={dimension === 'topic'} onClick={() => setDimension('topic')}><MessageSquareText size={14}/>話題別</button>
    </div><span>{voices.length} 件の声</span></div>
    <div className="sentiment-column-head"><span>{dimension === 'store' ? '店舗' : '話題'}</span><span>肯定・中立・否定</span><span title="否定件数 / 分類済み件数">否定率</span><span>件数</span></div>
    <div className="sentiment-rows">{groups.map(group => <div className="sentiment-row" key={group.id} data-group={group.id}>
      <button className="sentiment-name" disabled={!group.voices.length} onClick={() => onSelect({ dimension, groupId: group.id, sentiment: 'all' })} aria-label={`${group.name}の原文 ${group.voices.length} 件`} aria-pressed={selection?.groupId === group.id && selection.sentiment === 'all'}>{group.name}</button>
      <div className="sentiment-track" role="group" aria-label={`${group.name}の感情内訳`}>{sentimentOrder.map(sentiment => {
        const count = group.counts[sentiment];
        if (!count) return null;
        const percentage = count / group.voices.length * 100;
        return <button key={sentiment} className={`sentiment-segment sentiment-${sentiment}`} style={{ width: `${percentage}%` }} data-sentiment={sentiment} data-count={count}
          title={`${group.name} / ${sentimentLabels[sentiment]} ${count} 件 (${percentage.toFixed(1)}%)`}
          aria-label={`${group.name}、${sentimentLabels[sentiment]} ${count} 件`} aria-pressed={selection?.groupId === group.id && selection.sentiment === sentiment}
          onClick={() => onSelect({ dimension, groupId: group.id, sentiment })}>{percentage >= 18 ? count : null}</button>;
      })}{!group.voices.length && <span className="sentiment-no-data">対象なし</span>}</div>
      <strong className={group.counts.negative ? 'fail-text' : ''}>{group.negativeRate === null ? '-' : `${(group.negativeRate * 100).toFixed(1)}%`}</strong><span>{group.voices.length}</span>
    </div>)}</div>
    {!voices.length && <p className="empty">この条件に該当する声はありません。</p>}
    <div className="sentiment-legend">{sentimentOrder.map(sentiment => <span key={sentiment}><i className={`sentiment-${sentiment}`}/>{sentimentLabels[sentiment]}</span>)}</div>
    <div className="sentiment-summary"><div><span>最大の否定率</span><strong>{highest ? `${((highest.negativeRate ?? 0) * 100).toFixed(1)}%` : '-'}</strong><small>{highest?.name ?? '分類なし'}</small></div><div><span>否定的な声（全体）</span><strong>{negative}<small> / {voices.length} 件</small></strong></div><div><span>未分類（全体）</span><strong>{unknown}<small> 件</small></strong></div></div>
    <p className="scope-note">否定率は分類済みの声が分母です。{dimension === 'topic' ? '話題は重複を含み、各話題の側面を分類します。' : '店舗別は原文全体の分類です。'}星評価とは別の集計です。</p>
  </section>;
}