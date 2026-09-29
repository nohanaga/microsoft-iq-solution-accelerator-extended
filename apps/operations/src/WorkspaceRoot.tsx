import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, HardDrive, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { App } from './App';
import { createFixtureAdapter } from './adapter';
import { WorkspaceContext, useWorkspace } from './workspace-context';
import { createWorkspaceRepository } from './workspace-repository';
import type { DataMode, WorkspaceLoadScope } from './workspace-repository';
import type { WorkspaceData } from './workspace-schema';
import { initializeFabricSession, signInToFabric, workspaceClient } from './rayfin-client';
import { clearFabricGraphCache, graphRefreshAuthenticationEvent, graphRefreshNeedsAuthentication, prefetchFabricGraphs, refreshFabricGraphCache } from './fabric-graph-client';
import { graphCacheLifetime } from './fabric-graph-cache';
import { graphAuthenticationEvent, resetInteractiveSignIn, signInToGraph } from './fabric-graph-auth';
import { WorkspaceLoading } from './WorkspaceLoading';
import { GraphActivityStatus } from './GraphCacheStatus';
import { liveConfigured } from './connection-config';
import './workspace-mode.css';

const modeKey = 'micro-coffee-accelerator:data-mode:v3';
function initialMode(): DataMode {
  if (!liveConfigured) return 'memory';
  try { return localStorage.getItem(modeKey) === 'memory' ? 'memory' : 'live'; } catch { return 'live'; }
}
function ModeSelector({ mode, onChange, reload }: { mode: DataMode; onChange: (mode: DataMode) => void; reload: () => void }) {
  return <div className="workspace-session"><div className="workspace-mode"><div role="group" aria-label="データ取得モード">
    <button type="button" aria-pressed={mode === 'live'} onClick={() => onChange('live')}><Database size={14}/>実データ取得モード</button>
    <button type="button" aria-pressed={mode === 'memory'} onClick={() => onChange('memory')}><HardDrive size={14}/>メモリーモード</button>
  </div><button type="button" title="データを再取得" aria-label="データを再取得" onClick={reload}><RefreshCw size={15}/></button>{mode === 'live' && <><FabricSessionControl/><GraphSessionControl/></>}</div>{mode === 'live' && <GraphActivityStatus/>}</div>;
}
function GraphSessionControl() {
  const [required, setRequired] = useState(graphRefreshNeedsAuthentication);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const connected = () => { if (active) { setRequired(false); setError(''); } };
    const needsConnection = () => { if (active) setRequired(true); };
    window.addEventListener(graphAuthenticationEvent, connected);
    window.addEventListener(graphRefreshAuthenticationEvent, needsConnection);
    return () => {
      active = false;
      window.removeEventListener(graphAuthenticationEvent, connected);
      window.removeEventListener(graphRefreshAuthenticationEvent, needsConnection);
    };
  }, []);
  const connect = async () => {
    setPending(true); setError('');
    try { await signInToGraph(); setRequired(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Graph に接続できません。'); }
    finally { setPending(false); }
  };
  if (!required) return null;
  return <><button type="button" disabled={pending} onClick={() => void connect()}><LogIn size={15}/>{pending ? 'Graph 認証中' : 'Graph に接続'}</button>{error && <span role="alert">{error}</span>}</>;
}
function FabricSessionControl() {
  const [authenticated, setAuthenticated] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      const auth = workspaceClient().auth;
      setAuthenticated(auth.getSession().isAuthenticated);
      return auth.onSessionChange(session => setAuthenticated(session?.isAuthenticated ?? false));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '認証設定を確認してください。'); }
  }, []);
  const changeSession = async () => {
    setPending(true); setError('');
    try {
      if (authenticated) await workspaceClient().auth.signOut();
      else await signInToFabric();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '認証に失敗しました。'); }
    finally { setPending(false); }
  };
  return <><button type="button" disabled={pending} onClick={changeSession}>{authenticated ? <LogOut size={15}/> : <LogIn size={15}/>}{pending ? '認証中' : authenticated ? 'サインアウト' : 'Fabric にサインイン'}</button>{error && <span role="alert">{error}</span>}</>;
}
export function WorkspaceModeSelector() {
  const workspace = useWorkspace();
  return <ModeSelector mode={workspace.mode} onChange={workspace.switchMode} reload={workspace.reload}/>;
}
export function WorkspaceRoot() {
  const [mode, setMode] = useState<DataMode>(initialMode);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ data: WorkspaceData; source: string; receivedAt: string; key: string; loadScope: WorkspaceLoadScope } | null>(null);
  const [error, setError] = useState('');
  const [deferred, setDeferred] = useState({ loading: false, error: '' });
  const deferredPromise = useRef<Promise<void> | null>(null);
  const deferredController = useRef<AbortController | null>(null);
  const [authState, setAuthState] = useState({ ready: false, authenticated: false, generation: 0 });
  const key = `${mode}:${revision}:${mode === 'live' ? `${authState.ready}:${authState.authenticated}:${authState.generation}` : ''}`;
  const [repository, setRepository] = useState(() => createWorkspaceRepository(mode));
  const reload = () => { refreshFabricGraphCache(); setRevision(value => value + 1); };
  const switchMode = (next: DataMode) => {
    if (next === mode) return;
    try { localStorage.setItem(modeKey, next); } catch {}
    setMode(next);
  };
  useEffect(() => {
    if (mode !== 'live') return;
    setAuthState(current => ({ ready: false, authenticated: false, generation: current.generation + 1 }));
    try {
      const auth = workspaceClient().auth;
      let active = true;
      let initialized = false;
      let previousUser = auth.getSession().user?.id;
      const unsubscribe = auth.onSessionChange(session => {
        if (active && initialized) {
          const nextUser = session?.isAuthenticated ? session.user?.id : undefined;
          if (!nextUser || nextUser !== previousUser) {
            void clearFabricGraphCache(false);
            void resetInteractiveSignIn().catch(() => {});
          }
          previousUser = nextUser;
          setAuthState(current => ({ ready: true, authenticated: session?.isAuthenticated ?? false, generation: current.generation + 1 }));
        }
      });
      initializeFabricSession().then(() => {
        if (!active) return;
        initialized = true;
        previousUser = auth.getSession().user?.id;
        if (!auth.getSession().isAuthenticated) {
          void clearFabricGraphCache(false);
          void resetInteractiveSignIn().catch(() => {});
        }
        setAuthState(current => ({ ready: true, authenticated: auth.getSession().isAuthenticated, generation: current.generation + 1 }));
      }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '認証に失敗しました。'); });
      return () => { active = false; unsubscribe(); };
    } catch (reason) { setError(reason instanceof Error ? reason.message : '認証設定を確認してください。'); }
  }, [mode]);
  useEffect(() => {
    if (mode !== 'live' || !authState.ready || !authState.authenticated) return;
    const controller = new AbortController();
    const warm = () => { void prefetchFabricGraphs(controller.signal).catch(() => {}); };
    warm();
    const interval = window.setInterval(warm, graphCacheLifetime);
    window.addEventListener(graphAuthenticationEvent, warm);
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener(graphAuthenticationEvent, warm); };
  }, [mode, authState.ready, authState.authenticated, authState.generation, revision]);
  useEffect(() => {
    if (mode === 'live' && !authState.ready) return;
    if (mode === 'live' && !authState.authenticated) { setError('Fabric にサインインしてください。'); return; }
    deferredController.current?.abort();
    deferredController.current = null;
    deferredPromise.current = null;
    setDeferred({ loading: false, error: '' });
    const controller = new AbortController();
    const current = createWorkspaceRepository(mode);
    setRepository(current); setError('');
    const loadScope: WorkspaceLoadScope = mode === 'live' ? 'voices' : 'full';
    const timeout = setTimeout(() => { controller.abort(); setError('データ取得がタイムアウトしました。'); }, 60000);
    current.load(controller.signal, loadScope).then(result => {
      if (!controller.signal.aborted) setLoaded({ ...result, key, loadScope });
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'データを取得できません。'); })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [key, mode, authState.ready, authState.authenticated]);
  const loadDeferred = useCallback(() => {
    if (deferredPromise.current) return deferredPromise.current;
    const controller = new AbortController();
    deferredController.current = controller;
    setDeferred({ loading: true, error: '' });
    const timeout = setTimeout(() => controller.abort('timeout'), 60000);
    const request = repository.load(controller.signal, 'full').then(result => {
      if (!controller.signal.aborted) setLoaded({ ...result, key, loadScope: 'full' });
    }).catch(reason => {
      if (controller.signal.reason === 'timeout') setDeferred({ loading: false, error: '追加データの取得がタイムアウトしました。' });
      else if (!controller.signal.aborted) setDeferred({ loading: false, error: reason instanceof Error ? reason.message : '追加データを取得できません。' });
    }).finally(() => {
      clearTimeout(timeout);
      if (deferredPromise.current === request) deferredPromise.current = null;
      if (deferredController.current === controller) deferredController.current = null;
      if (!controller.signal.aborted) setDeferred(current => ({ ...current, loading: false }));
    });
    deferredPromise.current = request;
    return request;
  }, [repository, key]);
  useEffect(() => {
    if (!loaded || loaded.key !== key || loaded.loadScope === 'full') return;
    void loadDeferred();
  }, [loaded, key, loadDeferred]);
  if (!loaded || loaded.key !== key) return error ? <main className="workspace-loading">
    <h1>データを取得できません</h1><ModeSelector mode={mode} onChange={switchMode} reload={reload}/>
    <p role="alert">{error}</p>
  </main> : <WorkspaceLoading graphStatus={mode === 'live' ? <GraphActivityStatus/> : undefined}/>;
  const adapter = createFixtureAdapter();
  adapter.load = async signal => { signal.throwIfAborted(); return structuredClone(loaded.data.operations); };
  return <WorkspaceContext.Provider value={{ ...loaded, mode, repository, deferredLoading: deferred.loading, deferredError: deferred.error, loadDeferred, switchMode, reload }}>
    <App key={key} adapter={adapter}/>
  </WorkspaceContext.Provider>;
}