import { AudienceType, UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import type { Schema } from '../../data/schema.js';

const udf = new UserDataFunctions();
// この Functions は別パッケージのため src/copilot-config.ts を import できない。方針を変えるときは両方を揃える。
const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT || '';
const agentName = process.env.FOUNDRY_AGENT_NAME || '';
// 'latest' のときは agent_reference から version を外し、Foundry に最新版を解決させる。
const agentVersion: string = process.env.FOUNDRY_AGENT_VERSION || 'latest';
const agentReference = agentVersion === 'latest'
  ? { name: agentName, type: 'agent_reference' as const }
  : { name: agentName, version: agentVersion, type: 'agent_reference' as const };
const maxQuestionLength = 1000;
const maxHistoryMessages = 12;
const maxMessageLength = 8000;

interface CopilotHistoryMessage {
  role: 'assistant' | 'user';
  content: string;
}

interface CopilotReference {
  id: string;
  label: string;
  text: string;
  url?: string;
}

interface CopilotStoredMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  context: string;
  references: CopilotReference[];
}

interface CopilotChatOutput {
  answer: string;
  context: string;
  conversationId: string;
  references: CopilotReference[];
}

interface FoundryResponse {
  id?: string;
  output_text?: string;
  output?: unknown[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeId(value: string, field: string, allowEmpty = false) {
  const normalized = value.trim();
  if (allowEmpty && !normalized) return '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`${field} の形式が正しくありません。`);
  }
  return normalized;
}

function normalizeUserId(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) throw new Error('利用者情報を確認できません。');
  return normalized;
}

function normalizeQuestion(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error('質問を入力してください。');
  if (normalized.length > maxQuestionLength) throw new Error(`質問は ${maxQuestionLength} 文字以内で入力してください。`);
  return normalized;
}

function normalizeContext(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxMessageLength) throw new Error('画面の分析条件が正しくありません。');
  try { JSON.parse(normalized); } catch { throw new Error('画面の分析条件を解析できません。'); }
  return normalized;
}

function contextLabel(contextJson: string) {
  try {
    const parsed = record(JSON.parse(contextJson));
    return typeof parsed?.label === 'string' && parsed.label.trim() ? parsed.label : '画面の分析条件';
  } catch {
    return '画面の分析条件';
  }
}

function normalizeHistory(value: CopilotHistoryMessage[]) {
  if (!Array.isArray(value)) throw new Error('チャット履歴の形式が正しくありません。');
  return value.slice(-maxHistoryMessages).map(message => {
    if (!message || (message.role !== 'assistant' && message.role !== 'user') || typeof message.content !== 'string') {
      throw new Error('チャット履歴の形式が正しくありません。');
    }
    return { role: message.role, content: message.content.trim().slice(0, maxMessageLength) };
  }).filter(message => message.content.length > 0);
}

async function foundryRequest(path: string, token: string, body: Record<string, unknown>) {
  if (!projectEndpoint || !agentName) throw new Error('Foundry Agent is not configured.');
  const response = await fetch(`${projectEndpoint}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(85_000),
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const payload = record(await response.json());
      const error = record(payload?.error);
      if (typeof error?.message === 'string') detail = error.message;
    } catch {
      // Preserve the HTTP status text when Foundry did not return JSON.
    }
    throw new Error(`Foundry Agent の呼び出しに失敗しました (${response.status}): ${detail}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

function responseText(response: FoundryResponse) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();
  const parts: string[] = [];
  for (const rawItem of response.output ?? []) {
    const item = record(rawItem);
    if (!Array.isArray(item?.content)) continue;
    for (const rawPart of item.content) {
      const part = record(rawPart);
      if (part?.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
    }
  }
  return parts.join('\n').trim();
}

function responseReferences(response: FoundryResponse) {
  const references: CopilotReference[] = [];
  for (const rawItem of response.output ?? []) {
    const item = record(rawItem);
    if (!Array.isArray(item?.content)) continue;
    for (const rawPart of item.content) {
      const part = record(rawPart);
      if (!Array.isArray(part?.annotations)) continue;
      for (const rawAnnotation of part.annotations) {
        const annotation = record(rawAnnotation);
        if (!annotation) continue;
        const url = typeof annotation.url === 'string' && annotation.url.startsWith('https://') ? annotation.url : undefined;
        const sourceId = [annotation.file_id, annotation.document_id, annotation.id].find(value => typeof value === 'string');
        const label = [annotation.title, annotation.filename, sourceId].find(value => typeof value === 'string' && value.trim());
        if (!label && !url) continue;
        references.push({
          id: `${response.id ?? 'response'}:${references.length}`,
          label: typeof label === 'string' ? label : new URL(url!).hostname,
          text: typeof annotation.text === 'string' ? annotation.text : 'Foundry Agent が回答根拠として返した参照です。',
          ...(url ? { url } : {}),
        });
        if (references.length === 20) return references;
      }
    }
  }
  return references;
}

async function readConversation(context: RayfinContext<Schema>, conversationId: string, userId: string) {
  const rows = await context.getDataClient().CopilotConversation
    .select(['id', 'userId', 'foundryConversationId', 'agentName', 'agentVersion', 'title', 'status', 'createdAt'])
    .where({ id: { eq: conversationId }, userId: { eq: userId } }).first(1).execute();
  return rows[0];
}

async function readMessages(context: RayfinContext<Schema>, conversationId: string, userId: string) {
  return context.getDataClient().CopilotMessage
    .select(['id', 'conversationId', 'userId', 'role', 'content', 'contextJson', 'referencesJson', 'requestMessageId', 'foundryResponseId', 'sequence', 'createdAt'])
    .where({ conversationId: { eq: conversationId }, userId: { eq: userId } })
    .orderBy({ sequence: 'asc' }).first(100).execute();
}

function storedMessages(rows: Awaited<ReturnType<typeof readMessages>>): CopilotStoredMessage[] {
  return rows.flatMap(row => {
    if (row.role !== 'user' && row.role !== 'assistant') return [];
    let references: CopilotReference[] = [];
    try {
      const parsed = JSON.parse(row.referencesJson);
      if (Array.isArray(parsed)) references = parsed as CopilotReference[];
    } catch {
      references = [];
    }
    return [{ id: row.id, role: row.role, content: row.content, context: contextLabel(row.contextJson), references }];
  });
}

udf.func('getCopilotHistory', async (
  userId: string,
  conversationId: string,
  context: RayfinContext<Schema>,
): Promise<{ conversationId: string; messages: CopilotStoredMessage[] }> => {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedConversationId = normalizeId(conversationId, '会話 ID', true);
  if (!normalizedConversationId) return { conversationId: '', messages: [] };
  const conversation = await readConversation(context, normalizedConversationId, normalizedUserId);
  if (!conversation || conversation.status !== 'active') return { conversationId: '', messages: [] };
  return { conversationId: normalizedConversationId, messages: storedMessages(await readMessages(context, normalizedConversationId, normalizedUserId)) };
}, []);

udf.func('chat', async (
  userId: string,
  conversationId: string,
  messageId: string,
  question: string,
  history: CopilotHistoryMessage[],
  contextJson: string,
  context: RayfinContext<Schema>,
): Promise<CopilotChatOutput> => {
  const normalizedUserId = normalizeUserId(userId);
  const requestedConversationId = normalizeId(conversationId, '会話 ID', true);
  const normalizedMessageId = normalizeId(messageId, 'メッセージ ID');
  const normalizedQuestion = normalizeQuestion(question);
  const normalizedHistory = normalizeHistory(history);
  const normalizedContextJson = normalizeContext(contextJson);
  const token = context.getToken(AudienceType.AzureAI);
  const data = context.getDataClient();
  let conversation = requestedConversationId ? await readConversation(context, requestedConversationId, normalizedUserId) : undefined;
  const activeConversationId = (conversation?.id ?? requestedConversationId) || crypto.randomUUID();

  if (!conversation) {
    const created = await foundryRequest('/openai/v1/conversations', token, {});
    if (typeof created.id !== 'string' || !created.id) throw new Error('Foundry の会話 ID を取得できませんでした。');
    await data.CopilotConversation.create({
      id: activeConversationId,
      userId: normalizedUserId,
      foundryConversationId: created.id,
      agentName,
      agentVersion,
      title: normalizedQuestion.slice(0, 80),
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    conversation = await readConversation(context, activeConversationId, normalizedUserId);
    if (!conversation) throw new Error('会話を保存できませんでした。');
  }

  const existingRows = await readMessages(context, activeConversationId, normalizedUserId);
  const existingAnswer = existingRows.find(row => row.role === 'assistant' && row.requestMessageId === normalizedMessageId);
  if (existingAnswer) {
    const references = storedMessages([existingAnswer])[0]?.references ?? [];
    return { answer: existingAnswer.content, context: contextLabel(existingAnswer.contextJson), conversationId: activeConversationId, references };
  }
  const existingQuestion = existingRows.find(row => row.role === 'user' && row.id === normalizedMessageId);
  const historyRows = existingQuestion ? existingRows.filter(row => row.id !== normalizedMessageId) : existingRows;
  const expectedHistory = storedMessages(historyRows).slice(-maxHistoryMessages).map(message => ({ role: message.role, content: message.content }));
  if (JSON.stringify(normalizedHistory) !== JSON.stringify(expectedHistory)) {
    throw new Error('チャット履歴が更新されています。会話を開き直して再試行してください。');
  }

  const sequence = existingQuestion?.sequence ?? (existingRows.length ? Math.max(...existingRows.map(row => row.sequence)) + 1 : 0);
  if (!existingQuestion) {
    await data.CopilotMessage.create({
      id: normalizedMessageId,
      conversationId: activeConversationId,
      userId: normalizedUserId,
      role: 'user',
      content: normalizedQuestion,
      contextJson: normalizedContextJson,
      referencesJson: '[]',
      requestMessageId: normalizedMessageId,
      sequence,
      createdAt: new Date().toISOString(),
    });
  }

  const payload = await foundryRequest('/openai/v1/responses', token, {
    conversation: conversation.foundryConversationId,
    input: [{ role: 'user', content: `画面コンテキスト: ${normalizedContextJson}\n\n質問: ${normalizedQuestion}` }],
    agent_reference: agentReference,
  }) as FoundryResponse;
  const answer = responseText(payload);
  if (!answer) throw new Error('Foundry Agent が回答テキストを返しませんでした。');
  const references = responseReferences(payload);
  await data.CopilotMessage.create({
    id: crypto.randomUUID(),
    conversationId: activeConversationId,
    userId: normalizedUserId,
    role: 'assistant',
    content: answer.slice(0, maxMessageLength),
    contextJson: normalizedContextJson,
    referencesJson: JSON.stringify(references).slice(0, maxMessageLength),
    requestMessageId: normalizedMessageId,
    foundryResponseId: payload.id?.slice(0, 128),
    sequence: sequence + 1,
    createdAt: new Date().toISOString(),
  });
  return { answer, context: contextLabel(normalizedContextJson), conversationId: activeConversationId, references };
}, [udf.connection({ audienceType: AudienceType.AzureAI })]);