import { AzureCliCredential } from '@azure/identity';
import type { Express } from 'express';
import { z } from 'zod';
import type { Settings } from './config.js';

const voices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'] as const;
const connectionSchema = z.object({
  endpoint: z.string().max(500),
  deployment: z.string().trim().min(1).max(200),
  auth_mode: z.enum(['entra_id', 'api_key']).default('entra_id'),
  api_key: z.string().max(4096).default(''),
  sdp: z.string().min(20).max(100000).startsWith('v=0'),
  voice: z.enum(voices).default('verse'),
  instructions: z.string().max(8000).default('Respond naturally in Japanese.'),
  transcribe: z.boolean().default(true),
  create_response: z.boolean().default(true),
}).strict();

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function azureBaseUrl(endpoint: string) {
  let address: URL;
  try { address = new URL(endpoint.trim()); }
  catch { throw new ApiError(400, 'Azure のリソース URL が不正です。'); }
  const allowed = ['.openai.azure.com', '.services.ai.azure.com', '.cognitiveservices.azure.com'];
  if (address.protocol !== 'https:' || !allowed.some(suffix => address.hostname.endsWith(suffix)) ||
      address.username || address.password || (address.port && address.port !== '443') || address.search || address.hash ||
      !['', '/openai/v1'].includes(address.pathname.replace(/\/$/, ''))) {
    throw new ApiError(400, 'Azure のリソース URL を指定してください。');
  }
  return `${address.origin}/openai/v1/realtime`;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function checkAzureResponse(response: Response, stage: string, secrets: string[]) {
  if (response.ok) return;
  const payload: unknown = await response.json().catch(() => null);
  const error = object(object(payload).error);
  let message = typeof error.message === 'string' ? error.message : 'Azure からエラーが返されました。';
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, '[redacted]');
  const hints: Record<number, string> = {
    400: 'デプロイの Realtime API 対応と音声設定を確認してください。',
    401: 'Azure CLI のサインイン先または API キーを確認してください。',
    403: 'リソースへのアクセス権とネットワーク制限を確認してください。',
    404: 'リソース URL とデプロイ名を確認してください。',
    429: 'クォータまたは同時接続数の上限です。時間をおいて接続してください。',
  };
  throw new ApiError(502, `${stage} (Azure HTTP ${response.status}): ${hints[response.status] || ''} ${message.slice(0, 1200)}`);
}

export function registerRealtime(app: Express, settings: Settings) {
  const credential = new AzureCliCredential({ processTimeoutInMs: 15000 });
  app.get('/api/config', (_request, response) => {
    response.json({ endpoint: settings.AZURE_OPENAI_ENDPOINT, deployment: settings.AZURE_OPENAI_DEPLOYMENT_NAME,
      auth_mode: settings.AZURE_OPENAI_AUTH_MODE, has_api_key: Boolean(settings.AZURE_OPENAI_API_KEY), voices });
  });
  app.post('/api/connect', async (request, response) => {
    const parsed = connectionSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ detail: '音声接続の入力が不正です。設定と接続情報を確認してください。' }); return; }
    const body = parsed.data;
    const abort = new AbortController();
    const onClose = () => { if (!response.writableEnded) abort.abort(); };
    response.on('close', onClose);
    try {
      const base = azureBaseUrl(body.endpoint);
      let secret: string;
      let headers: Record<string, string>;
      if (body.auth_mode === 'entra_id') {
        try {
          const token = await credential.getToken('https://ai.azure.com/.default', { abortSignal: abort.signal });
          secret = token.token;
        } catch {
          throw new ApiError(401, 'Azure CLI の認証を取得できません。このアプリを起動したユーザーで az login を実行し、リソースへのアクセス権を確認してください。');
        }
        headers = { Authorization: `Bearer ${secret}` };
      } else {
        secret = body.api_key.trim();
        if (!secret && settings.AZURE_OPENAI_API_KEY && settings.AZURE_OPENAI_ENDPOINT && base === azureBaseUrl(settings.AZURE_OPENAI_ENDPOINT)) secret = settings.AZURE_OPENAI_API_KEY;
        if (!secret) throw new ApiError(400, '同じ Azure リソースの API キーをサーバーの .env に設定してください。');
        headers = { 'api-key': secret };
      }
      abort.signal.throwIfAborted();
      const input = {
        turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600,
          create_response: body.create_response, interrupt_response: true },
        ...(body.transcribe ? { transcription: { model: 'whisper-1', language: 'ja' } } : {}),
      };
      const sessionResponse = await fetch(`${base}/client_secrets`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, redirect: 'error',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(35000)]),
        body: JSON.stringify({ session: { type: 'realtime', model: body.deployment, instructions: body.instructions,
          output_modalities: ['audio'], audio: { input, output: { voice: body.voice } } } }),
      });
      await checkAzureResponse(sessionResponse, 'セッション作成', [secret]);
      const tokenPayload: unknown = await sessionResponse.json();
      const token = object(tokenPayload).value;
      if (typeof token !== 'string' || !token) throw new ApiError(502, 'Azure の応答に短期トークンがありません。');
      const sdpResponse = await fetch(`${base}/calls`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/sdp' },
        body: body.sdp, redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(35000)]),
      });
      await checkAzureResponse(sdpResponse, '音声接続', [secret, token]);
      const answer = await sdpResponse.text();
      if (!answer.startsWith('v=0')) throw new ApiError(502, 'Azure から有効な WebRTC 応答を受信できませんでした。');
      if (!abort.signal.aborted) response.type('application/sdp').send(answer);
    } catch (error) {
      if (abort.signal.aborted) return;
      if (error instanceof ApiError) response.status(error.status).json({ detail: error.message });
      else if (error instanceof Error && error.name === 'TimeoutError') response.status(504).json({ detail: 'Azure への接続がタイムアウトしました。' });
      else response.status(502).json({ detail: 'Azure への接続に失敗しました。ネットワークと接続設定を確認してください。' });
    } finally { response.off('close', onClose); }
  });
}