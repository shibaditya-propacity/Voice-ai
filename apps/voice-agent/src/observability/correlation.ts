/**
 * correlation.ts — Correlation ID management for distributed tracing.
 *
 * Every user utterance gets a unique correlation ID that flows through:
 * STT → Orchestrator → Planner → Tool Router → Response Agent → TTS
 *
 * This lets you reconstruct the full trace of any response in logs.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a new correlation ID for a user utterance.
 * Format: utt_{callSid_prefix}_{timestamp}_{random}
 */
export function newCorrelationId(callSid: string): string {
  const prefix = callSid.slice(-6);       // last 6 chars of callSid
  const ts = Date.now().toString(36);     // base36 timestamp (compact)
  const rand = uuidv4().slice(0, 8);     // 8 random chars
  return `utt_${prefix}_${ts}_${rand}`;
}

/**
 * Generate a call-level correlation ID (used for the entire call lifecycle).
 */
export function newCallCorrelationId(callSid: string): string {
  return `call_${callSid}`;
}

/**
 * Generate a tool execution ID.
 */
export function newToolRequestId(toolName: string): string {
  return `tool_${toolName}_${uuidv4().slice(0, 8)}`;
}
