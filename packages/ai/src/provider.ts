import type { Language, LeadData } from '@property-ai/shared';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  text: string;
  language: Language;
}

export interface AIProvider {
  generateResponse(
    messages: ConversationMessage[],
    systemPrompt: string,
    language?: Language
  ): Promise<AIResponse>;

  extractLeadData(
    transcript: string,
    existingData?: Partial<LeadData>
  ): Promise<Partial<LeadData>>;

  summarizeConversation(messages: ConversationMessage[]): Promise<string>;
}
