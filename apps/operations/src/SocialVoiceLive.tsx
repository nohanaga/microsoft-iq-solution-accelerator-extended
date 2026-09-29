import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar, Brush, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, BellRing, Check, Flame, Pause, Play, RefreshCw, RotateCcw, Send, ShieldCheck, X } from 'lucide-react';
import { EventhouseSignInRequiredError, ingestSocialVoiceEvents, readSocialVoicePosts, readSocialVoiceWindows, rtiConfig, signInToEventhouse } from './rti-client';
import type { SocialVoicePost, SocialVoiceWindow } from './rti-client';
import { actWindowStart, buildActEvents, demoActs, demoBaseTime, demoStoreId } from './social-voice-demo';

const clockTime = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
const fullTime = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const windowLength = rtiConfig.alert.windowMinutes * 60_000;
const ranges = [
  { minutes: 30, label: '30 分' },
  { minutes: 60, label: '1 時間' },
  { minutes: 360, label: '6 時間' },
  { minutes: 1440, label: '24 時間' },
  { minutes: 0, label: 'すべて' },
] as const;

export type AlertStatus = 'insufficient' | 'normal' | 'watch' | 'firing' | 'recovered';

export interface AlertEvaluation {
  status: AlertStatus;
  latest: SocialVoiceWindow | null;
  consecutive: number;
  firedAt: number | null;
  recoveredAt: number | null;
}

const statusLabels: Record<AlertStatus, string> = {
  insufficient: '評価に必要な件数が不足',
  normal: '正常',
  watch: '監視中（連続回数が未達）',
  firing: '炎上アラート発動',
  recovered: '回復',
};

export function evaluateSocialVoiceAlert(windows: SocialVoiceWindow[]): AlertEvaluation {
  const { minimumSocialCount, negativeRateThreshold, consecutiveOccurrences, recoveryRateThreshold } = rtiConfig.alert;
  const ordered = [...windows].sort((left, right) => left.windowStart - right.windowStart);
  const latest = ordered.at(-1) ?? null;
  let consecutive = 0;
  let firedAt: number | null = null;
  let recoveredAt: number | null = null;
  let firing = false;
  for (const window of ordered) {
    const countable = window.totalSocialCount >= minimumSocialCount;
    if (countable && window.negativeRate >= negativeRateThreshold) {
      consecutive += 1;
      if (consecutive >= consecutiveOccurrences && !firing) { firing = true; firedAt = window.windowStart; recoveredAt = null; }
    } else {
      consecutive = 0;
      if (firing && countable && window.negativeRate <= recoveryRateThreshold) { firing = false; recoveredAt = window.windowStart; }
    }
  }
  if (!latest) return { status: 'insufficient', latest, consecutive, firedAt, recoveredAt };
  if (firing) return { status: 'firing', latest, consecutive, firedAt, recoveredAt };
  if (recoveredAt !== null) return { status: 'recovered', latest, consecutive, firedAt, recoveredAt };
  if (latest.totalSocialCount < minimumSocialCount) return { status: 'insufficient', latest, consecutive, firedAt, recoveredAt };
  if (consecutive > 0) return { status: 'watch', latest, consecutive, firedAt, recoveredAt };
  return { status: 'normal', latest, consecutive, firedAt, recoveredAt };
}

function exceedsThreshold(window: SocialVoiceWindow) {
  return window.totalSocialCount >= rtiConfig.alert.minimumSocialCount
    && window.negativeRate >= rtiConfig.alert.negativeRateThreshold;
}

interface SocialVoiceLiveProps {
  productId: string;
  label: string;
  onSelection?: (selection: SocialVoiceSelection) => void;
}

export interface SocialVoiceSelection {
  window: SocialVoiceWindow | null;
  posts: SocialVoicePost[];
  allPosts: SocialVoicePost[];
  windows: SocialVoiceWindow[];
  evaluation: AlertEvaluation;
}

export function SocialVoiceLive({ productId, label, onSelection }: SocialVoiceLiveProps) {
  const [windows, setWindows] = useState<SocialVoiceWindow[]>([]);
  const [posts, setPosts] = useState<SocialVoicePost[]>([]);
  const [error, setError] = useState('');
  const [signInRequired, setSignInRequired] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [rangeMinutes, setRangeMinutes] = useState<number>(60);
  const [axisMode, setAxisMode] = useState<'time' | 'sequence'>('sequence');
  const [selected, setSelected] = useState<number | null>(null);
  const [demoBase, setDemoBase] = useState<number | null>(null);
  const [sentActs, setSentActs] = useState(0);
  const [sending, setSending] = useState(false);
  const [demoError, setDemoError] = useState('');
  const [demoResult, setDemoResult] = useState('');
  const running = useRef(false);

  const refresh = useCallback(async (signal: AbortSignal) => {
    if (running.current) return;
    running.current = true;
    setLoading(true);
    try {
      const [nextWindows, nextPosts] = await Promise.all([
        readSocialVoiceWindows(productId, rangeMinutes, signal),
        readSocialVoicePosts(productId, rangeMinutes, signal),
      ]);
      if (signal.aborted) return;
      setWindows(nextWindows);
      setPosts(nextPosts);
      setUpdatedAt(Date.now());
      setError('');
      setSignInRequired(false);
    } catch (reason) {
      if (signal.aborted) return;
      if (reason instanceof EventhouseSignInRequiredError) { setSignInRequired(true); setError(''); }
      else setError(reason instanceof Error ? reason.message : 'Eventhouse の取得に失敗しました。');
    } finally {
      running.current = false;
      setLoading(false);
    }
  }, [productId, rangeMinutes]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    if (!live) return () => controller.abort();
    const timer = window.setInterval(() => { void refresh(controller.signal); }, rtiConfig.query.pollIntervalMs);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [refresh, live]);

  const ordered = useMemo(() => [...windows].sort((left, right) => left.windowStart - right.windowStart), [windows]);
  const evaluation = useMemo(() => evaluateSocialVoiceAlert(ordered), [ordered]);
  const wideRange = rangeMinutes === 0 || rangeMinutes > 720;
  const chartData = useMemo(() => ordered.map(window => ({
    ...window,
    negativePercent: Number((window.negativeRate * 100).toFixed(1)),
    axisLabel: (wideRange ? fullTime : clockTime).format(window.windowStart),
    exceeds: exceedsThreshold(window),
  })), [ordered, wideRange]);
  const threshold = rtiConfig.alert.negativeRateThreshold * 100;
  const selectedWindow = selected === null ? null : ordered.find(window => window.windowStart === selected) ?? null;
  const visiblePosts = useMemo(() => (selectedWindow
    ? posts.filter(post => post.publishedAt >= selectedWindow.windowStart && post.publishedAt < selectedWindow.windowStart + windowLength)
    : posts), [posts, selectedWindow]);
  const timeDomain: [number, number] = rangeMinutes && updatedAt
    ? [Math.floor((updatedAt - rangeMinutes * 60_000) / windowLength) * windowLength, Math.ceil(updatedAt / windowLength) * windowLength]
    : [ordered.at(0)?.windowStart ?? 0, (ordered.at(-1)?.windowStart ?? 0) + windowLength];
  const barSize = Math.max(4, Math.min(24, Math.round(560 / Math.max(chartData.length, 1) / 2.4)));

  useEffect(() => {
    onSelection?.({ window: selectedWindow, posts: visiblePosts, allPosts: posts, windows: ordered, evaluation });
  }, [onSelection, selectedWindow, visiblePosts, posts, ordered, evaluation]);

  const signIn = async () => {
    try { await signInToEventhouse(); setSignInRequired(false); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Eventhouse の認証に失敗しました。'); }
  };

  const resetDemo = () => { setDemoBase(null); setSentActs(0); setDemoError(''); setDemoResult(''); };

  useEffect(() => { setDemoBase(null); setSentActs(0); setDemoError(''); setDemoResult(''); }, [productId]);

  const sendNextAct = async () => {
    if (sending || sentActs >= demoActs.length) return;
    setSending(true);
    setDemoError('');
    const controller = new AbortController();
    try {
      const base = demoBase ?? demoBaseTime();
      const index = sentActs;
      const events = await buildActEvents(index, base, productId, demoStoreId);
      const count = await ingestSocialVoiceEvents(events, controller.signal);
      setDemoBase(base);
      setSentActs(index + 1);
      setDemoResult(`第 ${index + 1} 幕：${clockTime.format(actWindowStart(base, index))} の窓へ ${count} 件を取り込みました。`);
      await refresh(controller.signal);
    } catch (reason) {
      if (reason instanceof EventhouseSignInRequiredError) { setSignInRequired(true); setDemoError(''); }
      else setDemoError(reason instanceof Error ? reason.message : '合成イベントの取り込みに失敗しました。');
    } finally {
      setSending(false);
    }
  };

  return <section className="social-live" aria-label="SNS 口コミのリアルタイム監視">
    <div className="section-heading">
      <h2><Flame size={17}/>リアルタイム SNS 監視</h2>
      <div className="social-live-controls">
        <span className="social-live-scope">{label} / {rtiConfig.alert.windowMinutes} 分窓</span>
        <button aria-pressed={live} onClick={() => setLive(value => !value)}>{live ? <><Pause size={14}/>自動更新を停止</> : <><Play size={14}/>自動更新を再開</>}</button>
        <button onClick={() => { const controller = new AbortController(); void refresh(controller.signal); }} disabled={loading}><RefreshCw size={14}/>更新</button>
      </div>
    </div>

    {signInRequired && <div className="social-live-notice" role="status"><AlertTriangle size={16}/><span>Eventhouse の読取りに同じアカウントでのサインインが必要です。</span><button className="primary" onClick={() => void signIn()}>サインイン</button></div>}
    {error && <p className="social-live-error" role="alert"><AlertTriangle size={16}/>{error}</p>}

    <div className={`social-live-alert alert-state-${evaluation.status}`} role={evaluation.status === 'firing' ? 'alert' : 'status'}>
      {evaluation.status === 'firing' ? <BellRing size={20}/> : <ShieldCheck size={20}/>}
      <div>
        <strong>{statusLabels[evaluation.status]}</strong>
        <span>
          否定率 {evaluation.latest ? percent(evaluation.latest.negativeRate) : '—'} / 閾値 {percent(rtiConfig.alert.negativeRateThreshold)}・
          連続 {evaluation.consecutive} / {rtiConfig.alert.consecutiveOccurrences} 回・
          最小 {rtiConfig.alert.minimumSocialCount} 件
        </span>
      </div>
      {evaluation.firedAt !== null && <time dateTime={new Date(evaluation.firedAt).toISOString()}>発動 {fullTime.format(evaluation.firedAt)}</time>}
    </div>

    <div className="social-live-metrics" aria-live="polite">
      <div><span>直近の窓</span><strong>{evaluation.latest ? clockTime.format(evaluation.latest.windowStart) : '—'}</strong><span>{evaluation.latest ? `${clockTime.format(evaluation.latest.windowEnd)} まで` : '取り込み待ち'}</span></div>
      <div><span>投稿数</span><strong>{evaluation.latest?.totalSocialCount ?? 0}<small>件</small></strong><span>窓あたり</span></div>
      <div><span>否定件数</span><strong>{evaluation.latest?.negativeCount ?? 0}<small>件</small></strong><span>合成分類</span></div>
      <div><span>最終取得</span><strong>{updatedAt ? clockTime.format(updatedAt) : '—'}</strong><span>{live ? `${rtiConfig.query.pollIntervalMs / 1000} 秒ごと` : '自動更新は停止中'}</span></div>
    </div>

    <div className="social-live-demo">
      <div className="social-live-demo-head">
        <strong><Send size={14}/>合成 SNS 投稿を送信</strong>
        <span>{label} / 幕 {sentActs} / {demoActs.length}</span>
        <button onClick={resetDemo} disabled={sending || (!sentActs && demoBase === null)}><RotateCcw size={13}/>最初から</button>
      </div>
      <ol className="social-live-demo-acts">
        {demoActs.map((act, index) => {
          const state = index < sentActs ? 'done' : index === sentActs ? 'next' : 'pending';
          return <li key={`${act.phase}-${act.windowOffset}`} className={`demo-act-${state}`}>
            <span className="demo-act-mark" aria-hidden="true">{state === 'done' ? <Check size={12}/> : index + 1}</span>
            <div>
              <strong>{act.title}</strong>
              <span>{act.story}</span>
            </div>
            <em>{act.events} 件{demoBase !== null && <>・{clockTime.format(actWindowStart(demoBase, index))} の窓</>}</em>
          </li>;
        })}
      </ol>
      <div className="social-live-demo-actions">
        <button className="primary" onClick={() => void sendNextAct()} disabled={sending || sentActs >= demoActs.length}>
          <Send size={14}/>{sending ? '送信中…' : sentActs >= demoActs.length ? '全 4 幕を送信済み' : `第 ${sentActs + 1} 幕を送信`}
        </button>
        {demoResult && !demoError && <span className="social-live-demo-result" role="status">{demoResult}</span>}
        {demoError && <span className="social-live-demo-error" role="alert"><AlertTriangle size={13}/>{demoError}</span>}
      </div>
    </div>

    <div className="social-live-chart-toolbar">
      <div role="group" aria-label="表示範囲">{ranges.map(range => (
        <button key={range.minutes} aria-pressed={rangeMinutes === range.minutes} onClick={() => { setRangeMinutes(range.minutes); setSelected(null); }}>{range.label}</button>
      ))}</div>
      <div role="group" aria-label="横軸の並べ方">
        <button aria-pressed={axisMode === 'sequence'} onClick={() => setAxisMode('sequence')}>窓を詰める</button>
        <button aria-pressed={axisMode === 'time'} onClick={() => setAxisMode('time')}>実時間</button>
      </div>
      <span className="social-live-chart-hint">{chartData.length} 窓 / 棒を選ぶと原文を絞り込みます</span>
    </div>

    {chartData.length ? <>
      <div className="social-live-chart">
        <ResponsiveContainer width="100%" height={300} minWidth={0} initialDimension={{ width: 600, height: 300 }}>
          <ComposedChart data={chartData} margin={{ top: 18, right: 16, bottom: 8, left: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--cp-border)" strokeDasharray="3 3"/>
            {axisMode === 'time'
              ? <XAxis dataKey="windowStart" type="number" scale="time" domain={timeDomain} tickFormatter={value => (wideRange ? fullTime : clockTime).format(value)}
                  tick={{ fill: 'var(--cp-text-muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--cp-border-strong)' }} height={40} minTickGap={24}/>
              : <XAxis dataKey="axisLabel" type="category" scale="band" tick={{ fill: 'var(--cp-text-muted)', fontSize: 11 }}
                  tickLine={false} axisLine={{ stroke: 'var(--cp-border-strong)' }} height={40} interval="preserveStartEnd"/>}
            <YAxis yAxisId="count" allowDecimals={false} width={42} tick={{ fill: 'var(--cp-text-muted)', fontSize: 11 }} axisLine={false} tickLine={false}/>
            <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} width={46} unit="%" tick={{ fill: 'var(--cp-text-muted)', fontSize: 11 }} axisLine={false} tickLine={false}/>
            <Tooltip cursor={{ fill: 'var(--cp-accent-soft)' }}
              labelFormatter={(value, payload) => {
                const point = payload?.[0]?.payload as SocialVoiceWindow | undefined;
                return point ? `${fullTime.format(point.windowStart)} から ${rtiConfig.alert.windowMinutes} 分` : String(value);
              }}
              formatter={(value, name) => name === '否定率' ? [`${value}%`, name] : [`${value} 件`, name]}
              contentStyle={{ background: 'var(--cp-surface)', border: '1px solid var(--cp-border)', borderRadius: 4, fontSize: 12 }}
              labelStyle={{ color: 'var(--cp-text)' }}/>
            <Legend verticalAlign="top" height={26} wrapperStyle={{ fontSize: 11 }}/>
            <ReferenceLine yAxisId="rate" y={threshold} stroke="var(--cp-danger)" strokeDasharray="5 4"
              label={{ value: `閾値 ${threshold}%`, position: 'right', fill: 'var(--cp-danger)', fontSize: 11 }}/>
            <Bar yAxisId="count" dataKey="totalSocialCount" name="投稿数" fill="var(--cp-accent)" barSize={barSize} isAnimationActive={false}
              cursor="pointer"
              onClick={entry => {
                const point = (entry as unknown as { payload?: SocialVoiceWindow })?.payload;
                if (!point) return;
                setSelected(current => (current === point.windowStart ? null : point.windowStart));
              }}>
              {chartData.map(point => <Cell key={point.windowStart}
                fill={point.exceeds ? 'var(--cp-danger)' : 'var(--cp-accent)'}
                fillOpacity={selected === null || selected === point.windowStart ? 1 : 0.35}/>)}
            </Bar>
            <Bar yAxisId="count" dataKey="negativeCount" name="否定件数" fill="var(--cp-danger)" barSize={barSize} isAnimationActive={false}/>
            <Line yAxisId="rate" type="monotone" dataKey="negativePercent" name="否定率" stroke="var(--cp-danger)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false}/>
            {chartData.length > 8 && <Brush dataKey={axisMode === 'time' ? 'windowStart' : 'axisLabel'} height={22} travellerWidth={8}
              stroke="var(--cp-border-strong)" fill="var(--cp-surface-soft)"
              tickFormatter={value => typeof value === 'number' ? clockTime.format(value) : String(value)}/>}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {selectedWindow && <div className="social-live-selection" role="status">
        <strong>{fullTime.format(selectedWindow.windowStart)} - {clockTime.format(selectedWindow.windowEnd)}</strong>
        <span>投稿 {selectedWindow.totalSocialCount} 件 / 否定 {selectedWindow.negativeCount} 件 / 否定率 {percent(selectedWindow.negativeRate)}</span>
        <span className={exceedsThreshold(selectedWindow) ? 'social-live-exceeds' : ''}>{exceedsThreshold(selectedWindow) ? '閾値超過' : '閾値内'}</span>
        <button onClick={() => setSelected(null)}><X size={13}/>選択解除</button>
      </div>}
    </> : <p className="empty">この範囲に取り込まれた SNS 口コミはありません。</p>}

    <p className="scope-note">Eventhouse の <code>{rtiConfig.windowFunction}()</code> と <code>{rtiConfig.latestFunction}()</code> を読取り専用で取得しています。表示範囲は KQL 側で絞り込むため、範囲を狭めるほど直近の窓が広く描画されます。「窓を詰める」は空白時間を除いて窓を等間隔に並べ、「実時間」は経過時間どおりに配置します。重複した <code>eventId</code> は最新の受領時刻で 1 件に集約され、同じ ID で内容が異なる投稿は表示対象から除外されます。合成データです。「合成 SNS 投稿を送信」は <code>scripts/generate-social-voice.py</code> の demo モードと同じ 4 幕を生成し、Eventstream を経由せず <code>{rtiConfig.ingestion.tableName}</code> へ直接取り込みます（マッピング <code>{rtiConfig.ingestion.mappingRuleName}</code>、要 Table Ingestor 権限）。</p>
  </section>;
}
