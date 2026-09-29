import { ArrowRight, Bot, Lightbulb, ShieldAlert } from 'lucide-react';
import type { Dataset } from './domain';
import type { CustomerVoice } from './voice';
import { groupVoiceSentiments } from './sentiment';
import { useWorkspace } from './workspace-context';
import { proposeProducts } from './voiceDecisions';
import type { ProductProposal } from './voiceDecisions';

interface VoiceDecisionCardsProps {
  voices: CustomerVoice[];
  stores: Dataset['stores'];
  onTopic: (topic: string) => void;
  onDiscuss: (question: string) => void;
}

function ProposalContent({ proposal, onTopic }: { proposal: ProductProposal; onTopic: (topic: string) => void }) {
  return <div className="product-proposal">
    <h3>{proposal.title}</h3><p>{proposal.hypothesis}</p>
    <div className="proposal-counts"><span>関連する声 <strong>{proposal.evidence.length}/{proposal.total} 件</strong></span><span>現行支持・肯定 <strong>{proposal.counterEvidence.length} 件</strong></span></div>
    <details><summary>判断材料</summary><h4>関連する原文</h4>{proposal.evidence.slice(0, 3).map(voice => <blockquote key={voice.id}><code>{voice.recordId}</code><p>{voice.text}</p></blockquote>)}
      <h4>現行支持・肯定の原文</h4>{proposal.counterEvidence.slice(0, 2).map(voice => <blockquote key={voice.id}><code>{voice.recordId}</code><p>{voice.text}</p></blockquote>)}{!proposal.counterEvidence.length && <p>この条件では確認できません。</p>}
      <h4>追加確認</h4><ul>{proposal.checks.map(check => <li key={check}>{check}</li>)}</ul>
      <button className="text-action" onClick={() => onTopic(proposal.topic)}>話題の原文一覧<ArrowRight size={14}/></button>
    </details>
  </div>;
}

export function VoiceDecisionCards({ voices, stores, onTopic, onDiscuss }: VoiceDecisionCardsProps) {
  const voiceSentiments = useWorkspace().data.sentiments.entries;
  const groups = groupVoiceSentiments(voices, stores, 'topic', voiceSentiments).filter(group => group.classified >= 3);
  const highest = groups[0];
  const priorities = groups.filter(group => (group.negativeRate ?? 0) >= 0.3 && group.counts.negative >= 3);
  const proposals = proposeProducts(voices, voiceSentiments);
  return <section className="voice-decision-cards" aria-label="意思決定のための提案">
    <article className="voice-decision-card"><header><div><span className="decision-kicker">優先シグナル</span><h2>要望と懸念</h2></div><ShieldAlert size={23}/></header>
      <p className="decision-lead">対象の声 <strong>{voices.length} 件</strong> / 重点話題 <strong>{priorities.length} 件</strong></p>
      <p>{highest ? `分類済み 3 件以上の話題では「${highest.name}」の否定率が最大 ${(highest.negativeRate! * 100).toFixed(1)}%（${highest.counts.negative}/${highest.classified} 件）です。` : '話題を比較できる分類済みの声が不足しています。'}</p>
      {proposals[0] && <p>「{proposals[0].topic}」に関する質問・希望・不満が {proposals[0].evidence.length} 件あります。</p>}
      <p className="scope-note">重点話題：否定率 30% 以上かつ否定 3 件以上。母数は分類済みの声です。合成分類。</p>
      {highest && <button className="text-action" onClick={() => onTopic(highest.name)}>話題の原文を確認<ArrowRight size={15}/></button>}
    </article>
    <article className="voice-decision-card"><header><div><span className="decision-kicker">次の判断</span><h2>商品提案</h2></div><Lightbulb size={23}/></header>
      <span className="badge">検討案 / ローカル生成</span>
      {proposals[0] ? <ProposalContent proposal={proposals[0]} onTopic={onTopic}/> : <p className="empty">商品案を作る根拠が不足しています。関連する質問・希望・不満が 3 件以上の話題を対象にします。</p>}
      {proposals.length > 1 && <details className="proposal-alternatives"><summary>ほかの検討案 {proposals.length - 1} 件</summary>{proposals.slice(1).map(proposal => <ProposalContent key={proposal.id} proposal={proposal} onTopic={onTopic}/>)}</details>}
      <p className="scope-note">購入意向・需要・利益は未検証です。質問は購入希望とは限りません。販売・発注は行いません。</p>
      <button onClick={() => onDiscuss('顧客の要望を根拠に、商品追加の案と反対意見・追加確認を提案してください。')} disabled={!proposals.length}><Bot size={16}/>Copilot で検討<ArrowRight size={15}/></button>
    </article>
  </section>;
}