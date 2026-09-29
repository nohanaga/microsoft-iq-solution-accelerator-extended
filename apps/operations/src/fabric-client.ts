import { FabricClient, type FabricClientConfig } from '@microsoft/fabric-app-data';
import { SemanticModelMessageClient } from '@microsoft/fabric-app-data-embed-client';
import { EmbedFabricApiProxy } from '@microsoft/fabric-app-data-proxy';
import { fabricConfig } from './fabric.generated';

let client: FabricClient | undefined;

export function getFabricClient() {
  if (client) return client;
  const model = fabricConfig.semanticModels.maikuroV3Live;
  if (!model.workspaceId || !model.itemId) throw new Error('Semantic Model の接続設定がありません。');
  const proxy = new EmbedFabricApiProxy(new SemanticModelMessageClient());
  client = new FabricClient({ proxy, ...fabricConfig } as FabricClientConfig);
  return client;
}