import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { jstEnd, jstStart } from './analytics';
import { countVoiceTimeline } from './voice';
import type { CustomerVoice } from './voice';

const dayMilliseconds = 86_400_000;
const tickDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });

export function VoiceTimeline({ voices, from, to }: { voices: CustomerVoice[]; from: string; to: string }) {
  const [width, setWidth] = useState(600);
  const points = countVoiceTimeline(voices);
  const start = Date.parse(jstStart(from));
  const end = Date.parse(jstEnd(to)) + 1;
  const validPeriod = Number.isFinite(start) && Number.isFinite(end) && start < end;
  const days = validPeriod ? Math.round((end - start) / dayMilliseconds) : 0;
  const tickCount = Math.min(days, width < 400 ? 3 : 5);
  const ticks = Array.from({ length: tickCount }, (_, index) => start + (tickCount === 1 ? 0 : Math.round(index * (days - 1) / (tickCount - 1))) * dayMilliseconds + dayMilliseconds / 2);
  const chartData = points.map(point => ({ ...point, timestamp: point.timestamp + dayMilliseconds / 2 }));
  const maximum = Math.max(1, ...points.map(point => point.count));
  return <section className="voice-timeline" aria-label="時系列投稿数">
    <div className="section-heading"><h2>投稿数の推移</h2><span>日別 / {voices.length} 件</span></div>
    {validPeriod ? <div className="voice-timeline-chart">
      <span className="timeline-y-label">投稿数 (件)</span>
      <ResponsiveContainer width="100%" height={260} minWidth={0} initialDimension={{ width: 600, height: 260 }} onResize={nextWidth => setWidth(nextWidth)}>
        <BarChart data={chartData} margin={{ top: 22, right: 12, bottom: 14, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--cp-border)" strokeDasharray="3 3"/>
          <XAxis dataKey="timestamp" type="number" scale="time" domain={[start, end]} ticks={ticks} tickFormatter={value => tickDate.format(value)}
            tick={{ fill: 'var(--cp-text-muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--cp-border-strong)' }} height={42}
            label={{ value: '日付（JST）', position: 'insideBottom', offset: -8, fill: 'var(--cp-text-muted)', fontSize: 11 }}/>
          <YAxis allowDecimals={false} domain={[0, maximum]} width={42} tickCount={Math.min(maximum + 1, 5)}
            tick={{ fill: 'var(--cp-text-muted)', fontSize: 11 }} axisLine={false} tickLine={false}/>
          <Tooltip cursor={{ fill: 'var(--cp-accent-soft)' }} labelFormatter={value => `${fullDate.format(Number(value))} 00:00 - 24:00 JST`}
            formatter={value => [`${value} 件`, '投稿数']} contentStyle={{ background: 'var(--cp-surface)', border: '1px solid var(--cp-border)', borderRadius: 4, fontSize: 12 }}
            labelStyle={{ color: 'var(--cp-text)' }} itemStyle={{ color: 'var(--cp-accent)' }}/>
          <Bar dataKey="count" name="投稿数" fill="var(--cp-accent)" barSize={Math.max(0.5, Math.min(32, (width - 54) / days * 0.75))} isAnimationActive={false}/>
        </BarChart>
      </ResponsiveContainer>
      {!points.length && <p className="timeline-empty">この条件に該当する投稿はありません。</p>}
    </div> : <p className="empty">集計期間を指定してください。</p>}
    <details className="timeline-values"><summary>日別の投稿数</summary><div className="table-scroll"><table><thead><tr><th>日付（JST）</th><th>投稿数</th></tr></thead><tbody>{points.map(point => <tr key={point.timestamp}><td>{fullDate.format(point.timestamp)} 00:00</td><td>{point.count} 件</td></tr>)}</tbody></table>{!points.length && <p className="empty">投稿なし</p>}</div></details>
  </section>;
}