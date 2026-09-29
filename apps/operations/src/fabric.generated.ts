export const fabricConfig = {
  semanticModels: {
    'maikuroV3Live': {
      workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID || '',
      itemId: import.meta.env.VITE_SEMANTIC_MODEL_ID || '',
    },
  },
} as const;
