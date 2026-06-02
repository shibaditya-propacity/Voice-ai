/**
 * providers/llm/provider.ts — LLM Provider interface.
 *
 * Two distinct LLM call patterns used in this system:
 *
 * 1. STRUCTURED (Planner): Returns a JSON plan object.
 *    Input: conversation context
 *    Output: { intent, tool_required, tool_name, parameters }
 *    No streaming needed — we need the full plan before acting.
 *
 * 2. STREAMING (Response Agent): Returns text tokens as they generate.
 *    Input: context + tool results
 *    Output: AsyncIterable<string> of text tokens
 *    MUST stream — first token goes to TTS immediately.
 */

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmCallOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Tool definitions for Claude tool_use */
  tools?: LlmToolDefinition[];
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmStructuredResponse<T = unknown> {
  content: T;
  toolCalls?: LlmToolCall[];
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmProvider {
  /**
   * Non-streaming call — returns full response.
   * Use for Planner Agent (structured JSON decisions).
   */
  complete(
    messages: LlmMessage[],
    options?: LlmCallOptions
  ): Promise<LlmStructuredResponse<string>>;

  /**
   * Streaming call — returns token-by-token AsyncIterable.
   * Use for Response Agent (speech generation).
   * First token must arrive within 200ms for sub-1s E2E latency.
   */
  stream(
    messages: LlmMessage[],
    options?: LlmCallOptions
  ): AsyncIterable<string>;

  readonly name: string;
  readonly modelId: string;
}
