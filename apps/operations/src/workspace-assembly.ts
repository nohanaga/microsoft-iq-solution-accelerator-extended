import { z } from 'zod';

export interface WorkspaceTable { name: string; source: string; table: string; fields: string[] }
const metadataSchema = z.object({ datasetId: z.string(), version: z.string(), asOf: z.string().optional(),
  dataOrigin: z.literal('synthetic').optional(), timezone: z.string().optional() });
export function assembleWorkspace(tables: WorkspaceTable[], staged: Record<string, Record<string, unknown>[]>) {
  const bundle: Record<string, Record<string, unknown>> = { operations: {}, development: {}, voices: {}, chats: {}, sentiments: {} };
  const seen = new Set<string>();
  for (const row of staged.mc_v3_metadata ?? []) {
    if (typeof row.source !== 'string' || !Object.hasOwn(bundle, row.source) || seen.has(row.source) || typeof row.payload !== 'string') throw new Error('Invalid source metadata');
    bundle[row.source] = metadataSchema.parse(JSON.parse(row.payload));
    seen.add(row.source);
  }
  if (seen.size !== Object.keys(bundle).length) throw new Error('Incomplete source metadata');
  // 予測はモデルの出力であり、業務データのメタデータを持ちません。
  bundle.predictions = {};
  for (const table of tables) {
    if (!staged[table.name]) throw new Error(`Missing analytical collection: ${table.name}`);
    if (['operations', 'development', 'predictions'].includes(table.source)) bundle[table.source][table.table] = staged[table.name];
  }
  bundle.voices.entries = (staged.mc_v3_voices ?? []).map(row => ({ ...row, topics: JSON.parse(String(row.topics)) }));
  bundle.chats.conversations = (staged.mc_v3_conversations ?? []).map(row => ({ ...row,
    messages: (staged.mc_v3_messages ?? []).filter(message => message.conversationId === row.id)
      .sort((first, second) => Number(first.sequence) - Number(second.sequence))
      .map(message => ({ ...message, topics: JSON.parse(String(message.topics)) })),
  }));
  bundle.sentiments.entries = (staged.mc_v3_sentiments ?? []).map(row => ({ ...row, topics: JSON.parse(String(row.topics)) }));
  return bundle;
}