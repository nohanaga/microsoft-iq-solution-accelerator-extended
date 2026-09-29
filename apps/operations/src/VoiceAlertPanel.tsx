import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { BellRing, Check, CheckCheck, Download, Mail, MessagesSquare, Play, ShieldAlert } from 'lucide-react';
import type { CustomerVoice } from './voice';
import { useWorkspace } from './workspace-context';
import type { VoiceSentimentAnnotation } from './sentiment';
import { defaultSpikeSettings, evaluateVoiceSpike } from './voiceDecisions';
import type { SpikeEvaluation, SpikeSettings } from './voiceDecisions';
import { downloadJson } from './adapter';
import { rtiConfig } from './rti-client';
import type { SocialVoiceSelection } from './SocialVoiceLive';
import demoFixture from '../v3/data/voice-spike-demo.json';

interface AlertRecord {
  key: string;
  id: string;
  subject: string;
  mode: 'fixture' | 'demo' | 'rti';
  settings: SpikeSettings;
  evaluation: SpikeEvaluation;
  recordedAt: string;
  status: 'new' | 'acknowledged' | 'resolved';
}
interface VoiceAlertPanelProps { voices: CustomerVoice[]; end: number; availableFrom: number; scope: string; label: string; live?: SocialVoiceSelection | null }
const formatTime = (timestamp: number) => Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false }) : '-';
const percent = (value: number | null) => value === null ? '-' : `${(value * 100).toFixed(1)}%`;
const statusLabels = { new: '要確認', acknowledged: '確認済み', resolved: '対応完了' };
const windowSchema = z.object({ total: z.number().int().nonnegative(), negative: z.number().int().nonnegative(), classified: z.number().int().nonnegative(), negativeRate: z.number().nullable(), coverage: z.number().nullable() });
const alertSchema: z.ZodType<AlertRecord> = z.object({
  key: z.string(), id: z.uuid(), subject: z.string(), mode: z.enum(['fixture', 'demo', 'rti']), recordedAt: z.iso.datetime({ offset: true }), status: z.enum(['new', 'acknowledged', 'resolved']),
  settings: z.object({ windowHours: z.number(), minPosts: z.number(), minNegative: z.number(), negativePercent: z.number(), growth: z.number() }),
  evaluation: z.object({ status: z.enum(['invalid', 'insufficient', 'normal', 'candidate']), reason: z.string(), start: z.number(), end: z.number(), previousStart: z.number(),
    current: windowSchema, previous: windowSchema, growth: z.number().nullable(), evidence: z.array(z.object({ id: z.string(), recordId: z.string(), source: z.enum(['review', 'survey', 'social', 'chat']), productId: z.string(), storeId: z.string().nullable(), rating: z.number().nullable(), text: z.string(), topics: z.array(z.string()), publishedAt: z.iso.datetime({ offset: true }) })) }),
});

const liveStatusLabels = { insufficient: '判定保留', normal: '急増未検知', watch: '監視中・連続回数が未達', firing: '炎上アラート発動', recovered: '回復' };
const liveSettings: SpikeSettings = {
  windowHours: rtiConfig.alert.windowMinutes / 60,
  minPosts: rtiConfig.alert.minimumSocialCount,
  minNegative: Math.ceil(rtiConfig.alert.minimumSocialCount * rtiConfig.alert.negativeRateThreshold),
  negativePercent: rtiConfig.alert.negativeRateThreshold * 100,
  growth: rtiConfig.alert.consecutiveOccurrences,
};

// Maps the Eventhouse five-minute evaluation onto the stored spike shape so history stays one schema.
function liveEvaluation(live: SocialVoiceSelection): SpikeEvaluation | null {
  const ordered = [...live.windows].sort((left, right) => left.windowStart - right.windowStart);
  if (!ordered.length) return null;
  const firing = live.evaluation.status === 'firing' && live.evaluation.firedAt !== null;
  const index = firing ? ordered.findIndex(window => window.windowStart === live.evaluation.firedAt) : ordered.length - 1;
  const target = ordered[index < 0 ? ordered.length - 1 : index];
  const previous = ordered[(index < 0 ? ordered.length - 1 : index) - 1];
  const summarize = (window?: typeof target) => window
    ? { total: window.totalSocialCount, negative: window.negativeCount, classified: window.totalSocialCount, negativeRate: window.negativeRate, coverage: 1 }
    : { total: 0, negative: 0, classified: 0, negativeRate: null, coverage: null };
  const evidence: CustomerVoice[] = live.allPosts
    .filter(post => post.sentiment === 'negative' && post.publishedAt >= target.windowStart && post.publishedAt < target.windowEnd)
    .map(post => ({
      id: post.eventId, recordId: post.eventId, source: 'social' as const, productId: post.productId,
      storeId: post.storeId, rating: null, text: post.text, topics: [],
      publishedAt: new Date(post.publishedAt).toISOString(),
    }));
  return {
    status: firing ? 'candidate' : live.evaluation.status === 'insufficient' ? 'insufficient' : 'normal',
    reason: `${liveStatusLabels[live.evaluation.status]}。否定率 ${percent(target.negativeRate)} / 閾値 ${rtiConfig.alert.negativeRateThreshold * 100}%、連続 ${live.evaluation.consecutive} / ${rtiConfig.alert.consecutiveOccurrences} 回、最小 ${rtiConfig.alert.minimumSocialCount} 件。Eventhouse の ${rtiConfig.alert.windowMinutes} 分窓による判定です。`,
    start: target.windowStart,
    end: target.windowEnd,
    previousStart: previous?.windowStart ?? target.windowStart,
    current: summarize(target),
    previous: summarize(previous),
    growth: previous && previous.totalSocialCount ? target.totalSocialCount / previous.totalSocialCount : null,
    evidence,
  };
}

export function VoiceAlertPanel({ voices, end, availableFrom, scope, label, live }: VoiceAlertPanelProps) {
  const { data, repository, mode } = useWorkspace();
  const voiceSentiments = data.sentiments.entries;
  const [fixtureSettings, setFixtureSettings] = useState<SpikeSettings>(defaultSpikeSettings);
  const [demoSettings, setDemoSettings] = useState<SpikeSettings>(defaultSpikeSettings);
  const [enabled, setEnabled] = useState(true);
  const [demo, setDemo] = useState(false);
  const setSettings = demo ? setDemoSettings : setFixtureSettings;  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    repository.listRecords('alerts', controller.signal).then(records => {
      if (controller.signal.aborted) return;
      const latest = new Map<string, AlertRecord>();
      for (const record of records) {
        const snapshot = z.object({ scope: z.string(), alert: alertSchema }).parse(record.payload);
        if (snapshot.scope === scope && snapshot.alert.mode !== 'demo' && !latest.has(snapshot.alert.key)) latest.set(snapshot.alert.key, snapshot.alert);
      }
      setAlerts([...latest.values()]); setHistoryReady(true);
    }).catch(reason => { if (!controller.signal.aborted) setHistoryError(reason instanceof Error ? reason.message : '履歴を取得できません。'); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, [repository, scope]);
  const [channel, setChannel] = useState<'teams' | 'email'>('teams');
  const [previewId, setPreviewId] = useState('');
  const demoEnd = Date.parse('2026-07-08T18:00:00+09:00');
  const demoVoices: CustomerVoice[] = demoFixture.entries.map(entry => ({
    id: entry.id, recordId: entry.id, source: 'social', productId: 'DEMO', storeId: null,
    rating: null, text: entry.text, topics: [], publishedAt: new Date(demoEnd - entry.hoursAgo * 3_600_000).toISOString()
  }));
  const demoAnnotations = demoFixture.entries.map(entry => ({ voiceId: entry.id, text: entry.text, overall: entry.sentiment, topics: {} })) as VoiceSentimentAnnotation[];
  const fromLive = demo || !live ? null : liveEvaluation(live);
  const usingLive = fromLive !== null;
  const settings = demo ? demoSettings : usingLive ? liveSettings : fixtureSettings;
  const evaluation = fromLive ?? evaluateVoiceSpike(demo ? demoVoices : voices, demo ? demoEnd : end, demo ? demoEnd - 48 * 3_600_000 : availableFrom, settings, demo ? demoAnnotations : voiceSentiments);
  const candidateKey = usingLive
    ? JSON.stringify([scope, 'rti', evaluation.start, evaluation.end, liveSettings])
    : JSON.stringify([demo ? 'isolated-demo' : scope, evaluation.start, evaluation.end, settings,
      (demo ? demoVoices : voices).filter(voice => voice.source === 'social' && Date.parse(voice.publishedAt) > evaluation.previousStart && Date.parse(voice.publishedAt) <= evaluation.end).map(voice => [voice.id, voice.text]).sort()]);
  const candidateJson = enabled && evaluation.status === 'candidate' ? JSON.stringify({
    key: candidateKey, subject: demo ? '独立した SNS 急増デモ' : label, mode: demo ? 'demo' : usingLive ? 'rti' : 'fixture', settings, evaluation
  }) : '';
  useEffect(() => {
    if (!candidateJson || !historyReady) return;
    const candidate = JSON.parse(candidateJson) as Pick<AlertRecord, 'key' | 'subject' | 'mode' | 'settings' | 'evaluation'>;
    setAlerts(previous => previous.some(alert => alert.key === candidate.key) ? previous : [{ ...candidate, id: crypto.randomUUID(), recordedAt: new Date().toISOString(), status: 'new' }, ...previous]);
  }, [candidateJson, historyReady]);
  const currentAlert = alerts.find(alert => alert.key === candidateKey);
  const preview = alerts.find(alert => alert.id === previewId);
  const notification = preview ? {
    schemaVersion: '1.0', eventType: 'voice.spike.candidate', alertId: preview.id,
    dataOrigin: 'synthetic', executionMode: preview.mode, deliveryStatus: 'not-sent', channel,
    subject: `[要確認] ${preview.subject}`, detectedWindow: { start: formatTime(preview.evaluation.start), end: formatTime(preview.evaluation.end), timezone: 'Asia/Tokyo' },
    metrics: preview.evaluation.current, previous: preview.evaluation.previous, growth: preview.evaluation.growth,
    settings: preview.settings, evidenceIds: preview.evaluation.evidence.map(voice => voice.id),
    message: 'SNS の投稿数と否定的な投稿が検知条件を満たしました。炎上の確定ではありません。原文・重複投稿・拡散状況を確認してください。',
    recordedAt: preview.recordedAt
  } : null;
  const changeStatus = async (id: string, status: AlertRecord['status']) => {
    const alert = alerts.find(row => row.id === id);
    if (!alert || saving) return;
    const updated = { ...alert, status };
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true); setHistoryError('');
    try {
      if (alert.mode !== 'demo') await repository.saveRecord({ id: crypto.randomUUID(), kind: 'alerts', recordedAt: new Date().toISOString(), datasetVersion: data.operations.version,
        payload: { scope, alert: updated, dataOrigin: 'synthetic', executionMode: mode } }, controller.signal);
      if (!controller.signal.aborted) setAlerts(previous => previous.map(row => row.id === id ? updated : row));
    } catch (reason) { if (!controller.signal.aborted) setHistoryError(reason instanceof Error ? reason.message : '履歴を保存できません。'); }
    finally { if (!controller.signal.aborted) setSaving(false); if (pending.current === controller) pending.current = null; }
  };
  return <section className="voice-alert-panel" aria-label="炎上リスクの検知">
    <div className="section-heading"><h2><ShieldAlert size={20}/>炎上リスク</h2><span className="badge">{usingLive ? 'RTI 判定 / 外部通知未接続' : '履歴データ / 外部通知未接続'}</span></div>
    <div className="alert-toolbar"><label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/>画面内アラート</label><span>SNS / {demo ? '独立デモ' : label}{usingLive ? ` / Eventhouse ${rtiConfig.alert.windowMinutes} 分窓` : ''}</span><button aria-pressed={demo} onClick={() => setDemo(value => !value)}><Play size={14}/>{demo ? '実演を終了' : '検知デモ'}</button></div>
    <div className={`alert-state alert-state-${enabled ? evaluation.status : 'paused'}`} role={enabled && evaluation.status === 'candidate' && currentAlert?.status === 'new' ? 'alert' : 'status'}>
      <BellRing size={23}/><div><strong>{!enabled ? 'アラート停止中' : usingLive && live ? liveStatusLabels[live.evaluation.status] : evaluation.status === 'candidate' ? '急増候補・要確認' : evaluation.status === 'insufficient' ? '判定保留' : evaluation.status === 'invalid' ? '条件を確認' : '急増未検知'}</strong><p>{evaluation.reason}</p></div>
    </div>
    <div className="alert-metrics"><div><span>投稿数</span><strong>{evaluation.current.total}<small> 件</small></strong><span>{usingLive ? '前の窓' : '前期間'} {evaluation.previous.total} 件</span></div><div><span>否定的な投稿</span><strong>{evaluation.current.negative}<small> 件</small></strong><span>分類済み {evaluation.current.classified} 件</span></div><div><span>否定率</span><strong>{percent(evaluation.current.negativeRate)}</strong><span>{usingLive ? `閾値 ${rtiConfig.alert.negativeRateThreshold * 100}%` : `分類率 ${percent(evaluation.current.coverage)}`}</span></div><div><span>{usingLive ? '連続回数' : '投稿数の前期間比'}</span><strong>{usingLive && live ? `${live.evaluation.consecutive} / ${rtiConfig.alert.consecutiveOccurrences}` : evaluation.growth === null ? '-' : `${evaluation.growth.toFixed(1)} 倍`}</strong><span>{usingLive ? `連続する ${rtiConfig.alert.windowMinutes} 分窓` : '同じ長さの直前期間'}</span></div></div>
    <p className="scope-note">{usingLive ? `対象の窓：${formatTime(evaluation.start)} ～ ${formatTime(evaluation.end)} JST。Eventhouse の ${rtiConfig.windowFunction}() と同じ集計結果を使っています。` : `対象：${formatTime(evaluation.start)} より後 ～ ${formatTime(evaluation.end)} JST。前期間：${formatTime(evaluation.previousStart)} より後 ～ ${formatTime(evaluation.start)} JST。`}</p>
    {usingLive ? <p className="scope-note">検知条件：{rtiConfig.alert.windowMinutes} 分窓 / 最小 {rtiConfig.alert.minimumSocialCount} 件 / 否定率 {rtiConfig.alert.negativeRateThreshold * 100}% 以上 / 連続 {rtiConfig.alert.consecutiveOccurrences} 回 / 回復 {rtiConfig.alert.recoveryRateThreshold * 100}% 以下。<code>v3/rti/config.json</code> の設定で、リアルタイム SNS 監視と共通です。</p> : <details className="alert-settings"><summary>検知条件</summary><div className="alert-setting-fields">
      <label>集計幅<select value={settings.windowHours} onChange={event => setSettings({ ...settings, windowHours: Number(event.target.value) })}><option value={24}>24 時間</option><option value={72}>72 時間</option><option value={168}>7 日間</option></select></label>
      <label>最低投稿数<input type="number" min={1} step={1} value={settings.minPosts} onChange={event => setSettings({ ...settings, minPosts: Number(event.target.value) })}/></label>
      <label>最低否定件数<input type="number" min={1} step={1} value={settings.minNegative} onChange={event => setSettings({ ...settings, minNegative: Number(event.target.value) })}/></label>
      <label>否定率 (%)<input type="number" min={1} max={100} value={settings.negativePercent} onChange={event => setSettings({ ...settings, negativePercent: Number(event.target.value) })}/></label>
      <label>前期間比 (倍)<input type="number" min={1.1} step={0.1} value={settings.growth} onChange={event => setSettings({ ...settings, growth: Number(event.target.value) })}/></label>
    </div><p className="scope-note">すべての条件を満たす場合に検知します。両期間に投稿があり、分類率が各 80% 以上必要です。しきい値はデモ用の仮設定です。</p></details>}
    {!!evaluation.evidence.length && <details className="alert-evidence"><summary>対象期間の否定原文 {evaluation.evidence.length} 件</summary>{evaluation.evidence.map(voice => <blockquote key={voice.id}><code>{voice.recordId}</code><p>{voice.text}</p></blockquote>)}</details>}
    <div className="section-heading"><h3>アラート履歴</h3><span>{alerts.length} 件 / 未確認 {alerts.filter(alert => alert.status === 'new').length} 件</span></div>
    {historyError && <p role="alert">{historyError}</p>}
    {!historyReady && !historyError && <p role="status">履歴を取得しています。</p>}
    {!alerts.length && <p className="empty">アラートはありません。</p>}
    <div className="alert-history">{alerts.map(alert => <article key={alert.id} className="alert-history-item"><header><strong>{alert.subject}</strong><span className="badge">{alert.mode === 'demo' ? '検知デモ' : alert.mode === 'rti' ? 'RTI 判定' : '合成データ'} / {statusLabels[alert.status]}</span></header>
      <p>{formatTime(alert.evaluation.end)} JST / 投稿 {alert.evaluation.current.total} 件 / 否定 {alert.evaluation.current.negative} 件 / {percent(alert.evaluation.current.negativeRate)}{alert.mode === 'rti' ? ` / 連続 ${alert.settings.growth} 回到達` : ` / ${alert.evaluation.growth?.toFixed(1)} 倍`}</p>
      <div className="alert-actions"><button disabled={saving || alert.status !== 'new'} onClick={() => void changeStatus(alert.id, 'acknowledged')}><Check size={14}/>確認済みにする</button><button disabled={saving || alert.status === 'resolved'} onClick={() => void changeStatus(alert.id, 'resolved')}><CheckCheck size={14}/>対応完了</button><button onClick={() => setPreviewId(previewId === alert.id ? '' : alert.id)}><Mail size={14}/>通知内容</button></div>
    </article>)}</div>
    {preview && notification && <section className="notification-preview" aria-label="通知プレビュー"><div className="section-heading"><h3>通知プレビュー</h3><span className="badge">未送信</span></div><div className="rating-source" role="group" aria-label="通知先の種類"><button aria-pressed={channel === 'teams'} onClick={() => setChannel('teams')}><MessagesSquare size={14}/>Teams</button><button aria-pressed={channel === 'email'} onClick={() => setChannel('email')}><Mail size={14}/>メール</button></div><h4>{notification.subject}</h4><p>{notification.message}</p><p>投稿 {preview.evaluation.current.total} 件 / 否定 {preview.evaluation.current.negative} 件 / {percent(preview.evaluation.current.negativeRate)}{preview.mode === 'rti' ? ` / 連続 ${preview.settings.growth} 回到達` : ` / 前期間比 ${preview.evaluation.growth?.toFixed(1)} 倍`}</p><button onClick={() => downloadJson(notification, `voice-alert-${preview.id}.json`)}><Download size={15}/>通知 JSON</button><span className="scope-note"> 配信先未設定</span></section>}
    <p className="scope-note">{usingLive ? '炎上の確定ではありません。複製投稿・拡散・収集漏れの調査が必要です。Eventhouse の取り込み済みデータに対する画面内判定で、Activator による Teams・メール送信は別途ルール設定が必要です。' : '炎上の確定ではありません。複製投稿・拡散・収集漏れの調査が必要です。画面表示中の履歴データ判定であり、常時監視・Teams・メール送信は未接続です。'}</p>
  </section>;
}