import type { ReactNode } from 'react';

// HTML 文字列を作らず React 要素へ直接変換するため、生成物に任意の HTML が混入しません。
const inlinePattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(~~[^~]+~~)|(\[[^\]\n]*\]\([^()\s]+\))/;
const headingPattern = /^(#{1,6})\s+(.*)$/;
const listPattern = /^(\s*)(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/;
const rulePattern = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const tableDividerPattern = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function safeHref(href: string) {
  return /^https?:\/\//i.test(href) ? href : undefined;
}

function inlineNodes(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let index = 0;
  while (rest) {
    const match = inlinePattern.exec(rest);
    if (!match || match.index === undefined) break;
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('**') || token.startsWith('__')) nodes.push(<strong key={key}>{inlineNodes(token.slice(2, -2), key)}</strong>);
    else if (token.startsWith('~~')) nodes.push(<del key={key}>{inlineNodes(token.slice(2, -2), key)}</del>);
    else if (token.startsWith('*')) nodes.push(<em key={key}>{inlineNodes(token.slice(1, -1), key)}</em>);
    else {
      const divider = token.indexOf('](');
      const label = token.slice(1, divider);
      const href = safeHref(token.slice(divider + 2, -1));
      nodes.push(href
        ? <a key={key} href={href} target="_blank" rel="noreferrer">{label || href}</a>
        : <span key={key}>{label}</span>);
    }
    rest = rest.slice(match.index + token.length);
  }
  if (rest) nodes.push(rest);
  return nodes;
}

function tableCells(line: string) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(cell => cell.trim());
}

function blockNodes(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }

    if (line.trimStart().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trimStart().startsWith('```')) code.push(lines[index++]);
      index++;
      blocks.push(<pre key={`code-${key++}`} data-language={language || undefined}><code>{code.join('\n')}</code></pre>);
      continue;
    }

    if (rulePattern.test(line)) { blocks.push(<hr key={`rule-${key++}`}/>); index++; continue; }

    const heading = headingPattern.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6);
      const Tag = `h${level}` as 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Tag key={`heading-${key++}`}>{inlineNodes(heading[2], `heading-${key}`)}</Tag>);
      index++;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && tableDividerPattern.test(lines[index + 1])) {
      const header = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(tableCells(lines[index++]));
      blocks.push(<table key={`table-${key++}`}>
        <thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{inlineNodes(cell, `th-${key}-${cellIndex}`)}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineNodes(cell, `td-${key}-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody>
      </table>);
      continue;
    }

    if (line.trimStart().startsWith('>')) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trimStart().startsWith('>')) quote.push(lines[index++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={`quote-${key++}`}>{blockNodes(quote.join('\n'))}</blockquote>);
      continue;
    }

    const listStart = listPattern.exec(line);
    if (listStart) {
      const ordered = !!listStart[3];
      const items: ReactNode[] = [];
      let itemKey = 0;
      while (index < lines.length) {
        const item = listPattern.exec(lines[index]);
        if (!item || !!item[3] !== ordered) break;
        const content = [item[4]];
        index++;
        while (index < lines.length && lines[index].trim() && !listPattern.test(lines[index]) && lines[index].startsWith('  ')) {
          content.push(lines[index++].trim());
        }
        items.push(<li key={itemKey}>{inlineNodes(content.join(' '), `li-${key}-${itemKey++}`)}</li>);
      }
      blocks.push(ordered
        ? <ol key={`list-${key++}`}>{items}</ol>
        : <ul key={`list-${key++}`}>{items}</ul>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !listPattern.test(lines[index]) && !headingPattern.test(lines[index]) && !lines[index].trimStart().startsWith('```') && !lines[index].trimStart().startsWith('>')) {
      paragraph.push(lines[index++]);
    }
    blocks.push(<p key={`paragraph-${key++}`}>{inlineNodes(paragraph.join('\n'), `p-${key}`)}</p>);
  }
  return blocks;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className ? `markdown ${className}` : 'markdown'}>{blockNodes(text)}</div>;
}
