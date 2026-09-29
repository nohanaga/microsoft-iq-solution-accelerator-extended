import { AzureCliCredential } from '@azure/identity';
import type { Express, Response } from 'express';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { Settings } from './config.js';

const idSchema = z.string().uuid();
const sessionSchema = z.object({ session_id: idSchema }).strict();
const chatSchema = sessionSchema.extend({ run_id: idSchema, text: z.string().trim().min(1).max(8000) });
const resultSchema = sessionSchema.extend({
  run_id: idSchema, call_id: idSchema, output: z.record(z.string(), z.unknown()),
});
const eventSchema = z.object({ type: z.string(), run_id: idSchema }).catchall(z.unknown());
const browserTools = new Set(['get_shop_context', 'update_comparison', 'add_to_cart', 'quote_products', 'place_order', 'remember_preferences', 'forget_preference']);

interface Turn {
  id: string;
  response: Response;
  pending: Set<string>;
  deadline: NodeJS.Timeout;
  bytes: number;
  toolCount: number;
}
interface Session {
  worker?: ChildProcessWithoutNullStreams;
  turn?: Turn;
  idle?: NodeJS.Timeout;
  turns: number;
}

export function registerAgent(app: Express, settings: Settings, root: string) {
  const sessions = new Map<string, Session>();
  const credential = new AzureCliCredential({ processTimeoutInMs: 15000 });
  const python = settings.BARISTA_AGENT_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const endpoint = settings.BARISTA_AGENT_ENDPOINT || settings.AZURE_OPENAI_ENDPOINT;
  let baseUrl = '';
  try {
    const address = new URL(endpoint);
    if (address.protocol === 'https:' && ['.openai.azure.com', '.services.ai.azure.com', '.cognitiveservices.azure.com'].some(suffix => address.hostname.endsWith(suffix)) &&
        !address.username && !address.password && (!address.port || address.port === '443') && !address.search && !address.hash &&
        ['', '/openai/v1'].includes(address.pathname.replace(/\/$/, ''))) baseUrl = `${address.origin}/openai/v1/`;
  } catch { baseUrl = ''; }

  function unavailable() {
    if (!settings.BARISTA_AGENT_DEPLOYMENT) return '相談用モデルの BARISTA_AGENT_DEPLOYMENT が未設定です。';
    if (!baseUrl) return '相談用の Azure リソース URL を設定してください。';
    if (!existsSync(python)) return 'Agent 用 Python がありません。README の環境準備を実行してください。';
    if (settings.AZURE_OPENAI_AUTH_MODE === 'api_key' && !settings.AZURE_OPENAI_API_KEY) return 'サーバーの API キーが未設定です。';
    if (settings.AZURE_OPENAI_AUTH_MODE === 'api_key' && settings.BARISTA_AGENT_ENDPOINT) {
      try {
        if (new URL(baseUrl).origin !== new URL(settings.AZURE_OPENAI_ENDPOINT).origin) return 'API キー認証では Realtime と同じ Azure リソースを指定してください。';
      } catch { return 'API キー認証では Realtime 側の Azure リソース URL も設定してください。'; }
    }
    return '';
  }
  function send(turn: Turn, event: Record<string, unknown>) {
    if (turn.response.destroyed || turn.response.writableEnded) return;
    if (!turn.response.headersSent) turn.response.type('application/x-ndjson');
    turn.response.write(`${JSON.stringify(event)}\n`);
  }
  function dispose(id: string, detail?: string) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    clearTimeout(session.idle);
    if (session.turn) {
      clearTimeout(session.turn.deadline);
      if (detail) send(session.turn, { type: 'agent.error', run_id: session.turn.id, detail });
      session.turn.response.end();
      session.turn = undefined;
    }
    session.worker?.stdin.end();
    session.worker?.kill();
  }
  function idle(id: string, session: Session) {
    clearTimeout(session.idle);
    session.idle = setTimeout(() => dispose(id), 15 * 60 * 1000);
    session.idle.unref();
  }
  function createWorker(id: string, session: Session) {
    const worker = spawn(python, ['-u', path.join(root, 'agent/worker.py')], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
    });
    session.worker = worker;
    worker.stderr.resume();
    worker.stdin.on('error', () => dispose(id, 'Agent との通信が終了しました。会話を開始し直してください。'));
    worker.on('error', () => dispose(id, 'Agent を起動できません。Python と依存関係を確認してください。'));
    worker.on('exit', () => dispose(id, 'Agent が終了しました。Python の依存関係を確認してください。'));
    createInterface({ input: worker.stdout }).on('line', line => {
      if (sessions.get(id) !== session || !session.turn) return;
      const turn = session.turn;
      turn.bytes += Buffer.byteLength(line);
      if (line.length > 128000 || turn.bytes > 1000000) { dispose(id, '応答が上限を超えました。条件を絞ってください。'); return; }
      let value: unknown;
      try { value = JSON.parse(line); } catch { dispose(id, 'Agent の応答形式が不正です。'); return; }
      const parsed = eventSchema.safeParse(value);
      if (!parsed.success || parsed.data.run_id !== turn.id) return;
      const event = parsed.data;
      if (event.type === 'agent.tool_request') {
        if (typeof event.name !== 'string' || !browserTools.has(event.name) || !idSchema.safeParse(event.call_id).success ||
            typeof event.call_id !== 'string' || turn.pending.has(event.call_id) || ++turn.toolCount > 8) {
          dispose(id, '操作数またはツールの制限に達しました。現在の画面を確認してください。'); return;
        }
        turn.pending.add(event.call_id);
      }
      send(turn, event);
      if (event.type === 'agent.error') { dispose(id); return; }
      if (event.type === 'agent.done') {
        clearTimeout(turn.deadline);
        session.turn = undefined;
        turn.response.end();
        idle(id, session);
      }
    });
    return worker;
  }
  app.get('/api/agent/config', (_request, response) => {
    const detail = unavailable();
    response.json({ configured: !detail, detail, framework_version: '1.17.0', factory: 'create_harness_agent', voice: 'realtime' });
  });
  app.post('/api/agent/session', (_request, response) => {
    const detail = unavailable();
    if (detail) { response.status(503).json({ detail }); return; }
    if (sessions.size >= 4) { response.status(429).json({ detail: '相談の同時接続上限です。ほかの相談を終了してください。' }); return; }
    const id = randomUUID();
    const session: Session = { turns: 0 };
    sessions.set(id, session);
    idle(id, session);
    response.json({ session_id: id });
  });
  app.post('/api/agent/chat', async (request, response) => {
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ detail: '相談内容が不正です。8000文字以内で入力してください。' }); return; }
    const body = parsed.data;
    const session = sessions.get(body.session_id);
    if (!session) { response.status(410).json({ detail: '会話の有効期限が切れました。もう一度送信すると新しい会話を開始します。' }); return; }
    if (session.turn) { response.status(409).json({ detail: '前の相談を処理しています。' }); return; }
    if (++session.turns > 50) { dispose(body.session_id); response.status(410).json({ detail: '会話の上限です。次の送信から新しい会話を開始します。' }); return; }
    clearTimeout(session.idle);
    const turn: Turn = {
      id: body.run_id, response, pending: new Set(), bytes: 0, toolCount: 0,
      deadline: setTimeout(() => dispose(body.session_id, '相談がタイムアウトしました。現在の画面を確認してから再度ご相談ください。'), 120000),
    };
    session.turn = turn;
    response.on('close', () => { if (session.turn === turn) dispose(body.session_id); });
    try {
      const apiKey = settings.AZURE_OPENAI_AUTH_MODE === 'api_key' ? settings.AZURE_OPENAI_API_KEY :
        (await credential.getToken('https://ai.azure.com/.default')).token;
      if (sessions.get(body.session_id) !== session || session.turn !== turn) return;
      const worker = session.worker || createWorker(body.session_id, session);
      worker.stdin.write(`${JSON.stringify({ type: 'run', run_id: body.run_id, text: body.text,
        base_url: baseUrl, deployment: settings.BARISTA_AGENT_DEPLOYMENT, api_key: apiKey })}\n`);
    } catch {
      dispose(body.session_id, 'Azure の認証を取得できません。サーバーのサインインとアクセス権を確認してください。');
    }
  });
  app.post('/api/agent/tool-result', (request, response) => {
    const parsed = resultSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ detail: '操作結果の形式が不正です。' }); return; }
    const body = parsed.data;
    const session = sessions.get(body.session_id);
    if (!session?.turn || session.turn.id !== body.run_id || !session.turn.pending.delete(body.call_id)) {
      response.status(409).json({ detail: '終了済み、または受領済みの操作です。' }); return;
    }
    session.worker?.stdin.write(`${JSON.stringify({ type: 'tool_result', run_id: body.run_id, call_id: body.call_id, output: body.output })}\n`);
    response.json({ ok: true });
  });
  app.post('/api/agent/close', (request, response) => {
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).end(); return; }
    dispose(parsed.data.session_id);
    response.json({ ok: true });
  });
  return () => { for (const id of sessions.keys()) dispose(id); };
}