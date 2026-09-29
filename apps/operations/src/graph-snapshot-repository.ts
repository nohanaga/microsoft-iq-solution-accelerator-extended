import { normalizeTimestamp, workspaceClient } from './rayfin-client';

export interface SqlGraphSnapshot {
  graphId: string; retrievedAt: string; payload: string; payloadHash: string;
}
const maxParts = 512;

export function graphSnapshotUserId() {
  const session = workspaceClient().auth.getSession();
  if (!session.isAuthenticated || !session.user?.id) throw new Error('Fabric にサインインしてください。');
  return session.user.id;
}

export async function graphSnapshotHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function splitGraphSnapshot(payload: string) {
  const parts: string[] = [];
  for (let offset = 0; offset < payload.length;) {
    let end = Math.min(offset + 4000, payload.length);
    const last = payload.charCodeAt(end - 1);
    if (end < payload.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(payload.slice(offset, end));
    offset = end;
  }
  if (!parts.length || parts.length > maxParts) throw new Error('グラフが SQL 保存のサイズ上限を超えています。');
  return parts;
}

function currentRequest(userId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (graphSnapshotUserId() !== userId) throw new DOMException('Graph session changed', 'AbortError');
}

async function concurrentRows<Row>(rows: Row[], action: (row: Row) => Promise<unknown>) {
  let next = 0;
  let failed = false;
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (!failed && next < rows.length) {
      const row = rows[next++];
      try { await action(row); } catch (reason) { failed = true; throw reason; }
    }
  }));
  const failure = outcomes.find(outcome => outcome.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

async function readParts(snapshotId: string, partCount: number, userId: string, signal: AbortSignal) {
  currentRequest(userId, signal);
  if (!Number.isInteger(partCount) || partCount < 1 || partCount > maxParts) throw new Error('SQL グラフの分割情報が不正です。');
  const page = await workspaceClient().data.GraphSnapshotPart.select(['id', 'position', 'payload'])
    .where({ snapshotId: { eq: snapshotId }, userId: { eq: userId } })
    .orderBy({ position: 'asc' }).first(partCount + 1).executePaginated();
  currentRequest(userId, signal);
  if (page.hasNextPage || page.items.length !== partCount || page.items.some((part, index) => part.position !== index)) {
    throw new Error('SQL グラフのデータが揃っていません。');
  }
  return page.items;
}

export async function readSqlGraphSnapshot(cacheKey: string, signal: AbortSignal): Promise<SqlGraphSnapshot | null> {
  const userId = graphSnapshotUserId();
  currentRequest(userId, signal);
  const candidates = await workspaceClient().data.GraphSnapshot
    .select(['id', 'graphId', 'retrievedAt', 'payloadHash', 'partCount'])
    .where({ cacheKey: { eq: cacheKey }, userId: { eq: userId } })
    .orderBy({ retrievedAt: 'desc', id: 'desc' }).first(2).execute();
  currentRequest(userId, signal);
  let failure: unknown;
  for (const candidate of candidates) {
    try {
      const parts = await readParts(candidate.id, candidate.partCount, userId, signal);
      const payload = parts.map(part => part.payload).join('');
      if (await graphSnapshotHash(payload) !== candidate.payloadHash) throw new Error('SQL グラフの整合性を確認できません。');
      currentRequest(userId, signal);
      return { graphId: candidate.graphId, retrievedAt: String(normalizeTimestamp(candidate.retrievedAt)), payloadHash: candidate.payloadHash, payload };
    } catch (reason) { currentRequest(userId, signal); failure = reason; }
  }
  if (failure) throw failure;
  return null;
}

async function removeSnapshot(id: string, userId: string, signal: AbortSignal) {
  currentRequest(userId, signal);
  const parts = await workspaceClient().data.GraphSnapshotPart.select(['id'])
    .where({ snapshotId: { eq: id }, userId: { eq: userId } }).first(maxParts).execute();
  currentRequest(userId, signal);
  await workspaceClient().data.GraphSnapshot.delete({ id });
  await concurrentRows(parts, async part => {
    currentRequest(userId, signal);
    await workspaceClient().data.GraphSnapshotPart.delete({ id: part.id });
  });
}

export async function writeSqlGraphSnapshot(cacheKey: string, snapshot: SqlGraphSnapshot, signal: AbortSignal) {
  const userId = graphSnapshotUserId();
  const id = crypto.randomUUID();
  const parts = splitGraphSnapshot(snapshot.payload).map((payload, position) => ({ id: crypto.randomUUID(), snapshotId: id, userId, position, payload }));
  const data = workspaceClient().data;
  const attempted: string[] = [];
  let published = false;
  try {
    await concurrentRows(parts, async part => {
      currentRequest(userId, signal);
      attempted.push(part.id);
      await data.GraphSnapshotPart.create(part);
    });
    const stored = await readParts(id, parts.length, userId, signal);
    if (await graphSnapshotHash(stored.map(part => part.payload).join('')) !== snapshot.payloadHash) throw new Error('SQL グラフの保存内容が一致しません。');
    currentRequest(userId, signal);
    await data.GraphSnapshot.create({ id, userId, cacheKey, graphId: snapshot.graphId, retrievedAt: snapshot.retrievedAt, payloadHash: snapshot.payloadHash, partCount: parts.length });
    published = true;
    currentRequest(userId, signal);
    const committed = await data.GraphSnapshot.select(['id', 'payloadHash']).where({ id: { eq: id }, userId: { eq: userId } }).first(1).execute();
    currentRequest(userId, signal);
    if (committed[0]?.payloadHash !== snapshot.payloadHash) throw new Error('SQL グラフの保存結果を確認できません。');
  } catch (reason) {
    if (!published && !signal.aborted && graphSnapshotUserId() === userId) {
      const committed = await data.GraphSnapshot.select(['id']).where({ id: { eq: id } }).first(1).execute().catch(() => null);
      if (committed && !committed.length) await concurrentRows(attempted, partId => data.GraphSnapshotPart.delete({ id: partId }).catch(() => {}));
    }
    throw reason;
  }
  const cleanup = async () => {
    currentRequest(userId, signal);
    const previous = await data.GraphSnapshot.select(['id']).where({ cacheKey: { eq: cacheKey }, userId: { eq: userId } })
      .orderBy({ retrievedAt: 'desc', id: 'desc' }).first(10).execute();
    for (const old of previous.slice(2)) await removeSnapshot(old.id, userId, signal);
  };
  void cleanup().catch(() => {});
}