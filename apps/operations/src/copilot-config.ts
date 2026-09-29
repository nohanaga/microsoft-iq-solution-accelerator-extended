/**
 * Data Copilot が参照する Foundry Agent の単一設定。
 * agentVersion に版番号を入れるとその版へ固定し、'latest' にすると agent_reference から version を外して最新版へ解決させる。
 */
export interface CopilotAgentConfig {
  projectEndpoint: string;
  agentName: string;
  agentVersion: string;
  scopes: string[];
}

export const copilotAgent: CopilotAgentConfig = {
  projectEndpoint: (import.meta.env.VITE_FOUNDRY_PROJECT_ENDPOINT || '').replace(/\/$/, ''),
  agentName: import.meta.env.VITE_FOUNDRY_AGENT_NAME || '',
  agentVersion: import.meta.env.VITE_FOUNDRY_AGENT_VERSION || '',
  // .default はアプリ登録に静的登録した権限だけを要求するため、動的同意できる委任スコープを指定します。
  scopes: ['https://ai.azure.com/user_impersonation'],
};

const pinnedVersion = copilotAgent.agentVersion.trim();
export const usesLatestAgentVersion = !pinnedVersion || pinnedVersion.toLowerCase() === 'latest';

/**
 * Agent が返す MCP ツールの承認要求（mcp_approval_request）をクライアントで自動承認する。
 * Work IQ / Foundry IQ など信頼済みの接続だけを Agent に登録している前提。
 * 任意の MCP サーバーや外部送信ツールを追加する場合は false に戻し、利用者承認を挟む。
 */
export const autoApproveMcpRequests = import.meta.env.VITE_FOUNDRY_AUTO_APPROVE_MCP === 'true';

export const copilotResponsesUrl = `${copilotAgent.projectEndpoint}/openai/v1/responses`;
export const copilotAgentLabel = usesLatestAgentVersion
  ? `${copilotAgent.agentName} / 最新版`
  : `${copilotAgent.agentName} / version ${pinnedVersion}`;
export const copilotAgentReference: { name: string; type: 'agent_reference'; version?: string } = usesLatestAgentVersion
  ? { name: copilotAgent.agentName, type: 'agent_reference' }
  : { name: copilotAgent.agentName, type: 'agent_reference', version: pinnedVersion };
