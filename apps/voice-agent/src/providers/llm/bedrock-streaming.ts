/**
 * providers/llm/bedrock-streaming.ts — Claude on Amazon Bedrock with streaming.
 *
 * Extends the existing BedrockClaudeProvider with:
 *   1. Streaming support (messages.stream API) for Response Agent
 *   2. Tool use (for Planner tool routing)
 *   3. Structured output enforcement
 *
 * Model: us.anthropic.claude-sonnet-4-6
 *   - Best balance of speed and quality for voice applications
 *   - Streaming first token typically arrives in 150–350ms
 *   - Supports tool_use natively
 *
 * IMPORTANT: The LLM never orchestrates. It receives structured context
 * and returns structured decisions or streaming text. The Orchestrator
 * decides what to do with the output.
 */

import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { createChildLogger } from '@property-ai/logger';
import type {
  LlmProvider,
  LlmMessage,
  LlmCallOptions,
  LlmStructuredResponse,
  LlmToolDefinition,
} from './provider.js';

const log = createChildLogger({ module: 'bedrock-llm' });

function toAnthropicTools(tools: LlmToolDefinition[]) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

export class BedrockStreamingProvider implements LlmProvider {
  readonly name = 'bedrock';
  readonly modelId: string;
  private readonly client: AnthropicBedrock;

  constructor(region?: string, modelId?: string) {
    this.modelId = modelId ?? process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
    this.client = new AnthropicBedrock({
      awsRegion: region ?? process.env.AWS_REGION ?? 'us-east-1',
      awsAccessKey: process.env.AWS_ACCESS_KEY_ID,
      awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY,
    });
  }

  async complete(
    messages: LlmMessage[],
    options: LlmCallOptions = {}
  ): Promise<LlmStructuredResponse<string>> {
    const start = Date.now();

    try {
      const response = await this.client.messages.create({
        model: this.modelId,
        max_tokens: options.maxTokens ?? 512,
        temperature: options.temperature ?? 0.3,
        ...(options.system ? { system: options.system } : {}),
        ...(options.tools?.length ? { tools: toAnthropicTools(options.tools) } : {}),
        messages: messages as Array<{ role: 'user' | 'assistant'; content: string }>,
      });

      const textBlock = response.content.find(b => b.type === 'text');
      const toolBlocks = response.content.filter(b => b.type === 'tool_use');

      const result: LlmStructuredResponse<string> = {
        content: textBlock?.type === 'text' ? textBlock.text : '',
        toolCalls: toolBlocks.map(b => b.type === 'tool_use' ? ({
          id: b.id,
          name: b.name,
          input: b.input as Record<string, unknown>,
        }) : null).filter(Boolean) as LlmStructuredResponse['toolCalls'],
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };

      log.debug({
        model: this.modelId,
        latencyMs: Date.now() - start,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      }, 'LLM complete');

      return result;
    } catch (err) {
      log.error({ err, latencyMs: Date.now() - start }, 'LLM complete failed');
      throw err;
    }
  }

  async *stream(
    messages: LlmMessage[],
    options: LlmCallOptions = {}
  ): AsyncIterable<string> {
    const start = Date.now();
    let firstTokenAt: number | null = null;
    let tokenCount = 0;

    try {
      const stream = await this.client.messages.stream({
        model: this.modelId,
        max_tokens: options.maxTokens ?? 300,
        temperature: options.temperature ?? 0.5,
        ...(options.system ? { system: options.system } : {}),
        messages: messages as Array<{ role: 'user' | 'assistant'; content: string }>,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          if (firstTokenAt === null) {
            firstTokenAt = Date.now();
            log.debug({ firstTokenLatencyMs: firstTokenAt - start }, 'LLM first token');
          }
          tokenCount++;
          yield event.delta.text;
        }
      }

      log.debug({
        model: this.modelId,
        totalLatencyMs: Date.now() - start,
        firstTokenMs: firstTokenAt ? firstTokenAt - start : null,
        tokenCount,
      }, 'LLM stream complete');

    } catch (err) {
      log.error({ err }, 'LLM stream failed');
      throw err;
    }
  }
}
