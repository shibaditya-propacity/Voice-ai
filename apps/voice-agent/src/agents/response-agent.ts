/**
 * agents/response-agent.ts — Natural spoken response generation (streaming).
 *
 * Stage 2 of the two-stage LLM pipeline.
 *
 * INPUT:
 *   - conversation state (lead info, stage, history)
 *   - planner decision (intent, sentiment)
 *   - tool results (if any tools were called)
 *   - the user's transcript
 *
 * OUTPUT: AsyncIterable<string> — text tokens streamed as they generate.
 *
 * The first token MUST arrive before the Speech Chunker can send text to TTS.
 * Target: first token < 250ms.
 *
 * This agent generates ONLY the spoken response — natural, human-like,
 * 2-3 sentences maximum (more would take too long to speak).
 *
 * The LLM here is Raj Mehta — the persona. The system prompt is the
 * full character definition from prompts.ts, augmented with tool results.
 */

import { createChildLogger } from '@property-ai/logger';
import type { BedrockStreamingProvider } from '../providers/llm/bedrock-streaming.js';
import type { PlannerDecision } from '../events/events.js';
import type { ConversationState } from '../session/session-store.js';
import type { ToolExecutionResult } from '../tools/tool-router.js';
import { getSystemPrompt } from '@property-ai/ai';

export type { ToolExecutionResult };

const log = createChildLogger({ module: 'response-agent' });

function buildResponseMessages(
  state: ConversationState,
  transcript: string,
  decision: PlannerDecision,
  toolResults: ToolExecutionResult[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  // Keep last 8 turns (4 exchanges) for response context
  const history = state.messages.slice(-8).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  })).filter(m => m.role === 'user' || m.role === 'assistant');

  // Build tool context block
  const toolContext = toolResults.length > 0
    ? `\nINFORMATION FROM TOOLS:\n${toolResults.map(r =>
        `[${r.toolName}]: ${r.result.message}`
      ).join('\n')}`
    : '';

  // Build state context for Raj to stay on track
  const stateContext = `
CURRENT LEAD STATUS:
- Name: ${state.leadData.name ?? 'not yet collected'}
- Budget discussed: ${state.leadData.budget ?? 'no'}
- BHK requirement: ${state.leadData.bhk ?? 'not discussed'}
- Site visit booked: ${state.leadData.siteVisitBooked ? `YES — ${state.leadData.siteVisitDate}` : 'not yet'}
- Conversation stage: ${state.stage}
- Customer sentiment: ${decision.sentiment_detected}
- Intent detected: ${decision.intent}
${toolContext}
`.trim();

  const userMessage = `${stateContext}\n\nCustomer just said: "${transcript}"\n\nRespond as Raj Mehta now (2-3 sentences max, spoken style):`;

  return [
    ...history,
    { role: 'user', content: userMessage },
  ];
}

/**
 * Stream Raj's response token by token.
 * Pipe the output directly to SpeechChunker → TTS.
 *
 * Returns an AsyncIterable — consume it immediately. The caller is
 * responsible for forwarding tokens to the TTS pipeline.
 */
export async function* runResponseAgent(
  llm: BedrockStreamingProvider,
  state: ConversationState,
  transcript: string,
  decision: PlannerDecision,
  toolResults: ToolExecutionResult[],
  correlationId: string
): AsyncIterable<string> {
  const start = Date.now();
  let firstTokenAt: number | null = null;

  log.debug({ correlationId, intent: decision.intent, hasTools: toolResults.length > 0 }, 'Response agent starting');

  const messages = buildResponseMessages(state, transcript, decision, toolResults);
  const systemPrompt = getSystemPrompt(state.language);

  try {
    for await (const token of llm.stream(messages, {
      system: systemPrompt,
      maxTokens: 200,      // ~3 sentences = sufficient for voice
      temperature: 0.6,   // Some creativity for natural speech variation
    })) {
      if (firstTokenAt === null) {
        firstTokenAt = Date.now();
        log.debug({ correlationId, firstTokenMs: firstTokenAt - start }, 'Response agent first token');
      }
      yield token;
    }
  } catch (err) {
    log.error({ err, correlationId }, 'Response agent failed');
    // Yield a graceful fallback so TTS doesn't hang
    yield getLanguageFallback(state.language);
  }

  log.debug({
    correlationId,
    totalMs: Date.now() - start,
    firstTokenMs: firstTokenAt ? firstTokenAt - start : null,
  }, 'Response agent complete');
}

function getLanguageFallback(language: string): string {
  const fallbacks: Record<string, string> = {
    en: 'Let me check on that and get back to you right away.',
    hi: 'मैं अभी इसकी जाँच करता हूं।',
    mr: 'मी लगेच तपासतो.',
  };
  return fallbacks[language] ?? fallbacks['en']!;
}
