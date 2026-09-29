import { EventType, PublicClientApplication } from '@azure/msal-browser';
import type { AuthenticationResult, PopupEvent } from '@azure/msal-browser';
import { graphAuthConfig as config } from './connection-config';
import { workspaceClient } from './rayfin-client';
import { graphSnapshotUserId } from './graph-snapshot-repository';

let application: Promise<PublicClientApplication> | undefined;
let activePopup: Window | undefined;
let cancelInteractive: (() => void) | undefined;
const pendingTokens = new Map<string, Promise<string>>();
const pendingInteractive = new Map<string, Promise<void>>();
const silentFailures = new Map<string, number>();
export const graphAuthenticationEvent = 'maikuro:graph-authenticated';
let authGeneration = 0;

export class GraphSignInRequiredError extends Error {
  constructor() {
    super('Graph にサインインしてください。');
    this.name = 'GraphSignInRequiredError';
  }
}

export class SignInInProgressError extends Error {
  constructor(resourceLabel: string) {
    super(`${resourceLabel} の別の認証処理が進行中です。認証を中止して再試行してください。`);
    this.name = 'SignInInProgressError';
  }
}

function isInteractionInProgress(reason: unknown) {
  return typeof reason === 'object' && reason !== null && 'errorCode' in reason
    ? reason.errorCode === 'interaction_in_progress'
    : reason instanceof Error && reason.message.includes('interaction_in_progress');
}

function authErrorCode(reason: unknown) {
  if (typeof reason === 'object' && reason !== null && 'errorCode' in reason && typeof reason.errorCode === 'string') return reason.errorCode;
  return '';
}

function graphApplication() {
  return application ??= (async () => {
    if (!config.tenantId || !config.clientId) throw new Error('Graph の認証設定がありません。');
    const client = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        redirectUri: new URL('/auth.html', window.location.origin).href,
        popupRelayUri: new URL('/popup-relay.html', window.location.origin).href,
      },
      // sessionStorage にすると再読み込み後も acquireTokenSilent が通り、タブを閉じるとトークンが消える。
      cache: { cacheLocation: 'sessionStorage' },
      system: { navigatePopups: true, popupBridgeTimeout: 90_000 },
    });
    client.addEventCallback(event => {
      if (event.eventType === EventType.POPUP_OPENED) activePopup = (event.payload as PopupEvent).popupWindow;
    });
    await client.initialize();
    return client;
  })().catch(reason => { application = undefined; throw reason; });
}

function currentEmail() {
  const session = workspaceClient().auth.getSession();
  if (!session.isAuthenticated || !session.user?.email) throw new Error('Fabric にサインインしてください。');
  return session.user.email.toLowerCase();
}

export function graphCacheIdentity() {
  return JSON.stringify([config.tenantId, config.clientId, graphSnapshotUserId(), currentEmail(), [...config.scopes].sort()]);
}

function sameUser(result: AuthenticationResult, email: string, resourceLabel: string) {
  if (result.account?.tenantId !== config.tenantId || result.account.username.toLowerCase() !== email || currentEmail() !== email) {
    throw new Error(`現在の Fabric ユーザーと同じアカウントで ${resourceLabel} にサインインしてください。`);
  }
  return result.accessToken;
}

export function signInForScopes(scopes: string[], resourceLabel: string): Promise<void> {
  let email: string;
  try { email = currentEmail(); } catch (reason) { return Promise.reject(reason); }
  const generation = authGeneration;
  const key = JSON.stringify([email, [...scopes].sort(), generation]);
  const existing = pendingInteractive.get(key);
  if (existing) return existing;
  const request = (async () => {
    const client = await graphApplication();
    let cancelRequest: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      cancelRequest = () => reject(new Error(`${resourceLabel} の認証を中止しました。`));
      cancelInteractive = cancelRequest;
    });
    try {
      const result = await Promise.race([client.acquireTokenPopup({ scopes, loginHint: email }), cancelled]);
      if (generation !== authGeneration) throw new GraphSignInRequiredError();
      sameUser(result, email, resourceLabel);
      silentFailures.delete(key);
      if (config.scopes.every(scope => scopes.includes(scope))) window.dispatchEvent(new Event(graphAuthenticationEvent));
    } finally {
      if (cancelInteractive === cancelRequest) cancelInteractive = undefined;
    }
  })().catch(reason => {
    if (isInteractionInProgress(reason)) throw new SignInInProgressError(resourceLabel);
    const code = authErrorCode(reason);
    if (code === 'timed_out' || code === 'monitor_popup_timeout') {
      throw new Error(`${resourceLabel} の認証が時間切れになりました。ブラウザーでこのサイトのポップアップを許可して再試行してください。`);
    }
    if (code === 'user_cancelled') throw new Error(`${resourceLabel} の認証を中止しました。`);
    if (code === 'empty_window_error' || code === 'popup_window_error') {
      throw new Error(`${resourceLabel} の認証ウィンドウを開けません。ブラウザーでこのサイトのポップアップを許可してください。`);
    }
    throw reason;
  }).finally(() => { activePopup = undefined; pendingInteractive.delete(key); });
  pendingInteractive.set(key, request);
  return request;
}

export function getAccessTokenForScopes(scopes: string[], resourceLabel: string): Promise<string> {
  let email: string;
  try { email = currentEmail(); } catch (reason) { return Promise.reject(reason); }
  const generation = authGeneration;
  const key = JSON.stringify([email, [...scopes].sort(), generation]);
  if ((silentFailures.get(key) ?? 0) > Date.now()) return Promise.reject(new GraphSignInRequiredError());
  const existing = pendingTokens.get(key);
  if (existing) return existing;
  const request = (async () => {
    const client = await graphApplication();
    const account = client.getAllAccounts().find(candidate => candidate.tenantId === config.tenantId && candidate.username.toLowerCase() === email);
    let result: AuthenticationResult;
    try {
      result = account
        ? await client.acquireTokenSilent({ scopes, account })
        : await client.ssoSilent({ scopes, loginHint: email });
    } catch {
      if (generation === authGeneration) silentFailures.set(key, Date.now() + 30_000);
      throw new GraphSignInRequiredError();
    }
    if (generation !== authGeneration) throw new GraphSignInRequiredError();
    silentFailures.delete(key);
    return sameUser(result, email, resourceLabel);
  })().finally(() => { pendingTokens.delete(key); });
  pendingTokens.set(key, request);
  return request;
}

export function signInToGraph(): Promise<void> {
  return signInForScopes(config.scopes, 'Graph');
}

export function getGraphAccessToken(): Promise<string> {
  return getAccessTokenForScopes(config.scopes, 'Graph');
}

export function cancelInteractiveSignIn() {
  activePopup?.close();
  cancelInteractive?.();
}

export async function resetInteractiveSignIn() {
  authGeneration += 1;
  cancelInteractiveSignIn();
  activePopup = undefined;
  cancelInteractive = undefined;
  pendingInteractive.clear();
  pendingTokens.clear();
  silentFailures.clear();
  const currentApplication = application;
  application = undefined;
  if (currentApplication) await (await currentApplication).clearCache();
}