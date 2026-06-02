/**
 * agents/planner-agent.ts — Intent detection and tool planning.
 *
 * Stage 1 of the two-stage LLM pipeline.
 *
 * INPUT:  conversation context (state, history, transcript)
 * OUTPUT: structured decision — what to do next
 *
 * The Planner answers ONLY these questions:
 *   1. What did the user intend?
 *   2. Do we need a tool call? Which one? With what parameters?
 *   3. What response style is appropriate?
 *
 * The Planner does NOT generate the spoken response — that's the Response Agent.
 * The Planner output is a machine-readable JSON object, not natural language.
 *
 * Why two stages?
 *   - The Planner is fast (small JSON output, low token count)
 *   - Separating planning from response generation makes both better
 *   - The Orchestrator gets a typed decision — no parsing of natural language
 *   - Tool calls are explicit, not hallucinated
 *
 * Latency target: < 300ms (non-streaming, small output)
 */

import { createChildLogger } from '@property-ai/logger';
import type { BedrockStreamingProvider } from '../providers/llm/bedrock-streaming.js';
import type { PlannerDecision } from '../events/events.js';
import type { ConversationState } from '../session/session-store.js';
import { TOOL_DEFINITIONS } from '../tools/tool-registry.js';

const log = createChildLogger({ module: 'planner-agent' });

const PLANNER_SYSTEM_PROMPT = `You are a planning assistant for a voice AI real estate agent named Raj Mehta.

Your ONLY job is to analyze the customer's message and return a JSON planning decision.
DO NOT generate the actual spoken response. DO NOT be conversational. ONLY output JSON.

You will receive:
- The customer's transcript
- The current conversation state
- The conversation history

Return ONLY valid JSON in this exact format:
{
  "intent": "<one of: greeting, name_inquiry, price_inquiry, availability_inquiry, budget_discussion, bhk_discussion, location_discussion, site_visit_agreement, site_visit_refusal, objection_price, objection_timing, competitor_mention, callback_request, general_inquiry, farewell, unclear>",
  "tool_required": <true or false>,
  "tool_name": "<tool name or null>",
  "parameters": <tool parameters object or null>,
  "response_style": "<one of: direct, empathetic, urgent, informational>",
  "sentiment_detected": "<one of: positive, neutral, negative, frustrated>"
}

RULES:
- Only set tool_required=true when you are CERTAIN a tool call adds value
- update_lead_info when you learn: name, budget, BHK preference, loan need, timeline
- search_properties when customer wants to know about properties/prices
- book_site_visit ONLY when customer explicitly agrees to visit ("yes I'll come", "book it", "when can I visit")
- check_unit_availability when customer asks about specific unit types
- DO NOT call tools for simple factual questions you can answer from context
- Always set intent accurately — it drives the orchestrator's routing logic
`;

function buildPlannerMessages(
  state: ConversationState,
  transcript: string
): Array<{ role: 'user' | 'assistant'; content: string }> {
  // Include last 6 turns of history for context (more would slow the planner)
  const recentHistory = state.messages.slice(-6).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  })).filter(m => m.role === 'user' || m.role === 'assistant');

  const contextBlock = `
CURRENT CONVERSATION STATE:
- Stage: ${state.stage}
- Customer name: ${state.leadData.name ?? 'unknown'}
- Budget: ${state.leadData.budget ?? 'not discussed'}
- BHK requirement: ${state.leadData.bhk ?? 'not discussed'}
- Site visit booked: ${state.leadData.siteVisitBooked ? 'YES' : 'no'}
- Language: ${state.language}

RECENT CONVERSATION:
${recentHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}

CURRENT USER MESSAGE:
"${transcript}"

Return the JSON plan now.
`.trim();

  return [{ role: 'user', content: contextBlock }];
}

function parsePlannerOutput(raw: string): PlannerDecision {
  try {
    // Extract JSON — Claude sometimes adds prose before/after
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in planner output');
    const parsed = JSON.parse(match[0]) as PlannerDecision;

    // Validate required fields
    if (!parsed.intent) parsed.intent = 'general_inquiry';
    if (typeof parsed.tool_required !== 'boolean') parsed.tool_required = false;
    if (!parsed.response_style) parsed.response_style = 'direct';
    if (!parsed.sentiment_detected) parsed.sentiment_detected = 'neutral';

    return parsed;
  } catch (err) {
    log.warn({ err, raw }, 'Failed to parse planner output — using fallback');
    return {
      intent: 'general_inquiry',
      tool_required: false,
      response_style: 'direct',
      sentiment_detected: 'neutral',
    };
  }
}

export async function runPlannerAgent(
  llm: BedrockStreamingProvider,
  state: ConversationState,
  transcript: string,
  correlationId: string
): Promise<PlannerDecision> {
  const start = Date.now();

  log.debug({ correlationId, stage: state.stage, transcript: transcript.slice(0, 100) }, 'Planner starting');

  const messages = buildPlannerMessages(state, transcript);

  const response = await llm.complete(messages, {
    system: PLANNER_SYSTEM_PROMPT,
    maxTokens: 150,    // JSON output is small — cap tightly to reduce latency
    temperature: 0.1,  // Low temperature — we want deterministic plans
    // NOTE: Do NOT pass tools here. Passing tools causes Claude to respond with
    // tool_use blocks instead of JSON text, breaking parsePlannerOutput.
    // The planner reads tool names from the prompt and outputs them as JSON fields.
  });

  const decision = parsePlannerOutput(response.content);

  log.info({
    correlationId,
    intent: decision.intent,
    toolRequired: decision.tool_required,
    toolName: decision.tool_name,
    latencyMs: Date.now() - start,
    sentiment: decision.sentiment_detected,
  }, 'Planner decision');

  return decision;
}
