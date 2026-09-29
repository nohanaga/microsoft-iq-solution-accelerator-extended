import { useCallback, useState } from 'react';
import { ArrowRight, ClipboardList, Download, Layers3, MessageSquareText, MessagesSquare, ShoppingBag, Star, Truck, Upload, X } from 'lucide-react';
import type { Dataset, ReviewFilter } from './domain';
import { jstEnd, jstStart } from './analytics';
import { countVoiceWords, rankVoiceStores, selectVoices, voiceSourceLabels, wordsInVoice } from './voice';
import type { CustomerVoice, EcChatHistory, VoiceSourceFilter, VoiceSources } from './voice';
import { VoiceWordCloud } from './VoiceWordCloud';
import { VoiceTimeline } from './VoiceTimeline';
import { VoiceDecisionCards } from './VoiceDecisionCards';
import { VoiceAlertPanel } from './VoiceAlertPanel';
import { SocialVoiceLive } from './SocialVoiceLive';
import type { SocialVoiceSelection } from './SocialVoiceLive';
import { matchesSentimentSelection, VoiceSentimentChart } from './VoiceSentimentChart';
import type { SentimentSelection } from './VoiceSentimentChart';
import { sentimentLabels, voiceSentiment } from './sentiment';
import { useWorkspace } from './workspace-context';
import type { SentimentDimension, Sentiment } from './sentiment';
import sourceFixture from '../v3/data/voice-sources.json';
import chatFixture from '../v3/data/ec-chat-history.json';
import eventUrl from '../v3/data/events/review-published.json?url';

export const voiceSources = sourceFixture as VoiceSources;
export const ecChatHistory = chatFixture as EcChatHistory;
const sourceIcons = { all: Layers3, review: MessageSquareText, survey: ClipboardList, social: MessagesSquare, chat: ShoppingBag };
const dateTime = (value: string) => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
const recordTime = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const average = (rows: CustomerVoice[]) => {
  const rated = rows.filter(row => row.rating !== null);
  return { count: rated.length, value: rated.length ? rated.reduce((sum, row) => sum + row.rating!, 0) / rated.length : null };
};

interface CustomerVoicesProps {
  data: Dataset; filter: ReviewFilter; setFilter: (filter: ReviewFilter) => void;
  topic: string; setTopic: (topic: string) => void;
  source: VoiceSourceFilter; setSource: (source: VoiceSourceFilter) => void;
  onImport: (file?: File) => Promise<void>; onDevelopment: () => void; onSupply: () => void;
  onDiscuss: (question: string) => void;
}

function RatingStars({ rating }: { rating: number }) {
  return <span className="rating-stars" aria-hidden="true"><span>{Array.from({ length: 5 }, (_, index) => <Star key={index} size={16}/>)}</span><span className="rating-stars-fill" style={{ width: `${rating / 5 * 100}%` }}>{Array.from({ length: 5 }, (_, index) => <Star key={index} size={16}/>)}</span></span>;
}

export function CustomerVoices({ data, filter, setFilter, topic, setTopic, source, setSource, onImport, onDevelopment, onSupply, onDiscuss }: CustomerVoicesProps) {
  const workspace = useWorkspace();
  const { voices: voiceSources, chats: ecChatHistory } = workspace.data;
  const voiceSentiments = workspace.data.sentiments.entries;
  const [word, setWord] = useState('');
  const [rankingSource, setRankingSource] = useState<'review' | 'survey'>('review');
  const [minimumCount, setMinimumCount] = useState(1);
  const [sentimentDimension, setSentimentDimension] = useState<SentimentDimension>('store');
  const [sentimentSelection, setSentimentSelection] = useState<(SentimentSelection & { scope: string }) | null>(null);
  const [liveSelection, setLiveSelection] = useState<SocialVoiceSelection | null>(null);
  const handleLiveSelection = useCallback((selection: SocialVoiceSelection) => setLiveSelection(selection), []);
  const allVoices = selectVoices(data, voiceSources, filter, 'all', ecChatHistory);
  const voices = allVoices.filter(row => source === 'all' || row.source === source);
  const topics = [...new Set(voices.flatMap(row => row.topics))].sort((left, right) => left.localeCompare(right, 'ja'));
  const activeTopic = topic;
  const words = countVoiceWords(voices);
  const activeWord = !activeTopic ? word : '';
  const matchingVoices = voices.filter(row => (!activeTopic || row.topics.includes(activeTopic)) && (!activeWord || wordsInVoice(row.text).has(activeWord)));
  const sentimentScope = JSON.stringify([filter, source, activeTopic, activeWord, sentimentDimension]);
  const activeSentiment = sentimentSelection?.scope === sentimentScope ? sentimentSelection : null;
  const shown = activeSentiment ? matchingVoices.filter(row => matchesSentimentSelection(row, activeSentiment, voiceSentiments)) : matchingVoices;
  const sentimentTopic = activeSentiment?.dimension === 'topic' ? activeSentiment.groupId : undefined;
  const reviews = voices.filter(row => row.source === 'review');
  const surveys = voices.filter(row => row.source === 'survey');
  const social = voices.filter(row => row.source === 'social');
  const chats = voices.filter(row => row.source === 'chat');
  const conversationCount = new Set(chats.map(row => row.conversation!.id)).size;
  const isUnratedSource = source === 'social' || source === 'chat';
  const reviewRating = average(reviews);
  const surveyRating = average(surveys);
  const selectedStores = data.stores.filter(store => filter.storeIds.includes(store.id));
  const effectiveRankingSource = source === 'survey' ? 'survey' : source === 'review' ? 'review' : rankingSource;
  const ranking = rankVoiceStores(voices, selectedStores, effectiveRankingSource, minimumCount);
  const service = data.serviceFeedback.filter(row => {
    const order = data.orders.find(order => order.id === row.orderId);
    return order && filter.storeIds.includes(order.storeId)
      && data.orderLines.some(line => line.orderId === order.id && line.productId === filter.productId)
      && Date.parse(row.publishedAt) >= Date.parse(jstStart(filter.from))
      && Date.parse(row.publishedAt) <= Math.min(Date.parse(jstEnd(filter.to)), Date.parse(data.asOf));
  });
  const updateFilter = (value: ReviewFilter) => { setFilter(value); setTopic(''); setWord(''); };
  const selectWord = (value: string) => { setWord(activeWord === value ? '' : value); setTopic(''); };
  const selectedSentimentName = activeSentiment?.dimension === 'store' ? data.stores.find(store => store.id === activeSentiment.groupId)?.name ?? '店舗不明' : activeSentiment?.groupId;
  const liveWindow = source === 'social' ? liveSelection?.window ?? null : null;
  const livePosts = source === 'social' ? liveSelection?.posts ?? [] : [];
  const usingLive = source === 'social' && (livePosts.length > 0 || liveWindow !== null);
  const records = usingLive
    ? livePosts.map(post => ({ id: post.eventId, at: post.publishedAt, sentiment: post.sentiment as Sentiment, who: post.authorAlias, text: post.text }))
    : shown.map(row => ({ id: row.id, at: Date.parse(row.publishedAt), sentiment: voiceSentiment(row, voiceSentiments, sentimentTopic), who: data.stores.find(store => store.id === row.storeId)?.name ?? '店舗不明', text: row.text }));
  return <>
    <div className="page-heading"><h1>顧客の声</h1><button className="primary" onClick={onDevelopment}>開発案件を開く<ArrowRight size={17}/></button></div>
    <div className="voice-sources" role="group" aria-label="情報源">{(['all', 'review', 'survey', 'social', 'chat'] as const).map(value => {
      const Icon = sourceIcons[value];
      const count = allVoices.filter(row => value === 'all' || row.source === value).length;
      return <button key={value} aria-pressed={source === value} onClick={() => { setSource(value); setTopic(''); setWord(''); setLiveSelection(null); }}><Icon size={17}/><span>{voiceSourceLabels[value]}</span><strong>{count}</strong></button>;
    })}</div>
    <section className="filters voice-filters" aria-label="顧客の声の集計条件">
      <label>商品<select value={filter.productId} onChange={event => updateFilter({ ...filter, productId: event.target.value })}>{data.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      <label>開始日<input type="date" value={filter.from} max={filter.to} onChange={event => updateFilter({ ...filter, from: event.target.value })}/></label>
      <label>終了日<input type="date" value={filter.to} min={filter.from} max={data.asOf.slice(0, 10)} onChange={event => updateFilter({ ...filter, to: event.target.value })}/></label>
      {workspace.mode === 'memory' && <><label className="upload-button"><Upload size={16}/>レビュー取込<input aria-label="レビュー投稿ファイル" type="file" accept="application/json,.json" onChange={event => { void onImport(event.target.files?.[0]); event.target.value = ''; }}/></label>
      <a className="icon-link" href={eventUrl} download="review-published.json" title="合成投稿ファイル" aria-label="合成投稿ファイルをダウンロード"><Download size={18}/></a></>}
      <fieldset className="store-filter"><legend>店舗</legend>{data.stores.map(store => <label key={store.id}><input type="checkbox" checked={filter.storeIds.includes(store.id)} onChange={event => updateFilter({ ...filter, storeIds: event.target.checked ? [...filter.storeIds, store.id] : filter.storeIds.filter(id => id !== store.id) })}/>{store.name}</label>)}<button className="text-action" onClick={() => updateFilter({ ...filter, storeIds: data.stores.map(store => store.id) })}>全店舗</button></fieldset>
    </section>
    <section className="metrics voice-metrics" aria-label="顧客の声の指標" aria-live="polite">
      <div><span>対象の声</span><strong>{voices.length}<small>件</small></strong><span>{voiceSourceLabels[source]} / 投稿・回答・顧客発言</span></div>
      <div><span>レビューの商品評価</span><strong>{reviewRating.value?.toFixed(2) ?? '対象なし'}{reviewRating.value !== null && <small>/ 5</small>}</strong><span>{reviews.length} 件 / 購入・受取確認済み</span></div>
      <div><span>アンケートの商品満足度</span><strong>{surveyRating.value?.toFixed(2) ?? '対象なし'}{surveyRating.value !== null && <small>/ 5</small>}</strong><span>{surveyRating.count} 件が評価回答 / 自由記述 {surveys.length} 件</span></div>
      <div><span>SNS 口コミ</span><strong>{social.length}<small>件</small></strong><span>星評価なし / 購入確認なし</span></div>
      <div><span>EC チャットの顧客発言</span><strong>{chats.length}<small>件</small></strong><span>{conversationCount} 会話 / AI の返答は集計対象外</span></div>
    </section>
    <div className="voice-overview">
      <div className="voice-analysis-left">
      {source === 'social' && <SocialVoiceLive productId={filter.productId} label={`${data.products.find(product => product.id === filter.productId)?.name ?? filter.productId}`} onSelection={handleLiveSelection}/>}
      <VoiceTimeline voices={voices} from={filter.from} to={filter.to}/>
      </div>
      <section className="voice-ranking" aria-label={isUnratedSource ? '投稿レコード' : '店舗別ランキング'}><div className="section-heading"><h2>{isUnratedSource ? <><MessagesSquare size={17}/>投稿レコード</> : <><Star size={17}/>店舗別ランキング</>}</h2>{isUnratedSource ? <span aria-live="polite">{records.length} 件{liveWindow ? ` / ${recordTime.format(liveWindow.windowStart)} の窓` : ''}</span> : <label className="compact-label">最低件数<select aria-label="ランキングの最低件数" value={minimumCount} onChange={event => setMinimumCount(Number(event.target.value))}><option value={1}>1 件</option><option value={2}>2 件</option><option value={5}>5 件</option></select></label>}</div>
        {isUnratedSource ? <>
          <ol className="voice-record-list">{records.map(record => <li key={record.id}>
            <div><time dateTime={new Date(record.at).toISOString()}>{recordTime.format(record.at)}</time><span className={`sentiment-badge sentiment-text-${record.sentiment}`}>{sentimentLabels[record.sentiment]}</span><span>{record.who}</span></div>
            <p>{record.text}</p>
          </li>)}</ol>
          {!records.length && <p className="empty">{liveWindow ? 'この窓に取り込まれた投稿はありません。' : 'この条件に該当する投稿はありません。'}</p>}
          <p className="scope-note">{usingLive ? `Eventhouse の取り込み済みレコードです。${liveWindow ? 'グラフで選んだ 5 分窓に絞り込んでいます。' : 'グラフの棒を選ぶとその窓だけに絞り込みます。'}` : `${voiceSourceLabels[source]}の原文です。星評価は推定しません。`}</p>
        </> : <>
          {source === 'all' ? <div className="rating-source" role="group" aria-label="ランキングの評価元">{(['review', 'survey'] as const).map(value => <button key={value} aria-pressed={rankingSource === value} onClick={() => setRankingSource(value)}>{voiceSourceLabels[value]}</button>)}</div> : <span className="badge">{voiceSourceLabels[effectiveRankingSource]}</span>}
          <ol className="store-ranking">{ranking.map(row => <li key={row.storeId} data-rank={row.rank ?? ''}><button onClick={() => setFilter({ ...filter, storeIds: [row.storeId] })} aria-label={`${row.name}、${row.average === null ? '順位なし' : `${row.rank} 位、${row.average.toFixed(2)} / 5`}、${row.count} 件。店舗を絞り込む`}>
            <span className={`rank-number${row.rank === 1 ? ' first' : ''}`}>{row.rank ?? '-'}</span><span className="rank-store">{row.name}</span>
            <span className="rank-score">{row.average === null ? <span className="unknown-text">{row.count ? '件数不足' : '評価なし'}</span> : <><RatingStars rating={row.average}/><strong>{row.average.toFixed(2)}</strong></>}<small>{row.count} 件</small></span>
          </button></li>)}</ol>
          {!selectedStores.length && <p className="empty">対象店舗がありません。</p>}
          <p className="scope-note">{effectiveRankingSource === 'review' ? '選択商品のレビュー平均' : '選択商品の満足度平均（1: 不満 ～ 5: 満足）'}。同点は同順位。店舗サービス全体の評価ではありません。</p>
        </>}
      </section>
      <section className="voice-word-section"><div className="section-heading"><h2>ワードクラウド</h2><span>{voices.length} 件の原文</span></div><VoiceWordCloud words={words} selected={activeWord} onSelect={selectWord}/><p className="scope-note">語を含む原文数・上位 {words.length} 語。同じ原文内の繰り返しは 1 件です。チャットは顧客発言単位です。</p></section>
    </div>
    <div className="review-columns voice-detail-columns"><section>
      <VoiceSentimentChart voices={matchingVoices} stores={selectedStores} dimension={sentimentDimension} setDimension={value => { setSentimentDimension(value); setSentimentSelection(null); }} selection={activeSentiment} onSelect={value => setSentimentSelection(activeSentiment?.groupId === value.groupId && activeSentiment.sentiment === value.sentiment ? null : { ...value, scope: sentimentScope })}/>
      <p className="scope-note">投稿・回答・顧客発言に限定した集計です。人数の重複は未照合です。EC チャットの店舗は受取予定店で、来店・購入実績ではありません。</p>
      <details className="voice-service"><summary>サービス評価（注文別）<span>不満 {service.filter(row => row.dissatisfied).length} / {service.length} 件</span></summary><div className="section-heading"><h3>サービス評価</h3><button onClick={onSupply}><Truck size={16}/>供給記録</button></div>{service.map(row => <div className="service-row" key={row.id}><span>{row.rating} / 5</span><p>{row.text}</p><code>{row.orderId}</code></div>)}{!service.length && <p className="empty">対象となるサービス評価はありません。</p>}</details>
    </section><section className="voice-originals" aria-label="顧客の声の原文"><div className="section-heading"><h2>要望と原文</h2><span aria-live="polite">{shown.length} / {voices.length} 件</span></div>
      <div className="voice-original-filters"><label className="compact-label">話題<select value={activeTopic} onChange={event => { setTopic(event.target.value); setWord(''); }}><option value="">全話題</option>{[...new Set([...topics, ...(activeTopic ? [activeTopic] : [])])].map(value => <option key={value}>{value}</option>)}</select></label>{activeWord && <button className="selected-word" aria-label="語の絞り込みを解除" onClick={() => setWord('')}>{activeWord}<X size={14}/></button>}</div>
      {activeSentiment && <button className="selected-word" aria-label="感情の絞り込みを解除" onClick={() => setSentimentSelection(null)}>{selectedSentimentName} / {activeSentiment.sentiment === 'all' ? '全分類' : sentimentLabels[activeSentiment.sentiment]}<X size={14}/></button>}
      <div className="review-list">{shown.map(row => <article key={row.id} className="review voice-review" data-source={row.source}><div><span className={`voice-source-label source-${row.source}`}>{voiceSourceLabels[row.source]}</span><span>{row.source === 'chat' && row.storeId ? '受取予定：' : ''}{data.stores.find(store => store.id === row.storeId)?.name ?? '店舗不明'}</span><span className={`sentiment-badge sentiment-text-${voiceSentiment(row, voiceSentiments, sentimentTopic)}`} title={sentimentTopic ? `${sentimentTopic}の合成分類` : '原文全体の合成分類'}>{sentimentLabels[voiceSentiment(row, voiceSentiments, sentimentTopic)]}{sentimentTopic ? ` / ${sentimentTopic}` : ''}</span><span>{row.rating === null ? (row.source === 'social' || row.source === 'chat' ? '星評価なし' : '評価未回答') : `${row.source === 'survey' ? '満足度' : '商品'} ${row.rating} / 5`}</span></div><p>{row.text}</p><footer><code>{row.recordId}</code><time>{dateTime(row.publishedAt)}</time><span>{row.source === 'review' ? '受取確認済み' : row.source === 'survey' ? '購入確認なし' : row.source === 'chat' ? `顧客発言 / ${row.conversation?.channel === 'voice' ? '音声文字起こし（合成）' : 'テキスト（合成）'}` : '合成投稿'}</span></footer>
        {row.conversation && <details className="voice-conversation"><summary>会話履歴 <code>{row.conversation.id}</code></summary><ol>{row.conversation.messages.map(message => {
          const outsidePeriod = Date.parse(message.sentAt) < Date.parse(jstStart(filter.from)) || Date.parse(message.sentAt) > Date.parse(jstEnd(filter.to));
          return <li key={message.id} className={`chat-turn chat-turn-${message.role}${message.id === row.recordId ? ' selected-turn' : ''}`}><div><strong>{message.role === 'customer' ? 'お客様' : 'AI バリスタ'}</strong><time>{dateTime(message.sentAt)}</time>{message.role === 'assistant' && <span>集計対象外</span>}{outsidePeriod && <span>期間外の文脈</span>}{message.role === 'customer' && message.productId !== filter.productId && <span>対象商品未指定・別商品</span>}</div><p>{message.text}</p></li>;
        })}</ol></details>}
      </article>)}{!shown.length && <p className="empty">この条件に該当する声はありません。</p>}</div>
    </section></div>
    <VoiceDecisionCards voices={voices} stores={selectedStores} onDiscuss={onDiscuss} onTopic={value => { setTopic(value); setWord(''); setSentimentSelection(null); document.querySelector('.voice-originals')?.scrollIntoView({ block: 'center' }); }}/>
    <VoiceAlertPanel voices={allVoices} end={Math.min(Date.parse(jstEnd(filter.to)), Date.parse(data.asOf))} availableFrom={Date.parse(jstStart(filter.from))}
      live={source === 'social' ? liveSelection : null}
      scope={JSON.stringify([data.datasetId, filter.productId, [...filter.storeIds].sort()])}
      label={`${data.products.find(product => product.id === filter.productId)?.name ?? filter.productId} / ${selectedStores.length === data.stores.length ? '全店舗' : selectedStores.map(store => store.name).join('・') || '店舗未選択'}`}/>
  </>;
}