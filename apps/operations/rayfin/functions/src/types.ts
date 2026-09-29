export interface CopilotHistoryMessage {
  role: 'assistant' | 'user';
  content: string;
}

export interface CopilotReference {
  id: string;
  label: string;
  text: string;
  url?: string;
}

export interface CopilotStoredMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  context: string;
  references: CopilotReference[];
}

export interface CopilotChatOutput {
  answer: string;
  context: string;
  conversationId: string;
  references: CopilotReference[];
}

export type AppFunctionsSchema = {
  chat: {
    input: {
      userId: string;
      conversationId: string;
      messageId: string;
      question: string;
      history: CopilotHistoryMessage[];
      contextJson: string;
    };
    output: CopilotChatOutput;
  };
  getCopilotHistory: {
    input: { userId: string; conversationId: string };
    output: { conversationId: string; messages: CopilotStoredMessage[] };
  };
};