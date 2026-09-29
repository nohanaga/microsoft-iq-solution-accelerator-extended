import { useMemo, useState } from 'react';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function entriesOf(value: JsonValue[] | { [key: string]: JsonValue }) {
  return Array.isArray(value)
    ? value.map((item, index): [string, JsonValue] => [String(index), item])
    : Object.entries(value);
}

function leafText(value: Exclude<JsonValue, JsonValue[] | { [key: string]: JsonValue }>) {
  if (value === null) return 'null';
  return typeof value === 'string' ? value : String(value);
}

function leafClass(value: Exclude<JsonValue, JsonValue[] | { [key: string]: JsonValue }>) {
  return value === null ? 'json-null' : `json-${typeof value}`;
}

function JsonNode({ name, value, depth }: { name: string; value: JsonValue; depth: number }) {
  if (value === null || typeof value !== 'object') {
    return <div className="json-leaf">
      <span className="json-key">{name}</span>
      <span className={leafClass(value)}>{leafText(value)}</span>
    </div>;
  }
  const entries = entriesOf(value);
  return <details className="json-branch" open={depth < 2}>
    <summary>
      <span className="json-key">{name}</span>
      <span className="json-meta">{Array.isArray(value) ? `配列 ${entries.length}` : `項目 ${entries.length}`}</span>
    </summary>
    <div className="json-children">
      {entries.length
        ? entries.map(([key, item]) => <JsonNode key={key} name={key} value={item} depth={depth + 1}/>)
        : <p className="json-meta">空</p>}
    </div>
  </details>;
}

export function JsonView({ text, label }: { text: string; label: string }) {
  const [raw, setRaw] = useState(false);
  const parsed = useMemo(() => {
    try { return { ok: true, value: JSON.parse(text) as JsonValue }; }
    catch { return { ok: false, value: null as JsonValue }; }
  }, [text]);
  if (!parsed.ok) return <pre>{text}</pre>;
  return <div className="json-view">
    <div className="json-view-actions">
      <button type="button" aria-pressed={raw} onClick={() => setRaw(value => !value)}>{raw ? '構造表示' : '生 JSON'}</button>
    </div>
    {raw ? <pre>{text}</pre> : <JsonNode name={label} value={parsed.value} depth={0}/>}
  </div>;
}
