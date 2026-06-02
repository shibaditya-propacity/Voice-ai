/**
 * orchestrator/context-assembler.ts — Assembles structured context for Claude.
 *
 * The Orchestrator calls this before invoking any LLM agent.
 * It builds a complete picture of the conversation state that Claude needs
 * to make good decisions — without Claude having to manage state itself.
 */

import type { ConversationState } from '../session/session-store.js';

export interface AssembledContext {
  /** Lead info collected so far */
  leadSnapshot: ConversationState['leadData'];
  /** Current conversation stage */
  stage: ConversationState['stage'];
  /** Last N messages for context */
  recentMessages: Array<{ role: string; content: string; timestamp: number }>;
  /** Detected language */
  language: string;
  /** True if the customer has already agreed to a site visit */
  siteVisitBooked: boolean;
  /** Summary of what we know about the customer's needs */
  needsSummary: string;
}

export function assembleContext(state: ConversationState): AssembledContext {
  const recent = state.messages.slice(-10);

  // Build a plain-English needs summary from known lead data
  const needs: string[] = [];
  if (state.leadData.bhk) needs.push(`${state.leadData.bhk} BHK`);
  if (state.leadData.budget) needs.push(`budget: ${state.leadData.budget}`);
  if (state.leadData.area) needs.push(`preferred area: ${state.leadData.area}`);
  if (state.leadData.timeline) needs.push(`timeline: ${state.leadData.timeline}`);
  if (state.leadData.loanRequired !== undefined) {
    needs.push(`loan ${state.leadData.loanRequired ? 'required' : 'not required'}`);
  }

  return {
    leadSnapshot: state.leadData,
    stage: state.stage,
    recentMessages: recent.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
    language: state.language,
    siteVisitBooked: state.leadData.siteVisitBooked ?? false,
    needsSummary: needs.length > 0 ? needs.join(', ') : 'needs not yet established',
  };
}
