import { useEffect, useRef, useState } from 'react';
import { Bot, Database, ExternalLink, LogIn, MonitorCog, RotateCcw, Send, Square, X } from 'lucide-react';
import { CopilotSignInRequiredError } from './copilot';
import type { CopilotContext, CopilotHistoryLoader, CopilotQuery, CopilotReference, CopilotTrace } from './copilot';
import { uiCommandLabel } from './copilot-ui-command';
import type { UiCommand } from './copilot-ui-command';
import { Markdown } from './markdown';
import { JsonView } from './json-view';

const conversationStorageKey = 'micro-coffee-demo:data-copilot-conversation:v1';
const widthStorageKey = 'micro-coffee-demo:data-copilot-width:v1';
const minWidth = 300;
const maxWidth = 960;

/** 画面操作ツールごとの文例。ID と値は v3/data の実レコードに合わせてある。 */
const commandExamples: { group: string; items: { label: string; text: string }[] }[] = [
  {
    group: '画面の切り替え（ui_navigate）',
    items: [
      { label: '供給と注文を開く', text: '供給と注文の画面を開いてください。' },
      { label: 'ブレンド調合 DEV-002 を開く', text: 'ブレンド調合の画面（DEV-002）を開いてください。' },
      { label: '顧客の声へ戻る', text: '顧客の声の画面へ戻ってください。' },
    ],
  },
  {
    group: '顧客の声の絞り込み（customer_voice_propose_filter）',
    items: [
      { label: 'PRD-002 を SNS 口コミだけにする', text: '顧客の声を、バニラクリーム水出し珈琲（PRD-002）の SNS 口コミだけに絞り込んでください。期間は 2026-06-01 から 2026-07-08 です。' },
      { label: '神田店・話題「甘さ控えめ」', text: '顧客の声を神田店（STR-04）だけにして、話題を「甘さ控えめ」で絞り込んでください。情報源はすべてのままで構いません。' },
      { label: '全店舗・EC チャットだけを見る', text: '顧客の声を全店舗（STR-01 から STR-06）に戻し、情報源を EC チャットだけにしてください。期間は 2026-05-01 から 2026-07-08 です。' },
    ],
  },
  {
    group: '商品開発の試算（development_propose_scenario）',
    items: [
      { label: 'オリジナルブレンド 案 B を 200 袋', text: 'オリジナルブレンド（DEV-BLEND）の案 B（BLEND-B）を、中央製造拠点（CENTRAL）で 200 袋つくる試算に切り替えてください。' },
      { label: 'ラテをカスタム配合 BR60:CO40 で 500 杯', text: 'オリジナルラテ（DEV-LATTE）を案 A（LATTE-A）を基準にして、ROASTED-BR 60%、ROASTED-CO 40% のカスタム配合で 500 杯を試算してください。製造拠点は CENTRAL です。' },
      { label: 'ハウスドリップ 案 B を 800 杯', text: 'ハウスドリップ（DEV-DRIP）の案 B（DRIP-B）を、中央製造拠点（CENTRAL）で 800 杯つくる試算にしてください。' },
    ],
  },
  {
    group: '供給と注文の絞り込み（supply_propose_filter）',
    items: [
      { label: '神田店の 7 月の遅延便＋影響', text: '供給と注文で、神田店（STR-04）の 2026-07-01 から 2026-07-31 の入荷便のうち遅延しているものだけを表示し、グラフは注文への影響にしてください。' },
      { label: '取消された注文だけを見る', text: '供給と注文を注文タブに切り替えて、状態が取消（cancelled）の注文だけを表示してください。店舗と期間の絞り込みは外してください。' },
      { label: '相模焙煎工房の便を供給網で見る', text: '供給と注文で、供給会社を相模焙煎工房（SUP-02）に絞り、入荷便タブで状態はすべて、グラフは供給網にしてください。' },
    ],
  },
  {
    group: 'オントロジーのレコード選択（ontology_select_record）',
    items: [
      { label: '入荷便 SHP-JP-0703-04 を選ぶ', text: '供給のオントロジーで、入荷便（shipments）の SHP-JP-0703-04 を選択してください。' },
      { label: '欠品記録 IMPACT-04 を選ぶ', text: '供給のオントロジーで、欠品記録（supplyImpacts）の IMPACT-04 を選択してください。' },
      { label: '焙煎豆 ROASTED-CO を選ぶ', text: '商品開発のオントロジーで、焙煎豆（materials）の ROASTED-CO を選択してください。' },
    ],
  },
  {
    group: '根拠を開く（copilot_open_reference / 要・直前の根拠つき回答）',
    items: [
      { label: '豆原価管理規定の原文を開く', text: 'いまの回答で示した根拠のうち、豆原価管理規定の原文を開いてください。' },
    ],
  },
  {
    group: '調査と画面操作を続けて行う',
    items: [
      { label: '神田店の 7 月の遅延を調べて画面も合わせる', text: '神田店（STR-04）で 2026 年 7 月に遅延した入荷便と、それに紐づく欠品記録を調べてください。あわせて、供給と注文の画面もその条件に合わせてください。' },
      { label: '甘さ控えめの要望から配合案へ', text: 'バニラクリーム水出し珈琲（PRD-002）の「甘さ控えめ」の声を確認したうえで、顧客の声の画面をその条件に絞り込んでください。そのあとオリジナルブレンド（DEV-BLEND）の案 B（BLEND-B）を 100 袋で試算する画面へ切り替えてください。' },
    ],
  },
];

function matchesReference(reference: CopilotReference, openedId: string) {
  if (openedId.length < 2) return false;
  if (reference.id === openedId) return true;
  const label = reference.label.toLowerCase();
  const target = openedId.toLowerCase();
  return label.includes(target) || target.includes(label);
}

function clampWidth(value: number) {
  const limit = Math.min(maxWidth, Math.max(minWidth, window.innerWidth - 320));
  return Math.round(Math.min(limit, Math.max(minWidth, value)));
}

function storedWidth() {
  try { return clampWidth(Number(localStorage.getItem(widthStorageKey)) || 360); }
  catch { return 360; }
}

function storedConversationId() {
  try { return localStorage.getItem(conversationStorageKey) ?? ''; }
  catch { return ''; }
}

function storeConversationId(conversationId: string) {
  try {
    if (conversationId) localStorage.setItem(conversationStorageKey, conversationId);
    else localStorage.removeItem(conversationStorageKey);
  } catch {
    // The server remains the source of truth when browser storage is unavailable.
  }
}

interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  context: string;
  sourceLabel?: string;
  references?: CopilotReference[];
  trace?: CopilotTrace;
  uiCommands?: UiCommand[];
}
interface RetryRequest { conversationId: string; messageId: string; question: string }
interface DataCopilotProps { open: boolean; onClose: () => void; context: CopilotContext; onAsk: CopilotQuery; onLoadHistory: CopilotHistoryLoader; onSignIn: () => Promise<void>; onCancelSignIn: () => void; onResetSignIn: () => Promise<void>; onUiCommands: (commands: UiCommand[]) => void; suggestion?: { id: string; text: string } }

type DetailTab = 'context' | 'request' | 'tools' | 'reasoning' | 'response';

function MessageDetails({ context, trace }: { context: string; trace?: CopilotTrace }) {
  const [tab, setTab] = useState<DetailTab>('context');
  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'context', label: '照会時の対象' },
    ...(trace ? [
      { id: 'request' as const, label: '送信内容' },
      { id: 'tools' as const, label: `ツール実行 ${trace.toolRuns.length}` },
      { id: 'reasoning' as const, label: `推論ログ ${trace.reasoning.length}` },
      { id: 'response' as const, label: '応答 JSON' },
    ] : []),
  ];
  return <details className="copilot-message-details">
    <summary>詳細</summary>
    <div className="copilot-detail-tabs" role="tablist" aria-label="この対話の詳細">
      {tabs.map(entry => <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => setTab(entry.id)}>{entry.label}</button>)}
    </div>
    <div className="copilot-detail-panel" role="tabpanel">
      {tab === 'context' && <p>{context}</p>}
      {tab === 'request' && trace && <JsonView text={trace.request} label="request"/>}
      {tab === 'tools' && (trace?.toolRuns.length
        ? trace.toolRuns.map(run => <section key={run.id}><h4>{run.label}{run.status ? ` / ${run.status}` : ''}</h4><JsonView text={run.detail} label={run.label}/></section>)
        : <p>このターンでツール実行は記録されていません。</p>)}
      {tab === 'reasoning' && (trace?.reasoning.length
        ? trace.reasoning.map((entry, index) => <p key={index}>{entry}</p>)
        : <p>推論ログは応答に含まれていません。要約を返す設定の Agent でのみ表示されます。</p>)}
      {tab === 'response' && trace && <JsonView text={trace.response} label="response"/>}
    </div>
  </details>;
}

export function DataCopilot({ open, onClose, context, onAsk, onLoadHistory, onSignIn, onCancelSignIn, onResetSignIn, onUiCommands, suggestion }: DataCopilotProps) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [openedReferenceId, setOpenedReferenceId] = useState('');
  const [conversationId, setConversationId] = useState(storedConversationId);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [connection, setConnection] = useState<'ready' | 'connected' | 'error'>('ready');
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [lastRequest, setLastRequest] = useState<RetryRequest>();
  const [overlay, setOverlay] = useState(() => matchMedia('(max-width: 1100px)').matches);
  const [width, setWidth] = useState(storedWidth);
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const restoredRef = useRef(false);
  useEffect(() => { if (suggestion) { setDraft(suggestion.text); inputRef.current?.focus(); } }, [suggestion]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else { requestRef.current?.abort(); requestRef.current = null; setPending(false); }
  }, [open]);
  useEffect(() => {
    if (!open || restoredRef.current) {
      setRestoring(false);
      return;
    }
    restoredRef.current = true;
    if (!conversationId) return;
    const controller = new AbortController();
    setRestoring(true);
    void onLoadHistory(conversationId, controller.signal).then(history => {
      if (controller.signal.aborted) return;
      if (!history.conversationId) {
        setConversationId('');
        storeConversationId('');
        return;
      }
      setMessages(history.messages.map(message => ({ ...message, sourceLabel: message.role === 'assistant' ? 'Foundry Agent' : undefined })));
      setConnection(history.messages.length ? 'connected' : 'ready');
    }).catch(reason => {
      if (!controller.signal.aborted) {
        setConnection('error');
        setError(reason instanceof Error ? reason.message : '会話履歴を取得できませんでした。');
      }
    }).finally(() => { if (!controller.signal.aborted) setRestoring(false); });
    return () => controller.abort();
  }, [conversationId, onLoadHistory, open]);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  useEffect(() => {
    const media = matchMedia('(max-width: 1100px)');
    const resize = () => setOverlay(media.matches);
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--copilot-width', `${width}px`);
    try { localStorage.setItem(widthStorageKey, String(width)); } catch { /* 幅はこのページだけに保持します。 */ }
  }, [width]);
  useEffect(() => {
    const fit = () => setWidth(value => clampWidth(value));
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !overlay || !panel?.parentElement) return;
    const siblings = [...panel.parentElement.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== panel && !element.classList.contains('copilot-backdrop'));
    const previous = siblings.map(element => element.inert);
    siblings.forEach(element => { element.inert = true; });
    inputRef.current?.focus();
    return () => {
      siblings.forEach((element, index) => { element.inert = previous[index]; });
      if (panel.hidden) document.querySelector<HTMLButtonElement>('.copilot-toggle')?.focus();
    };
  }, [open, overlay]);
  useEffect(() => { if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [messages, pending, error, open]);

  const cancel = () => { requestRef.current?.abort(); requestRef.current = null; setPending(false); };
  const send = async (question: string, retry?: RetryRequest) => {
    const text = question.trim();
    if (!text || requestRef.current || restoring) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const label = context.label;
    const activeConversationId = (retry?.conversationId ?? conversationId) || crypto.randomUUID();
    const messageId = retry?.messageId ?? crypto.randomUUID();
    const history = messages.slice(-12).map(({ role, text: content }) => ({ role, text: content }));
    setMessages(previous => [...previous, { id: messageId, role: 'user', text, context: label }]);
    setConversationId(activeConversationId);
    storeConversationId(activeConversationId);
    setDraft(''); setError(''); setAuthRequired(false); setPending(true); setLastRequest({ conversationId: activeConversationId, messageId, question: text });
    const timeout = setTimeout(() => {
      if (requestRef.current === controller) { cancel(); setError('応答がタイムアウトしました。'); }
    }, 170_000);
    try {
      const response = await onAsk({ conversationId: activeConversationId, messageId, question: text, context, history }, controller.signal, label => {
        if (requestRef.current === controller) setProgress(label);
      });
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setConversationId(response.conversationId);
      storeConversationId(response.conversationId);
      setConnection('connected');
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'assistant', text: response.text, context: response.contextLabel ?? label, sourceLabel: response.sourceLabel, references: response.references, trace: response.trace, uiCommands: response.uiCommands }]);
      const commands = response.uiCommands ?? [];
      if (commands.length) onUiCommands(commands);
      const openReference = commands.filter(command => command.type === 'copilot.openReference').pop();
      if (openReference) setOpenedReferenceId(openReference.referenceId);
    } catch (reason) {
      setMessages(previous => previous.filter(message => message.id !== messageId));
      if (!controller.signal.aborted) {
        setConnection('error');
        setAuthRequired(reason instanceof CopilotSignInRequiredError);
        setError(reason instanceof Error ? reason.message : '回答を取得できませんでした。');
      }
    } finally {
      clearTimeout(timeout);
      if (requestRef.current === controller) { requestRef.current = null; setPending(false); setProgress(''); }
    }
  };
  const connectFoundry = async () => {
    if (signingIn || !lastRequest) return;
    setSigningIn(true); setError('別ウィンドウで認証を続けてください。表示されない場合は、ポップアップを許可してください。');
    try {
      await onResetSignIn();
      await onSignIn();
      setAuthRequired(false);
      await send(lastRequest.question, lastRequest);
    } catch (reason) {
      setConnection('error');
      setError(reason instanceof Error ? reason.message : 'Foundry にサインインできませんでした。');
    } finally {
      setSigningIn(false);
    }
  };
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    setResizing(true);
    const move = (moveEvent: PointerEvent) => setWidth(clampWidth(window.innerWidth - moveEvent.clientX));
    const stop = () => {
      setResizing(false);
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };
  return <aside id="data-copilot" ref={panelRef} className={`data-copilot${resizing ? ' is-resizing' : ''}`} role={overlay ? 'dialog' : 'complementary'} aria-modal={overlay && open ? true : undefined} aria-label="Data Copilot" hidden={!open} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'Tab' && overlay) {
      const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, summary')].filter(element => element.getClientRects().length);
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="copilot-resizer" role="separator" aria-orientation="vertical" aria-controls="data-copilot" aria-label="Data Copilot の幅" aria-valuenow={width} aria-valuemin={minWidth} aria-valuemax={maxWidth} aria-valuetext={`${width} ピクセル`} title="ドラッグで幅を変更、左右キーで調整、ダブルクリックで元に戻す" tabIndex={0} onPointerDown={startResize} onDoubleClick={() => setWidth(clampWidth(360))} onKeyDown={event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); setWidth(value => clampWidth(value + 24)); }
      if (event.key === 'ArrowRight') { event.preventDefault(); setWidth(value => clampWidth(value - 24)); }
      if (event.key === 'Home') { event.preventDefault(); setWidth(clampWidth(maxWidth)); }
      if (event.key === 'End') { event.preventDefault(); setWidth(minWidth); }
    }}/>
    <header className="copilot-header"><div><Bot size={21}/><h2>Data Copilot</h2></div><div><button type="button" title="会話をクリア" aria-label="会話をクリア" disabled={!messages.length && !error} onClick={() => { cancel(); setMessages([]); setConversationId(''); storeConversationId(''); setConnection('ready'); setError(''); setAuthRequired(false); setLastRequest(undefined); }}><RotateCcw size={16}/></button><button type="button" title="Data Copilot を閉じる" aria-label="Data Copilot を閉じる" onClick={onClose}><X size={18}/></button></div></header>
    <div className="copilot-context"><span className="badge">Foundry Agent</span><p>{context.label}</p></div>
    <div className="copilot-log" ref={logRef} role="log" aria-label="Copilot の会話" aria-live="polite" aria-relevant="additions text">
      {!messages.length && !restoring && <div className="copilot-empty"><Database size={26}/><h3>分析対象</h3><p>{context.page === 'reviews' ? '顧客の声' : context.page === 'blend' ? 'ブレンド開発' : context.page === 'development' ? '商品開発' : '供給と注文'}</p><span>合成データ / Foundry Agent</span></div>}
      {messages.map(message => <article className={`copilot-message copilot-${message.role}`} key={message.id}><header>{message.role === 'user' ? 'あなた' : <><Bot size={14}/>Data Copilot</>}<span>{message.sourceLabel ?? ''}</span></header>{message.role === 'assistant' ? <Markdown text={message.text}/> : <p>{message.text}</p>}{!!message.uiCommands?.length && <ul className="copilot-ui-commands" aria-label="画面に適用した操作">{message.uiCommands.map(command => <li key={command.commandId}><MonitorCog size={13}/>{uiCommandLabel(command)}</li>)}</ul>}<MessageDetails context={message.context} trace={message.trace}/>{!!message.references?.length && <details className="copilot-references" open={message.references.some(reference => matchesReference(reference, openedReferenceId))}><summary>根拠原文 {message.references.length} 件</summary>{message.references.map(reference => <blockquote key={reference.id} className={matchesReference(reference, openedReferenceId) ? 'is-opened' : undefined}><code>{reference.label}</code><p>{reference.text}</p>{reference.url && <a href={reference.url} target="_blank" rel="noreferrer">原文を開く<ExternalLink size={12}/></a>}</blockquote>)}</details>}</article>)}
      {(pending || restoring) && <div className="copilot-progress" role="status" aria-live="polite" aria-atomic="true"><div className="copilot-progress-status"><span className="copilot-progress-pulse" aria-hidden="true"/><span>{restoring ? '会話を復元しています' : progress || 'Agent へ質問を送信しています'}</span>{!restoring && <time>{elapsed} 秒</time>}</div><div className="copilot-progress-track" aria-hidden="true"><span/></div></div>}
      {(error || signingIn) && <div className="copilot-error" role="alert">{error && <p>{error}</p>}{authRequired && lastRequest ? signingIn ? <button type="button" onClick={onCancelSignIn}><Square size={14}/>認証を中止</button> : <button type="button" onClick={() => void connectFoundry()}><LogIn size={14}/>Foundry にサインイン</button> : lastRequest && <button type="button" onClick={() => void send(lastRequest.question, lastRequest)}><RotateCcw size={14}/>再試行</button>}</div>}
    </div>
    <div className="copilot-compose"><label className="copilot-examples"><span><MonitorCog size={13}/>画面を動かす文例</span><select aria-label="画面を動かす文例" value="" disabled={pending || restoring} onChange={event => { if (!event.target.value) return; setDraft(event.target.value); inputRef.current?.focus(); }}><option value="">文例を選ぶと入力欄に入ります</option>{commandExamples.map(group => <optgroup key={group.group} label={group.group}>{group.items.map(item => <option key={item.label} value={item.text}>{item.label}</option>)}</optgroup>)}</select></label>
      <div className="copilot-suggestions">{(context.page === 'reviews' ? ['商品追加の案を提案して', '店舗別の否定率は？', '話題別の内訳は？'] : ['候補の影響は？', '以前の見送り理由は？', 'ブレンドの調達は？']).map(question => <button key={question} disabled={pending || restoring} onClick={() => void send(question)}>{question}</button>)}</div>
      <form onSubmit={event => { event.preventDefault(); void send(draft); }}><label className="sr-only" htmlFor="copilot-question">Data Copilot への質問</label><textarea id="copilot-question" ref={inputRef} rows={3} maxLength={1000} value={draft} disabled={restoring} onChange={event => setDraft(event.target.value)} placeholder="分析内容を入力" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }}/>{pending ? <button type="button" title="照会を中止" aria-label="照会を中止" onClick={cancel}><Square size={16}/></button> : <button className="primary" type="submit" disabled={!draft.trim() || restoring} title="質問を送信" aria-label="質問を送信"><Send size={17}/></button>}</form>
      <div className="copilot-connections"><span>Fabric Data agent <strong>未接続</strong></span><span>Foundry Agent <strong>{connection === 'connected' ? '接続済み' : connection === 'error' ? '接続エラー' : '待機'}</strong></span></div>
    </div>
  </aside>;
}