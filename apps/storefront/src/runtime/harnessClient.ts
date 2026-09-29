import { z } from 'zod';

const eventSchema = z.object({ type: z.string(), run_id: z.string().uuid() }).catchall(z.unknown());
const toolSchema = eventSchema.extend({
  type: z.literal('agent.tool_request'), call_id: z.string().uuid(), name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});
type AgentEvent = z.infer<typeof eventSchema>;
type ToolOutput = Record<string, unknown>;
const allowedTools = new Set(['get_shop_context', 'update_comparison', 'add_to_cart', 'quote_products', 'place_order', 'remember_preferences', 'forget_preference']);

export function createHarnessClient(execute: (name: string, args: Record<string, unknown>) => ToolOutput | Promise<ToolOutput>) {
  let sessionId = '';
  let active: AbortController | null = null;

  async function post(route: string, body: object, signal: AbortSignal) {
    const response = await fetch(`/api/agent/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      if (response.status === 410) sessionId = '';
      const detail = z.object({ detail: z.string() }).safeParse(payload);
      throw new Error(detail.success ? detail.data.detail : `相談サーバーに接続できませんでした (HTTP ${response.status})。`);
    }
    return response;
  }

  function close() {
    active?.abort();
    active = null;
    const id = sessionId;
    sessionId = '';
    if (id) void fetch('/api/agent/close', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: id }), keepalive: true,
    }).catch(() => undefined);
  }

  return {
    get busy() { return active !== null; },
    close,
    async run(text: string, onEvent: (event: AgentEvent) => void) {
      if (active) throw new Error('前の相談の応答を待つか、中断してください。');
      const owner = new AbortController();
      active = owner;
      const deadline = window.setTimeout(() => owner.abort(new Error('相談がタイムアウトしました。')), 125000);
      const runId = crypto.randomUUID();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        if (!sessionId) {
          const response = await post('session', {}, owner.signal);
          const session = z.object({ session_id: z.string().uuid() }).parse(await response.json());
          owner.signal.throwIfAborted();
          sessionId = session.session_id;
        }
        const response = await post('chat', { session_id: sessionId, run_id: runId, text }, owner.signal);
        if (!response.body) throw new Error('相談の応答ストリームがありません。');
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        const calls = new Map<string, ToolOutput>();
        let buffer = '';
        let bytes = 0;
        let complete = false;
        while (!complete) {
          const chunk = await reader.read();
          owner.signal.throwIfAborted();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 1000000) throw new Error('応答が保持上限を超えました。');
          buffer += decoder.decode(chunk.value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (!line.trim()) continue;
            const event = eventSchema.parse(JSON.parse(line));
            if (event.run_id !== runId) continue;
            owner.signal.throwIfAborted();
            onEvent(event);
            if (event.type === 'agent.error') {
              throw new Error(`バリスタの応答に失敗しました${typeof event.upstream_status === 'number' ? ` (Azure HTTP ${event.upstream_status})` : ''}。${typeof event.detail === 'string' && /[\u3040-\u9fff]/.test(event.detail) ? event.detail : 'モデルのデプロイ名、アクセス権、クォータ、ネットワークを確認してください。'}`);
            }
            if (event.type === 'agent.tool_request') {
              const tool = toolSchema.parse(event);
              if (!allowedTools.has(tool.name)) throw new Error('許可されていない操作を受信しました。');
              if (calls.has(tool.call_id)) continue;
              if (calls.size >= 8) throw new Error('一度の相談の操作上限に達しました。');
              let output: ToolOutput;
              try { output = await execute(tool.name, tool.arguments); }
              catch { output = { ok: false, error: '操作を実行できません。現在の画面を確認してください。' }; }
              calls.set(tool.call_id, output);
              const result = { type: 'agent.browser_result', run_id: runId, call_id: tool.call_id, name: tool.name,
                arguments: tool.arguments, output, returned: false };
              try {
                await post('tool-result', { session_id: sessionId, run_id: runId, call_id: tool.call_id, output }, owner.signal);
                if (!owner.signal.aborted) onEvent({ ...result, returned: true });
              } catch (error) {
                if (!owner.signal.aborted) onEvent(result);
                throw error;
              }
            }
            if (event.type === 'agent.done') { complete = true; break; }
          }
          if (buffer.length > 128000) throw new Error('応答イベントが上限を超えました。');
        }
        if (!complete) throw new Error('応答の途中で接続が終了しました。操作を再送する前に画面を確認してください。');
      } catch (error) {
        if (active === owner) close();
        throw error;
      } finally {
        window.clearTimeout(deadline);
        if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        if (active === owner) active = null;
      }
    },
  };
}