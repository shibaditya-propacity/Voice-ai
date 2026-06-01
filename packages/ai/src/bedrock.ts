import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import type { AIProvider, ConversationMessage, AIResponse } from './provider.js';
import type { Language, LeadData } from '@property-ai/shared';
import { createChildLogger } from '@property-ai/logger';
import {
  getSystemPrompt,
  LEAD_EXTRACTION_PROMPT,
  SUMMARIZE_PROMPT,
  LANGUAGE_DETECTION_PROMPT,
} from './prompts.js';

const log = createChildLogger({ module: 'bedrock-provider' });

export class BedrockClaudeProvider implements AIProvider {
  private client: AnthropicBedrock;
  private modelId: string;

  constructor(
    region: string = process.env.AWS_REGION ?? 'us-east-1',
    modelId: string = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6'
  ) {
    this.client = new AnthropicBedrock({
      awsRegion: region,
      awsAccessKey: process.env.AWS_ACCESS_KEY_ID,
      awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY,
    });
    this.modelId = modelId;
  }

  private async invoke(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    system?: string,
    maxTokens = 512
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: this.modelId,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages,
    });

    const block = response.content[0];
    return block?.type === 'text' ? block.text : '';
  }

  private async detectLanguage(text: string): Promise<Language> {
    try {
      const result = await this.invoke(
        [{ role: 'user', content: `${LANGUAGE_DETECTION_PROMPT}"${text}"` }],
        undefined,
        10
      );
      const lang = result.trim().toLowerCase();
      if (lang === 'hi') return 'hi';
      if (lang === 'mr') return 'mr';
      return 'en';
    } catch (err) {
      log.warn({ err }, 'Language detection failed, defaulting to English');
      return 'en';
    }
  }

  async generateResponse(
    messages: ConversationMessage[],
    _systemPrompt: string,
    language?: Language
  ): Promise<AIResponse> {
    const lastUserMessage = messages.filter((m) => m.role === 'user').pop();
    const detectedLanguage =
      language ?? (lastUserMessage ? await this.detectLanguage(lastUserMessage.content) : 'en');

    const systemPrompt = getSystemPrompt(detectedLanguage);
    log.info({ language: detectedLanguage, messageCount: messages.length }, 'Generating AI response');

    const text = await this.invoke(
      messages as Array<{ role: 'user' | 'assistant'; content: string }>,
      systemPrompt,
      80  // 2 sentences max = faster AI + faster TTS
    );

    return { text, language: detectedLanguage };
  }

  async extractLeadData(
    transcript: string,
    existingData?: Partial<LeadData>
  ): Promise<Partial<LeadData>> {
    const context = existingData ? `\nExisting data: ${JSON.stringify(existingData)}\n` : '';

    const result = await this.invoke(
      [{ role: 'user', content: `${LEAD_EXTRACTION_PROMPT}${context}\n${transcript}` }],
      'You are a data extraction assistant. Return only valid JSON.',
      256
    );

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return existingData ?? {};
      const parsed = JSON.parse(jsonMatch[0]) as Partial<LeadData>;
      const cleaned: Partial<LeadData> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (value !== null && value !== undefined) {
          (cleaned as Record<string, unknown>)[key] = value;
        }
      }
      return { ...(existingData ?? {}), ...cleaned };
    } catch (err) {
      log.error({ err }, 'Failed to parse lead extraction response');
      return existingData ?? {};
    }
  }

  async summarizeConversation(messages: ConversationMessage[]): Promise<string> {
    const transcript = messages
      .map((m) => `${m.role === 'user' ? 'Customer' : 'Raj'}: ${m.content}`)
      .join('\n');

    return this.invoke(
      [{ role: 'user', content: `${SUMMARIZE_PROMPT}\n${transcript}` }],
      'You are a helpful assistant that summarizes real estate conversations concisely.',
      200
    );
  }
}
