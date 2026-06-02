/**
 * conversation-orchestrator.ts — Deterministic conversation orchestration.
 *
 * THE MOST IMPORTANT FILE IN THE SYSTEM.
 *
 * PRINCIPLE: The LLM never orchestrates. All orchestration is deterministic code.
 * Claude decides WHAT to say and WHAT tools to use.
 * This class decides WHEN to call Claude, WHEN to call tools, WHEN to play audio.
 *
 * The Orchestrator owns:
 *   ✓ Call lifecycle (start, speaking, listening, end)
 *   ✓ Conversation stage transitions
 *   ✓ Barge-in handling
 *   ✓ Context assembly
 *   ✓ Pipeline coordination (STT → Planner → Tools → Response → TTS)
 *   ✓ DB writes (async, never blocking the response path)
 *   ✓ Error recovery
 *
 * The Orchestrator does NOT own:
 *   ✗ Natural language decisions (Claude does)
 *   ✗ Tool logic (ToolWorkers do)
 *   ✗ Audio encoding (AudioGateway does)
 *   ✗ WebSocket management (AudioGateway does)
 *
 * Event flow:
 *   FINAL_TRANSCRIPT
 *     → assemble context
 *     → Planner Agent (Claude, ~200ms)
 *     → [optional] Tool Router (parallel, ~300-500ms)
 *     → Response Agent (Claude streaming, first token ~200ms)
 *     → SpeechChunker → TTS → AudioGateway
 *
 * On BARGE_IN_DETECTED:
 *     → abort TTS stream
 *     → clear Twilio audio buffer (via AudioGateway send "clear")
 *     → wait for next FINAL_TRANSCRIPT
 */

import { createChildLogger } from '@property-ai/logger';
import { prisma } from '@property-ai/database';
import { VoiceEvents } from '../events/events.js';
import type { VoiceEventBus } from '../events/event-bus.js';
import type {
  FinalTranscriptPayload,
  BargeInPayload,
  TtsChunkPayload,
} from '../events/events.js';
import { sessionStore } from '../session/session-store.js';
import type { ConversationState } from '../session/session-store.js';
import { runPlannerAgent } from '../agents/planner-agent.js';
import { runResponseAgent } from '../agents/response-agent.js';
import { executeTools, buildToolExecution } from '../tools/tool-router.js';
import { SpeechChunker } from '../audio/speech-chunker.js';
import { BedrockStreamingProvider } from '../providers/llm/bedrock-streaming.js';
import { ElevenLabsStreamingProvider } from '../providers/tts/elevenlabs-streaming.js';
import { CallMetricsTracker } from '../observability/metrics.js';
import { newCorrelationId, newToolRequestId } from '../observability/correlation.js';
import type { TtsStream } from '../providers/tts/provider.js';

const log = createChildLogger({ module: 'orchestrator' });

// Lazy singletons — instantiated on first call so the module can be loaded
// without env vars present (e.g. during CI health-check startup).
let _llm: BedrockStreamingProvider | null = null;
let _ttsProvider: ElevenLabsStreamingProvider | null = null;

function getLlm(): BedrockStreamingProvider {
  if (!_llm) {
    _llm = new BedrockStreamingProvider(
      undefined,
      process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6'
    );
  }
  return _llm;
}

function getTtsProvider(): ElevenLabsStreamingProvider {
  if (!_ttsProvider) _ttsProvider = new ElevenLabsStreamingProvider();
  return _ttsProvider;
}

export class ConversationOrchestrator {
  private readonly bus: VoiceEventBus;
  private readonly callSid: string;
  private readonly metrics: CallMetricsTracker;

  /** Active TTS stream for the current response (null when silent) */
  private activeTtsStream: TtsStream | null = null;

  /** Accumulated response text (for barge-in context + DB write) */
  private currentResponseText = '';

  /** True when we're mid-response (blocking new transcripts until response ends) */
  private isProcessing = false;

  /** Pending transcript if barge-in cancelled the previous processing */
  private pendingTranscript: FinalTranscriptPayload | null = null;

  constructor(bus: VoiceEventBus, callSid: string) {
    this.bus = bus;
    this.callSid = callSid;
    this.metrics = new CallMetricsTracker(callSid);

    this.attachEventListeners();
  }

  // ─── Event subscriptions ─────────────────────────────────────────────────

  private attachEventListeners(): void {
    // Primary pipeline trigger — fired by STT provider
    this.bus.on(VoiceEvents.FINAL_TRANSCRIPT, (payload) => {
      void this.handleFinalTranscript(payload);
    });

    // Barge-in — highest priority, always handled immediately
    this.bus.on(VoiceEvents.BARGE_IN_DETECTED, (payload) => {
      void this.handleBargeIn(payload);
    });

    // VAD speech start — used to stop ongoing TTS early
    this.bus.on(VoiceEvents.USER_STARTED_SPEAKING, () => {
      if (this.activeTtsStream && this.isAgentSpeaking()) {
        // User started speaking while agent is talking → barge-in
        // The AudioGateway emits BARGE_IN_DETECTED; this is just a hint
        log.debug({ callSid: this.callSid }, 'Speech detected during TTS — barge-in imminent');
      }
    });
  }

  // ─── Pipeline: Final Transcript → Response ────────────────────────────────

  private async handleFinalTranscript(payload: FinalTranscriptPayload): Promise<void> {
    const { text, correlationId } = payload;

    if (!text.trim()) {
      log.debug({ callSid: this.callSid }, 'Empty transcript — ignoring');
      return;
    }

    // If we're currently processing, queue this as a pending transcript
    if (this.isProcessing) {
      log.debug({ callSid: this.callSid, text: text.slice(0, 50) }, 'Response in progress — queuing transcript');
      this.pendingTranscript = payload;
      return;
    }

    this.isProcessing = true;
    this.currentResponseText = '';

    const state = sessionStore.get(this.callSid);
    if (!state) {
      log.warn({ callSid: this.callSid }, 'Session not found for transcript processing');
      this.isProcessing = false;
      return;
    }

    // Record user message in session
    sessionStore.appendMessage(this.callSid, {
      role: 'user',
      content: text,
      correlationId,
    });

    this.metrics.markSttFinal(correlationId);

    // Update conversation state partial
    this.bus.emit(VoiceEvents.LLM_RESPONSE_STARTED, {
      callSid: this.callSid,
      correlationId,
      timestamp: Date.now(),
    });

    try {
      await this.runPipeline(state, text, correlationId);
    } catch (err) {
      log.error({ err, callSid: this.callSid, correlationId }, 'Pipeline error');
      // Play a graceful fallback
      await this.speakFallback(state, correlationId);
    } finally {
      this.isProcessing = false;

      // Process pending transcript (from barge-in during processing)
      if (this.pendingTranscript) {
        const pending = this.pendingTranscript;
        this.pendingTranscript = null;
        setTimeout(() => void this.handleFinalTranscript(pending), 50);
      }
    }

    // Async DB write — never blocks response path
    void this.persistConversationTurn(state, text, this.currentResponseText, correlationId);
  }

  private async runPipeline(
    state: ConversationState,
    transcript: string,
    correlationId: string
  ): Promise<void> {
    // Step 1: Planner — intent + tool decisions (~200ms)
    this.metrics.markLlmStart(correlationId);

    const decision = await runPlannerAgent(getLlm(), state, transcript, correlationId);

    this.bus.emit(VoiceEvents.INTENT_DETECTED, {
      callSid: this.callSid,
      correlationId,
      intent: decision.intent,
      toolRequired: decision.tool_required,
      toolName: decision.tool_name,
      parameters: decision.parameters ?? undefined,
      rawPlannerOutput: decision,
      timestamp: Date.now(),
    });

    // Update conversation stage based on intent
    this.advanceStage(state, decision.intent);

    // Step 2: Tool execution
    // update_lead_info never contributes to the spoken response — fire it in
    // the background so it never adds latency to the response path.
    // All other tools (search_properties, check_unit_availability, book_site_visit)
    // are awaited because their results shape what Raj says next.
    let toolResults: Awaited<ReturnType<typeof executeTools>> = [];

    if (decision.tool_required && decision.tool_name) {
      const requestId = newToolRequestId(decision.tool_name);

      this.bus.emit(VoiceEvents.TOOL_REQUESTED, {
        callSid: this.callSid,
        correlationId,
        toolName: decision.tool_name,
        parameters: decision.parameters ?? {},
        requestId,
        timestamp: Date.now(),
      });

      const toolContext = {
        callSid: this.callSid,
        correlationId,
        leadId: state.leadId,
        phoneNumber: state.phoneNumber,
        state,
      };

      if (decision.tool_name === 'update_lead_info') {
        // Fire-and-forget — updates session state synchronously inside the worker,
        // so the response agent always sees fresh leadData even without awaiting.
        void executeTools(
          [buildToolExecution(decision.tool_name, decision.parameters ?? {}, requestId)],
          toolContext
        ).then(results => {
          for (const r of results) {
            this.bus.emit(VoiceEvents.TOOL_COMPLETED, {
              callSid: this.callSid,
              correlationId,
              toolName: r.toolName,
              requestId: r.requestId,
              result: r.result,
              durationMs: r.durationMs,
              timestamp: Date.now(),
            });
          }
        }).catch(err => log.warn({ err, correlationId }, 'Background lead update failed'));
      } else {
        const toolStart = Date.now();
        toolResults = await executeTools(
          [buildToolExecution(decision.tool_name, decision.parameters ?? {}, requestId)],
          toolContext
        );

        const toolDuration = Date.now() - toolStart;
        this.metrics.markToolLatency(correlationId, decision.tool_name, toolDuration);

        for (const r of toolResults) {
          this.bus.emit(VoiceEvents.TOOL_COMPLETED, {
            callSid: this.callSid,
            correlationId,
            toolName: r.toolName,
            requestId: r.requestId,
            result: r.result,
            durationMs: r.durationMs,
            timestamp: Date.now(),
          });
        }
      }
    }

    // Step 3: Response Agent streaming + Speech Chunking + TTS (parallel)
    await this.streamResponse(state, transcript, decision, toolResults, correlationId);
  }

  private async streamResponse(
    state: ConversationState,
    transcript: string,
    decision: Awaited<ReturnType<typeof runPlannerAgent>>,
    toolResults: Awaited<ReturnType<typeof executeTools>>,
    correlationId: string
  ): Promise<void> {
    // Open TTS stream BEFORE we start streaming LLM tokens
    // This eliminates TTS connection setup time from the critical path
    const ttsStream = getTtsProvider().openStream({ language: state.language });
    this.activeTtsStream = ttsStream;

    this.bus.emit(VoiceEvents.TTS_STARTED, {
      callSid: this.callSid,
      correlationId,
      text: '',
      timestamp: Date.now(),
    });

    const chunker = new SpeechChunker();
    let chunkIndex = 0;
    let fullText = '';
    let firstAudioEmitted = false;

    // Forward TTS audio chunks to AudioGateway via events
    ttsStream.on('chunk', (chunk) => {
      if (!firstAudioEmitted) {
        firstAudioEmitted = true;
        this.metrics.markTtsFirstAudio(correlationId);
      }

      const payload: TtsChunkPayload = {
        callSid: this.callSid,
        streamSid: state.streamSid,
        correlationId,
        audioBuffer: chunk.audio,
        chunkIndex: chunk.chunkIndex,
        isFinal: chunk.isFinal,
        timestamp: Date.now(),
      };

      this.bus.emit(VoiceEvents.TTS_CHUNK_READY, payload);
    });

    ttsStream.on('done', () => {
      sessionStore.update(this.callSid, { isAgentSpeaking: false });
      this.activeTtsStream = null;
      this.metrics.markTtsFinished(correlationId);

      this.bus.emit(VoiceEvents.TTS_FINISHED, {
        callSid: this.callSid,
        correlationId,
        timestamp: Date.now(),
      });
    });

    ttsStream.on('error', (err) => {
      log.error({ err, correlationId }, 'TTS stream error');
      sessionStore.update(this.callSid, { isAgentSpeaking: false });
      this.activeTtsStream = null;
    });

    sessionStore.update(this.callSid, { isAgentSpeaking: true });
    this.metrics.markLlmFirstToken(correlationId);

    // Stream LLM → Chunker → TTS in real-time.
    // NOTE: We do NOT break on barge-in here. The TTS stream's isAborted flag
    // already ensures no audio plays if barge-in happened. Breaking the LLM loop
    // early caused silence: any noise during the ~1700ms Bedrock wait fired a
    // false barge-in → isAgentSpeaking=false → loop broke → no audio played.
    for await (const token of runResponseAgent(
      getLlm(), state, transcript, decision, toolResults, correlationId
    )) {
      fullText += token;
      this.currentResponseText = fullText;

      this.bus.emit(VoiceEvents.LLM_RESPONSE_STREAMING, {
        callSid: this.callSid,
        correlationId,
        textChunk: token,
        accumulatedText: fullText,
        timestamp: Date.now(),
      });

      // Feed token to speech chunker
      const readyChunks = chunker.push(token);
      for (const chunk of readyChunks) {
        ttsStream.sendText(chunk);
        chunkIndex++;
      }
    }

    this.metrics.markLlmFinished(correlationId);

    // Flush remaining text to TTS
    const finalChunks = chunker.flush();
    for (const chunk of finalChunks) {
      ttsStream.sendText(chunk);
    }

    ttsStream.finish();

    // Record assistant response in session
    if (fullText.trim()) {
      sessionStore.appendMessage(this.callSid, {
        role: 'assistant',
        content: fullText,
        correlationId,
      });
      state.currentResponseText = fullText;
    }

    this.bus.emit(VoiceEvents.LLM_RESPONSE_FINISHED, {
      callSid: this.callSid,
      correlationId,
      fullText,
      durationMs: Date.now(),
      timestamp: Date.now(),
    });
  }

  // ─── Barge-in handling ────────────────────────────────────────────────────

  private async handleBargeIn(payload: BargeInPayload): Promise<void> {
    log.info({ callSid: this.callSid, correlationId: payload.correlationId }, 'Barge-in detected — stopping TTS');

    // 1. Stop ongoing TTS immediately
    if (this.activeTtsStream) {
      this.activeTtsStream.abort();
      this.activeTtsStream = null;
    }

    // 2. Update session state
    sessionStore.update(this.callSid, {
      isAgentSpeaking: false,
      isSpeakingInterrupted: true,
    });

    // 3. Emit buffer clear (AudioGateway will send "clear" to Twilio)
    const state = sessionStore.get(this.callSid);
    this.bus.emit(VoiceEvents.AUDIO_BUFFER_CLEARED, {
      callSid: this.callSid,
      streamSid: state?.streamSid ?? '',
      timestamp: Date.now(),
    });
  }

  // ─── Greeting (called on call start) ──────────────────────────────────────

  async playGreeting(state: ConversationState): Promise<void> {
    const correlationId = newCorrelationId(this.callSid);
    const greetings: Record<string, string> = {
      en: 'Hello! This is Raj Mehta from Akshay Vista. You\'re calling about our premium 2 and 3 BHK apartments in Pimple Gurav, Pune. May I know your name please?',
      hi: 'नमस्ते! मैं राज मेहता हूं, अक्षय विस्टा से। क्या मैं आपका नाम जान सकता हूं?',
      mr: 'नमस्कार! मी राज मेहता, अक्षय विस्टा मधून. तुमचं नाव सांगाल का?',
    };

    const greetingText = greetings[state.language] ?? greetings['en']!;
    const ttsStream = getTtsProvider().openStream({ language: state.language });
    this.activeTtsStream = ttsStream;

    ttsStream.on('chunk', (chunk) => {
      this.bus.emit(VoiceEvents.TTS_CHUNK_READY, {
        callSid: this.callSid,
        streamSid: state.streamSid,
        correlationId,
        audioBuffer: chunk.audio,
        chunkIndex: chunk.chunkIndex,
        isFinal: chunk.isFinal,
        timestamp: Date.now(),
      });
    });

    ttsStream.on('done', () => {
      sessionStore.update(this.callSid, { isAgentSpeaking: false });
      this.activeTtsStream = null;
    });

    sessionStore.update(this.callSid, { isAgentSpeaking: true });
    ttsStream.sendText(greetingText);
    ttsStream.finish();

    sessionStore.appendMessage(this.callSid, {
      role: 'assistant',
      content: greetingText,
      correlationId,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private isAgentSpeaking(): boolean {
    const state = sessionStore.get(this.callSid);
    return state?.isAgentSpeaking ?? false;
  }

  private advanceStage(state: ConversationState, intent: string): void {
    const transitions: Partial<Record<string, ConversationState['stage']>> = {
      name_inquiry: 'name_collection',
      price_inquiry: 'property_pitch',
      availability_inquiry: 'property_pitch',
      budget_discussion: 'needs_assessment',
      bhk_discussion: 'needs_assessment',
      site_visit_agreement: 'booking_confirmed',
      objection_price: 'objection_handling',
      objection_timing: 'objection_handling',
    };

    const nextStage = transitions[intent];
    if (nextStage && nextStage !== state.stage) {
      sessionStore.update(this.callSid, { stage: nextStage });
      log.debug({ callSid: this.callSid, from: state.stage, to: nextStage }, 'Stage transition');
    }
  }

  private async speakFallback(state: ConversationState, correlationId: string): Promise<void> {
    const fallbacks: Record<string, string> = {
      en: 'I apologize for the brief interruption. Could you please repeat what you said?',
      hi: 'माफ करें, क्या आप दोबारा बता सकते हैं?',
      mr: 'क्षमा करा, आपण पुन्हा सांगाल का?',
    };

    const text = fallbacks[state.language] ?? fallbacks['en']!;
    const ttsStream = getTtsProvider().openStream({ language: state.language });
    this.activeTtsStream = ttsStream;

    ttsStream.on('chunk', (chunk) => {
      this.bus.emit(VoiceEvents.TTS_CHUNK_READY, {
        callSid: this.callSid,
        streamSid: state.streamSid,
        correlationId,
        audioBuffer: chunk.audio,
        chunkIndex: chunk.chunkIndex,
        isFinal: chunk.isFinal,
        timestamp: Date.now(),
      });
    });

    ttsStream.on('done', () => {
      sessionStore.update(this.callSid, { isAgentSpeaking: false });
      this.activeTtsStream = null;
    });

    sessionStore.update(this.callSid, { isAgentSpeaking: true });
    ttsStream.sendText(text);
    ttsStream.finish();
  }

  private async persistConversationTurn(
    state: ConversationState,
    userText: string,
    agentText: string,
    correlationId: string
  ): Promise<void> {
    if (!state.leadId) return;
    try {
      await prisma.conversation.createMany({
        data: [
          { leadId: state.leadId, role: 'USER' as const, content: userText, language: state.language },
          ...(agentText ? [{ leadId: state.leadId, role: 'ASSISTANT' as const, content: agentText, language: state.language }] : []),
        ],
      });
    } catch (err) {
      log.warn({ err, correlationId }, 'Failed to persist conversation turn — non-fatal');
    }
  }

  async onCallEnd(): Promise<void> {
    // Stop any active TTS
    if (this.activeTtsStream) {
      this.activeTtsStream.abort();
      this.activeTtsStream = null;
    }

    this.metrics.summarize();

    const state = sessionStore.get(this.callSid);
    if (!state?.leadId || state.messages.length === 0) return;

    // Save call log asynchronously
    void this.saveCallLog(state);
  }

  private async saveCallLog(state: ConversationState): Promise<void> {
    try {
      const durationMs = Date.now() - state.createdAt;
      await prisma.callLog.create({
        data: {
          leadId: state.leadId,
          callSid: this.callSid,
          duration: Math.round(durationMs / 1000),
          language: state.language,
          direction: 'inbound',
          from: state.phoneNumber,
          to: process.env.TWILIO_PHONE_NUMBER ?? '',
          summary: `Voice call. Stage reached: ${state.stage}. Site visit booked: ${state.leadData.siteVisitBooked ?? false}.`,
        },
      });
    } catch (err) {
      log.warn({ err }, 'Failed to save call log');
    }
  }
}
