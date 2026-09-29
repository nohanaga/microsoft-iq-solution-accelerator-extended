import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from 'lucide-react';
import { buildDemoScenario, demoOptions, transitionDemo } from './demo-scenarios';
import type { DemoId, DemoRun, DemoScenario } from './demo-scenarios';
import type { UiCommand } from './copilot-ui-command';
import type { ReviewFilter } from './domain';
import { useWorkspace } from './workspace-context';

interface Props {
  filter: ReviewFilter;
  onCommands: (commands: UiCommand[]) => string[];
  onCapture: () => () => void;
  onActiveChange: (active: boolean) => void;
}

export function DemoPlayer({ filter, onCommands, onCapture, onActiveChange }: Props) {
  const workspace = useWorkspace();
  const [chooser, setChooser] = useState(false);
  const [id, setId] = useState<DemoId>('supply');
  const [scenario, setScenario] = useState<DemoScenario | null>(null);
  const [run, setRun] = useState<DemoRun>({ index: 0, phase: 'paused', autoplay: false, error: '' });
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState('');
  const [stepRevision, setStepRevision] = useState(0);
  const expectedCommand = useRef('');
  const trigger = useRef<HTMLButtonElement>(null);
  const restore = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const bar = useRef<HTMLElement>(null);
  const step = scenario?.steps[run.index];
  const apply = (next: DemoScenario, index: number, autoplay: boolean) => {
    generation.current += 1;
    const commands = next.steps[index].commands.map(command => ({ ...structuredClone(command), commandId: crypto.randomUUID() }));
    expectedCommand.current = commands.at(-1)?.commandId ?? '';
    const failures = onCommands(commands);
    setStepRevision(current => current + 1);
    setRun({ index, autoplay: failures.length ? false : autoplay, phase: failures.length ? 'error' : 'waiting', error: failures.join(' / ') });
  };
  const begin = () => {
    try {
      if (id !== 'voices' && workspace.loadScope !== 'full') throw new Error('追加データの取得完了後に開始してください。');
      const next = buildDemoScenario(id, workspace.data.development, workspace.data.operations, workspace.mode, filter);
      if (!window.confirm('デモの表示条件・下書きへ切り替えます。終了時に開始前の状態へ戻せます。開始しますか？')) return;
      restore.current = onCapture();
      setScenario(next); setChooser(false); setError(''); onActiveChange(true); apply(next, 0, false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '開始できません。'); }
  };
  const close = (restoreState: boolean) => {
    generation.current += 1;
    if (restoreState) restore.current?.();
    restore.current = null; setScenario(null); onActiveChange(false); setRun(current => transitionDemo(current, { type: 'pause' })); trigger.current?.focus();
  };
  useEffect(() => {
    if (!scenario || !step || run.phase !== 'waiting') return;
    const version = scenario.id === 'voices' ? workspace.data.operations.version : workspace.data.development.version;
    if (version !== scenario.dataVersion) { setRun(current => transitionDemo(current, { type: 'fail', message: 'データ版が変わったため停止しました。' })); return; }
    const activeGeneration = generation.current;
    let frame = 0;
    const inspect = () => {
      if (generation.current !== activeGeneration) return;
      if (document.querySelector('[data-demo-command]')?.getAttribute('data-demo-command') !== expectedCommand.current) return;
      const command = step.commands.at(-1);
      const page = command?.type === 'supply.setCase' ? command.edit ? 'blend' : 'supply'
        : command?.type === 'development.setScenario' ? command.view === 'blend' ? 'blend' : 'development'
          : command?.type === 'reviews.setFilter' ? 'reviews' : undefined;
      if (page && document.querySelector('[data-demo-page]')?.getAttribute('data-demo-page') !== page) return;
      const target = document.querySelector<HTMLElement>(`[data-demo-target="${step.target}"]`);
      if (!target || !target.getBoundingClientRect().width) return;
      const state = target.dataset.demoState;
      if (['error', 'auth', 'partial', 'unavailable'].includes(state ?? '')) {
        setRun(current => transitionDemo(current, { type: 'fail', message: '対象の取得失敗・認証待ち・部分取得です。画面の状態を確認してください。' })); return;
      }
      if (state === 'loading' || state === 'empty' || (step.requiresGraph && state !== 'ready')) return;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (generation.current === activeGeneration) setRun(current => transitionDemo(current, { type: 'ready' }));
      });
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-demo-state', 'data-demo-page', 'data-demo-command'] });
    const timeout = window.setTimeout(() => {
      if (generation.current === activeGeneration) setRun(current => current.phase === 'waiting' ? transitionDemo(current, { type: 'fail', message: '対象の準備完了を確認できませんでした。' }) : current);
    }, 25000);
    inspect();
    return () => { observer.disconnect(); clearTimeout(timeout); cancelAnimationFrame(frame); };
  }, [scenario, step, run.phase, run.index, stepRevision, workspace.data]);
  useEffect(() => {
    if (!step || !['ready', 'complete'].includes(run.phase)) return;
    const target = document.querySelector<HTMLElement>(`[data-demo-target="${step.target}"]`);
    if (!target) return;
    target.classList.add('demo-highlight');
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    return () => target.classList.remove('demo-highlight');
  }, [step, run.phase]);
  useEffect(() => {
    if (!scenario || run.phase !== 'ready' || !run.autoplay || step?.manual) return;
    const activeGeneration = generation.current;
    const timer = window.setTimeout(() => {
      if (generation.current !== activeGeneration) return;
      if (run.index + 1 < scenario.steps.length) apply(scenario, run.index + 1, true);
      else setRun(current => transitionDemo(current, { type: 'finish' }));
    }, 6000 / speed);
    return () => clearTimeout(timer);
  }, [scenario, run.index, run.phase, run.autoplay, speed, step]);
  useEffect(() => {
    if (!scenario) return;
    const pause = (event: Event) => {
      if (bar.current?.contains(event.target as Node) || (event.target as Element | null)?.closest('.theme-picker')) return;
      generation.current += 1;
      setRun(current => transitionDemo(current, { type: 'pause' }));
    };
    document.addEventListener('pointerdown', pause, true);
    document.addEventListener('keydown', pause, true);
    return () => { document.removeEventListener('pointerdown', pause, true); document.removeEventListener('keydown', pause, true); };
  }, [scenario]);
  useEffect(() => {
    if (scenario) bar.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [scenario]);
  const move = (index: number) => { if (scenario && index >= 0 && index < scenario.steps.length) apply(scenario, index, false); };
  return <>
    <button ref={trigger} title="デモシナリオ" aria-label="デモシナリオを選択" aria-expanded={chooser || !!scenario} onClick={() => scenario ? bar.current?.focus() : setChooser(current => !current)}><Play size={16}/></button>
    {chooser && <section className="demo-chooser" aria-label="デモシナリオの選択"><label>シナリオ<select value={id} onChange={event => setId(event.target.value as DemoId)}>{demoOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><button onClick={begin}><Play size={15}/>ガイドを開始</button><button title="閉じる" aria-label="シナリオ選択を閉じる" onClick={() => { setChooser(false); trigger.current?.focus(); }}><X size={16}/></button>{error && <p role="alert">{error}</p>}</section>}
    {scenario && step && <section className="demo-player" ref={bar} tabIndex={-1} aria-label="シナリオ進行" onKeyDown={event => { if (event.key === 'Escape') { generation.current += 1; setRun(current => transitionDemo(current, { type: 'pause' })); } }}>
      <div className="demo-step"><span>{demoOptions.find(option => option.id === scenario.id)?.label} / v{scenario.version} / {run.index + 1} of {scenario.steps.length}</span><strong>{step.title}</strong><p>{step.question}</p><span role="status">{run.phase === 'waiting' ? '準備待ち' : run.phase === 'error' ? run.error : run.phase === 'complete' ? '確認終了' : run.phase === 'paused' ? '一時停止' : step.manual ? '手動確認待ち' : run.autoplay ? '自動再生中' : 'ガイド'}</span></div>
      <div className="demo-controls"><button title="最初から" aria-label="デモを最初から" onClick={() => move(0)}><RotateCcw size={16}/></button><button title="前のステップ" aria-label="前のステップ" disabled={run.index === 0} onClick={() => move(run.index - 1)}><ChevronLeft size={18}/></button>
        <button title={run.autoplay ? '一時停止' : '自動再生'} aria-label={run.autoplay ? 'デモを一時停止' : 'デモを自動再生'} disabled={!!step.manual} onClick={() => { generation.current += 1; setRun(current => transitionDemo(current, current.autoplay ? { type: 'pause' } : { type: 'resume', autoplay: true })); }}>{run.autoplay ? <Pause size={16}/> : <Play size={16}/>}</button>
        <button title={run.index === scenario.steps.length - 1 ? '確認終了' : '次のステップ'} aria-label="次のステップ" disabled={run.phase !== 'ready'} onClick={() => run.index === scenario.steps.length - 1 ? setRun(current => transitionDemo(current, { type: 'finish' })) : move(run.index + 1)}><ChevronRight size={18}/></button>
        {['error', 'paused'].includes(run.phase) && <button onClick={() => apply(scenario, run.index, false)}><RotateCcw size={15}/>ステップを再適用</button>}
        <label>速度<select aria-label="デモ再生速度" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option></select></label>
        <button onClick={() => close(true)}>開始前へ戻して終了</button><button title="現在の下書きを残して終了" aria-label="現在の下書きを残してデモを終了" onClick={() => close(false)}><X size={16}/></button>
      </div>
    </section>}
  </>;
}