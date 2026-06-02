/**
 * metrics.ts — Per-call latency tracking and structured performance logging.
 *
 * Tracks the key latency milestones for every user→agent interaction:
 *   1. STT latency      — time from speech-end to final transcript
 *   2. LLM first token  — time from transcript to first LLM output token
 *   3. LLM total        — time from transcript to full LLM response
 *   4. TTS first audio  — time from first LLM text chunk to first audio chunk
 *   5. TTS total        — time from first LLM text chunk to last audio chunk
 *   6. E2E latency      — time from speech-end to first audio byte played
 *   7. Tool latency     — per-tool execution time
 *
 * Target: E2E < 1000ms for a simple response, < 2500ms with tool calls.
 */

import { createChildLogger } from '@property-ai/logger';

const log = createChildLogger({ module: 'metrics' });

export interface UtteranceMetrics {
  correlationId: string;
  callSid: string;

  // Speech
  speechStartedAt?: number;
  speechEndedAt?: number;
  sttFinalAt?: number;

  // LLM
  llmStartedAt?: number;
  llmFirstTokenAt?: number;
  llmFinishedAt?: number;

  // TTS
  ttsStartedAt?: number;
  ttsFirstAudioAt?: number;
  ttsFinishedAt?: number;

  // Tools (per tool)
  toolLatencies: Record<string, number>;

  // Derived
  sttLatencyMs?: number;
  llmFirstTokenLatencyMs?: number;
  llmTotalLatencyMs?: number;
  ttsFirstAudioLatencyMs?: number;
  ttsTotalLatencyMs?: number;
  e2eLatencyMs?: number;
}

export class CallMetricsTracker {
  private readonly utterances = new Map<string, UtteranceMetrics>();
  private readonly callSid: string;

  constructor(callSid: string) {
    this.callSid = callSid;
  }

  startUtterance(correlationId: string): void {
    this.utterances.set(correlationId, {
      correlationId,
      callSid: this.callSid,
      speechStartedAt: Date.now(),
      toolLatencies: {},
    });
  }

  markSpeechEnd(correlationId: string): void {
    const m = this.utterances.get(correlationId);
    if (m) m.speechEndedAt = Date.now();
  }

  markSttFinal(correlationId: string): void {
    const m = this.utterances.get(correlationId);
    if (!m) return;
    m.sttFinalAt = Date.now();
    if (m.speechEndedAt) {
      m.sttLatencyMs = m.sttFinalAt - m.speechEndedAt;
    }
  }

  markLlmStart(correlationId: string): void {
    const m = this.utterances.get(correlationId);
    if (m) m.llmStartedAt = Date.now();
  }

  markLlmFirstToken(correlationId: string): void {
    const m = this.utterances.get(correlationId);
    if (!m) return;
    m.llmFirstTokenAt = Date.now();
    if (m.sttFinalAt) {
      m.llmFirstTokenLatencyMs = m.llmFirstTokenAt - m.sttFinalAt;
    }
  }

  markLlmFinished(correlationId: string): void {
    const m = this.utterances.get(correlationId);
    if (!m) return;
    m.llmFinishedAt = Date.now();
    if (m.llmStartedAt) {
      m.llmTotalLatencyMs = m.llmFinishedAt - m.llmStartedAt;
    }
  }

  markTtsStart(correlationId: string): void {
    const m = this.utterances.get(correlationId);
    if (m) m.ttsStartedAt = Date.now();
  }

  markTtsFirstAudio(correlationId: string): void {
    const m = this.utterances.get(correlationId);
    if (!m) return;
    m.ttsFirstAudioAt = Date.now();
    if (m.ttsStartedAt) {
      m.ttsFirstAudioLatencyMs = m.ttsFirstAudioAt - m.ttsStartedAt;
    }
    // E2E = from speech end → first audio played
    if (m.speechEndedAt) {
      m.e2eLatencyMs = m.ttsFirstAudioAt - m.speechEndedAt;
    }
  }

  markTtsFinished(correlationId: string): void {
    const m = this.utterances.get(correlationId);
    if (!m) return;
    m.ttsFinishedAt = Date.now();
    if (m.ttsStartedAt) {
      m.ttsTotalLatencyMs = m.ttsFinishedAt - m.ttsStartedAt;
    }
    this.logMetrics(correlationId);
  }

  markToolLatency(correlationId: string, toolName: string, durationMs: number): void {
    const m = this.utterances.get(correlationId);
    if (m) m.toolLatencies[toolName] = durationMs;
  }

  private logMetrics(correlationId: string): void {
    const m = this.utterances.get(correlationId);
    if (!m) return;

    log.info({
      correlationId,
      callSid: this.callSid,
      stt_latency_ms: m.sttLatencyMs,
      llm_first_token_ms: m.llmFirstTokenLatencyMs,
      llm_total_ms: m.llmTotalLatencyMs,
      tts_first_audio_ms: m.ttsFirstAudioLatencyMs,
      tts_total_ms: m.ttsTotalLatencyMs,
      e2e_latency_ms: m.e2eLatencyMs,
      tool_latencies: m.toolLatencies,
      // Flag violations of our 1s target
      exceeds_target: (m.e2eLatencyMs ?? 0) > 1000,
    }, 'Utterance metrics');
  }

  getMetrics(correlationId: string): UtteranceMetrics | undefined {
    return this.utterances.get(correlationId);
  }

  /** Call-level summary on call end */
  summarize(): void {
    const all = Array.from(this.utterances.values());
    if (all.length === 0) return;

    const e2eValues = all.map(m => m.e2eLatencyMs ?? 0).filter(v => v > 0);
    const avgE2e = e2eValues.reduce((a, b) => a + b, 0) / (e2eValues.length || 1);
    const maxE2e = Math.max(...e2eValues, 0);

    log.info({
      callSid: this.callSid,
      utterance_count: all.length,
      avg_e2e_latency_ms: Math.round(avgE2e),
      max_e2e_latency_ms: maxE2e,
      target_breaches: e2eValues.filter(v => v > 1000).length,
    }, 'Call metrics summary');
  }
}
