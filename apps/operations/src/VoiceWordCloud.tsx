import { useEffect, useRef, useState } from 'react';
import cloud from 'd3-cloud';
import type { VoiceWord } from './voice';

interface PlacedWord extends cloud.Word { text: string; count: number }
const fontFamily = '"BIZ UDPGothic", "Yu Gothic UI", Meiryo, sans-serif';

export function VoiceWordCloud({ words, selected, onSelect }: { words: VoiceWord[]; selected: string; onSelect: (word: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [placed, setPlaced] = useState<{ key: string; words: PlacedWord[] }>({ key: '', words: [] });
  const serialized = JSON.stringify(words);
  const key = `${width}:${serialized}`;
  const height = 300;
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (width < 1) return;
    const input = JSON.parse(serialized) as VoiceWord[];
    const maximum = Math.max(1, ...input.map(word => word.count));
    let randomState = 42;
    let active = true;
    const layout = cloud<PlacedWord>().size([width, height]).words(input).padding(5).rotate(() => 0)
      .font(fontFamily).fontWeight(600).fontSize(word => 14 + 28 * Math.sqrt(word.count / maximum))
      .random(() => { randomState = (randomState * 16807) % 2147483647; return randomState / 2147483647; })
      .on('end', output => { if (active) setPlaced({ key: `${width}:${serialized}`, words: output }); });
    layout.start();
    return () => { active = false; layout.stop(); };
  }, [width, serialized]);
  return <div className="voice-cloud" ref={container}>
    {!words.length ? <p className="empty">対象となる語はありません。</p> : placed.key !== key ? <p className="empty" role="status">集計中</p> : <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="ワードクラウド">
      <g transform={`translate(${width / 2},${height / 2})`}>{placed.words.map((word, index) => <text
        key={word.text} transform={`translate(${word.x},${word.y})`} textAnchor="middle" fontFamily={fontFamily} fontWeight={600} fontSize={word.size}
        className={`cloud-word cloud-tone-${index % 3}`} role="button" tabIndex={0} aria-pressed={selected === word.text}
        aria-label={`${word.text}、${word.count} 件の原文`} onClick={() => onSelect(word.text)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(word.text); } }}>
        <title>{word.text} : {word.count} 件</title>{word.text}
      </text>)}</g>
    </svg>}
    <details className="cloud-frequency"><summary>語別の件数</summary><ul>{words.map(word => <li key={word.text}><button aria-pressed={selected === word.text} onClick={() => onSelect(word.text)}><span>{word.text}</span><strong>{word.count} 件</strong></button></li>)}</ul></details>
  </div>;
}