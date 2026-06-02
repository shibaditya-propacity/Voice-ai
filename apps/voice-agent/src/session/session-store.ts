/**
 * session-store.ts — Conversation state management for active calls.
 *
 * Stores the full ConversationState for every active call.
 * Architecture: in-memory map (fast), with a Redis layer ready for
 * multi-instance deployments (swap out the store backend).
 *
 * The state here is the SINGLE SOURCE OF TRUTH for conversation context.
 * Claude never owns state — the orchestrator does, via this store.
 */

import { createChildLogger } from '@property-ai/logger';
import type { Language } from '@property-ai/shared';
import type { CallMetricsTracker } from '../observability/metrics.js';

const log = createChildLogger({ module: 'session-store' });

// ─── State Types ───────────────────────────────────────────────────────────

export type ConversationStage =
  | 'greeting'
  | 'name_collection'
  | 'needs_assessment'
  | 'property_pitch'
  | 'objection_handling'
  | 'site_visit_push'
  | 'booking_confirmed'
  | 'follow_up'
  | 'closing';

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  correlationId?: string;
}

export interface LeadSnapshot {
  phone?: string;
  name?: string;
  email?: string;
  city?: string;
  area?: string;
  budget?: string;
  bhk?: string;
  propertyType?: string;
  loanRequired?: boolean;
  timeline?: string;
  siteVisitBooked?: boolean;
  siteVisitDate?: string;
  score?: number;
}

export interface ConversationState {
  // Identifiers
  callSid: string;
  streamSid: string;
  correlationId: string;       // call-level correlation ID
  leadId?: string;

  // Caller
  phoneNumber: string;
  language: Language;

  // Conversation flow
  stage: ConversationStage;
  messages: ConversationMessage[];
  leadData: LeadSnapshot;

  // Real-time state
  isAgentSpeaking: boolean;
  isSpeakingInterrupted: boolean;
  /** Text currently being spoken (for barge-in context) */
  currentResponseText: string;
  /** Accumulated partial transcript from STT */
  partialTranscript: string;

  // Lifecycle
  createdAt: number;
  lastActivityAt: number;

  // Injected metrics tracker (not serialized)
  metrics?: CallMetricsTracker;
}

// ─── Store implementation ─────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

class SessionStore {
  private readonly sessions = new Map<string, ConversationState>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    // Clean up stale sessions every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  create(
    callSid: string,
    streamSid: string,
    phoneNumber: string,
    correlationId: string
  ): ConversationState {
    const state: ConversationState = {
      callSid,
      streamSid,
      correlationId,
      phoneNumber,
      language: 'en',
      stage: 'greeting',
      messages: [],
      leadData: { phone: phoneNumber },
      isAgentSpeaking: false,
      isSpeakingInterrupted: false,
      currentResponseText: '',
      partialTranscript: '',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this.sessions.set(callSid, state);
    log.debug({ callSid, phoneNumber }, 'Session created');
    return state;
  }

  get(callSid: string): ConversationState | undefined {
    const state = this.sessions.get(callSid);
    if (state) state.lastActivityAt = Date.now();
    return state;
  }

  update(callSid: string, patch: Partial<ConversationState>): ConversationState | undefined {
    const state = this.sessions.get(callSid);
    if (!state) {
      log.warn({ callSid }, 'Session not found for update');
      return undefined;
    }
    Object.assign(state, patch, { lastActivityAt: Date.now() });
    return state;
  }

  appendMessage(callSid: string, message: Omit<ConversationMessage, 'timestamp'>): void {
    const state = this.sessions.get(callSid);
    if (!state) return;
    state.messages.push({ ...message, timestamp: Date.now() });
    state.lastActivityAt = Date.now();
  }

  delete(callSid: string): void {
    this.sessions.delete(callSid);
    log.debug({ callSid }, 'Session deleted');
  }

  count(): number {
    return this.sessions.size;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [callSid, state] of this.sessions) {
      if (now - state.lastActivityAt > SESSION_TTL_MS) {
        log.warn({ callSid }, 'Session expired due to inactivity — cleaning up');
        this.sessions.delete(callSid);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.sessions.clear();
  }
}

// Singleton session store
export const sessionStore = new SessionStore();
