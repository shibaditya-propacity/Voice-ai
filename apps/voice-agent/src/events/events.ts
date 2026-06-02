/**
 * events.ts — Central event type registry for the voice pipeline.
 *
 * ARCHITECTURE PRINCIPLE: No service directly calls another service.
 * All communication is through events. This decouples every layer and
 * makes the pipeline observable, testable, and replaceable.
 */

// ─── Event name constants ──────────────────────────────────────────────────

export const VoiceEvents = {
  // Call lifecycle
  CALL_STARTED:       'call:started',
  CALL_ENDED:         'call:ended',
  CALL_TRANSFERRED:   'call:transferred',

  // Audio gateway
  AUDIO_CHUNK_RECEIVED: 'audio:chunk_received',
  AUDIO_CHUNK_SENT:     'audio:chunk_sent',
  AUDIO_BUFFER_CLEARED: 'audio:buffer_cleared',

  // Voice Activity Detection
  USER_STARTED_SPEAKING: 'vad:speaking_start',
  USER_STOPPED_SPEAKING:  'vad:speaking_stop',

  // Transcription (from STT)
  PARTIAL_TRANSCRIPT: 'stt:partial',
  FINAL_TRANSCRIPT:   'stt:final',

  // Orchestrator → Planner
  INTENT_DETECTED: 'intent:detected',

  // Tool execution
  TOOL_REQUESTED: 'tool:requested',
  TOOL_STARTED:   'tool:started',
  TOOL_COMPLETED: 'tool:completed',
  TOOL_FAILED:    'tool:failed',

  // LLM streaming
  LLM_RESPONSE_STARTED:   'llm:started',
  LLM_RESPONSE_STREAMING: 'llm:streaming',
  LLM_RESPONSE_FINISHED:  'llm:finished',

  // TTS
  TTS_STARTED:     'tts:started',
  TTS_STREAMING:   'tts:streaming',
  TTS_FINISHED:    'tts:finished',
  TTS_CHUNK_READY: 'tts:chunk_ready',

  // Barge-in (highest priority)
  BARGE_IN_DETECTED: 'bargein:detected',

  // Observability
  LATENCY_RECORDED: 'obs:latency',
} as const;

export type VoiceEventName = typeof VoiceEvents[keyof typeof VoiceEvents];

// ─── Event payload types ───────────────────────────────────────────────────

export interface CallStartedPayload {
  callSid: string;
  streamSid: string;
  from: string;
  correlationId: string;
  timestamp: number;
}

export interface CallEndedPayload {
  callSid: string;
  streamSid: string;
  correlationId: string;
  durationMs: number;
  timestamp: number;
}

export interface AudioChunkPayload {
  callSid: string;
  streamSid: string;
  /** Raw μ-law encoded audio from Twilio (base64-decoded Buffer) */
  audio: Buffer;
  timestamp: number;
  sequenceNumber: number;
}

export interface VadPayload {
  callSid: string;
  streamSid: string;
  timestamp: number;
  /** Energy level at the time of detection (0–1) */
  energyLevel: number;
}

export interface PartialTranscriptPayload {
  callSid: string;
  streamSid: string;
  correlationId: string;
  text: string;
  confidence: number;
  timestamp: number;
}

export interface FinalTranscriptPayload {
  callSid: string;
  streamSid: string;
  correlationId: string;
  text: string;
  confidence: number;
  languageDetected?: string;
  timestamp: number;
  /** Duration of the user's utterance in ms */
  utteranceDurationMs: number;
}

export interface IntentPayload {
  callSid: string;
  correlationId: string;
  intent: string;
  toolRequired: boolean;
  toolName?: string;
  parameters?: Record<string, unknown>;
  rawPlannerOutput: PlannerDecision;
  timestamp: number;
}

export interface PlannerDecision {
  intent: string;
  tool_required: boolean;
  tool_name?: string;
  parameters?: Record<string, unknown>;
  response_style: 'direct' | 'empathetic' | 'urgent' | 'informational';
  sentiment_detected: 'positive' | 'neutral' | 'negative' | 'frustrated';
}

export interface ToolRequestPayload {
  callSid: string;
  correlationId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  requestId: string;
  timestamp: number;
}

export interface ToolResultPayload {
  callSid: string;
  correlationId: string;
  toolName: string;
  requestId: string;
  result: unknown;
  durationMs: number;
  timestamp: number;
}

export interface ToolFailurePayload {
  callSid: string;
  correlationId: string;
  toolName: string;
  requestId: string;
  error: string;
  retryCount: number;
  timestamp: number;
}

export interface LlmStreamingPayload {
  callSid: string;
  correlationId: string;
  textChunk: string;
  /** Accumulated text so far */
  accumulatedText: string;
  timestamp: number;
}

export interface LlmFinishedPayload {
  callSid: string;
  correlationId: string;
  fullText: string;
  tokenCount?: number;
  durationMs: number;
  timestamp: number;
}

export interface TtsChunkPayload {
  callSid: string;
  streamSid: string;
  correlationId: string;
  /** μ-law encoded audio at 8kHz ready to send directly to Twilio */
  audioBuffer: Buffer;
  chunkIndex: number;
  isFinal: boolean;
  timestamp: number;
}

export interface BargeInPayload {
  callSid: string;
  streamSid: string;
  correlationId: string;
  /** Text that was being spoken when interrupted (for context) */
  interruptedText: string;
  timestamp: number;
}

export interface LatencyPayload {
  callSid: string;
  correlationId: string;
  metric: 'stt_latency' | 'llm_first_token' | 'llm_total' | 'tts_first_audio' | 'tts_total' | 'tool_latency' | 'e2e_latency';
  valueMs: number;
  timestamp: number;
}

// ─── Union map for typed event bus ────────────────────────────────────────

export interface VoiceEventMap {
  [VoiceEvents.CALL_STARTED]:           CallStartedPayload;
  [VoiceEvents.CALL_ENDED]:             CallEndedPayload;
  [VoiceEvents.AUDIO_CHUNK_RECEIVED]:   AudioChunkPayload;
  [VoiceEvents.USER_STARTED_SPEAKING]:  VadPayload;
  [VoiceEvents.USER_STOPPED_SPEAKING]:  VadPayload;
  [VoiceEvents.PARTIAL_TRANSCRIPT]:     PartialTranscriptPayload;
  [VoiceEvents.FINAL_TRANSCRIPT]:       FinalTranscriptPayload;
  [VoiceEvents.INTENT_DETECTED]:        IntentPayload;
  [VoiceEvents.TOOL_REQUESTED]:         ToolRequestPayload;
  [VoiceEvents.TOOL_STARTED]:           ToolRequestPayload;
  [VoiceEvents.TOOL_COMPLETED]:         ToolResultPayload;
  [VoiceEvents.TOOL_FAILED]:            ToolFailurePayload;
  [VoiceEvents.LLM_RESPONSE_STARTED]:   { callSid: string; correlationId: string; timestamp: number };
  [VoiceEvents.LLM_RESPONSE_STREAMING]: LlmStreamingPayload;
  [VoiceEvents.LLM_RESPONSE_FINISHED]:  LlmFinishedPayload;
  [VoiceEvents.TTS_STARTED]:            { callSid: string; correlationId: string; text: string; timestamp: number };
  [VoiceEvents.TTS_CHUNK_READY]:        TtsChunkPayload;
  [VoiceEvents.TTS_FINISHED]:           { callSid: string; correlationId: string; timestamp: number };
  [VoiceEvents.BARGE_IN_DETECTED]:      BargeInPayload;
  [VoiceEvents.AUDIO_BUFFER_CLEARED]:   { callSid: string; streamSid: string; timestamp: number };
  [VoiceEvents.LATENCY_RECORDED]:       LatencyPayload;
  [VoiceEvents.CALL_TRANSFERRED]:       { callSid: string; to: string; timestamp: number };
  [VoiceEvents.TTS_STREAMING]:          TtsChunkPayload;
  [VoiceEvents.AUDIO_CHUNK_SENT]:       { callSid: string; bytes: number; timestamp: number };
}
