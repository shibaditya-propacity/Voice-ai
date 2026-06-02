/**
 * audio-gateway.ts — Telephony media-stream WebSocket gateway.
 *
 * THE ENTRY POINT for all audio in the system.
 *
 * RESPONSIBILITY:
 *   1. Accept media-stream WebSocket connections (one per call) via the
 *      active TelephonyProvider (currently Twilio Media Streams)
 *   2. Receive μ-law audio frames and route them:
 *      → Krisp noise cancellation
 *      → VAD (speech detection + barge-in)
 *      → STT session (Deepgram streaming)
 *   3. Receive TTS audio from the Orchestrator (via events) and send to caller
 *   4. Handle buffer-clear commands for barge-in
 *   5. Emit call lifecycle events (CALL_STARTED, CALL_ENDED)
 *   6. Emit VAD events (USER_STARTED_SPEAKING, USER_STOPPED_SPEAKING, BARGE_IN)
 *
 * This file is TELEPHONY-AGNOSTIC — it never imports from the Twilio SDK.
 * All provider-specific protocol is handled inside TelephonyProvider.
 * To swap telephony providers, change TELEPHONY_PROVIDER in .env.
 *
 * AUDIO FORMAT (both directions):
 *   Provider → Gateway: μ-law, 8kHz, mono (decoded Buffer by the provider)
 *   Gateway  → Provider: same format, passed back via session.sendAudio()
 *   ElevenLabs → Gateway: μ-law, 8kHz, mono (ulaw_8000 output format)
 *   ∴ No audio conversion anywhere — zero codec overhead.
 */

import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import { createChildLogger } from '@property-ai/logger';
import { prisma } from '@property-ai/database';
import { eventBusRegistry } from '../events/event-bus.js';
import { VoiceEvents } from '../events/events.js';
import type { VoiceEventBus } from '../events/event-bus.js';
import { sessionStore } from '../session/session-store.js';
import { VoiceActivityDetector } from '../audio/vad.js';
import { createAudioProcessor } from '../audio/krisp-processor.js';
import { DeepgramSttProvider } from '../providers/stt/deepgram.js';
import { ConversationOrchestrator } from '../orchestrator/conversation-orchestrator.js';
import { newCallCorrelationId, newCorrelationId } from '../observability/correlation.js';
import type { SttSession } from '../providers/stt/provider.js';
import { getTelephonyProvider } from '../providers/telephony/index.js';
import type { TelephonyStreamSession } from '../providers/telephony/index.js';

const log = createChildLogger({ module: 'audio-gateway' });

// ─── Per-call state ────────────────────────────────────────────────────────

interface ActiveCall {
  callId: string;
  sessionId: string;
  session: TelephonyStreamSession;
  bus: VoiceEventBus;
  vad: VoiceActivityDetector;
  sttSession: SttSession | null;
  orchestrator: ConversationOrchestrator;
  speechStartedAt: number;
  currentCorrelationId: string;
  sequenceNumber: number;
}

// callId → ActiveCall (primary key for lifecycle operations)
const activeCalls = new Map<string, ActiveCall>();
// sessionId → callId (fast O(1) lookup for high-frequency audio_frame events)
const sessionIndex = new Map<string, string>();

// ─── STT provider (shared instance, stateless) ────────────────────────────

let sttProvider: DeepgramSttProvider | null = null;

function getSTTProvider(): DeepgramSttProvider {
  if (!sttProvider) {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY is required for streaming STT');
    sttProvider = new DeepgramSttProvider(apiKey);
  }
  return sttProvider;
}

// ─── Call initialization ───────────────────────────────────────────────────

async function initializeCall(
  callId: string,
  sessionId: string,
  from: string,
  session: TelephonyStreamSession
): Promise<ActiveCall> {
  const correlationId = newCallCorrelationId(callId);

  // 1. Create event bus for this call
  const bus = eventBusRegistry.create(callId);

  // 2. Create/find lead in DB
  let lead = await prisma.lead.findUnique({ where: { phone: from } }).catch(() => null);
  if (!lead) {
    lead = await prisma.lead.create({ data: { phone: from } }).catch(() => null);
  }

  // 3. Initialize session state
  // callId/sessionId map to callSid/streamSid in ConversationState (same values, legacy field names)
  const state = sessionStore.create(callId, sessionId, from, correlationId);
  if (lead) state.leadId = lead.id;

  // 4. Create VAD
  const vad = new VoiceActivityDetector({
    speechThreshold: 0.012,
    speechOnsetFrames: 3,
    speechOffsetFrames: 10,  // 200ms (was 400ms) — faster barge-in response
  });

  // 5. Create conversation orchestrator
  const orchestrator = new ConversationOrchestrator(bus, callId);

  const call: ActiveCall = {
    callId,
    sessionId,
    session,
    bus,
    vad,
    sttSession: null,
    orchestrator,
    speechStartedAt: 0,
    currentCorrelationId: correlationId,
    sequenceNumber: 0,
  };

  // 6. Wire TTS audio output: Orchestrator emits TTS_CHUNK_READY → send to caller
  bus.on(VoiceEvents.TTS_CHUNK_READY, (payload) => {
    call.session.sendAudio(payload.audioBuffer);
  });

  // 7. Wire buffer clear: AUDIO_BUFFER_CLEARED → flush telephony playout buffer
  bus.on(VoiceEvents.AUDIO_BUFFER_CLEARED, () => {
    call.session.clearAudioBuffer();
  });

  // 8. Open STT session
  try {
    const sttSession = await getSTTProvider().openSession({
      language: 'en-IN',
      encoding: 'mulaw',
      sampleRate: 8000,
      interimResults: true,
      endpointingMs: 80,   // 80ms silence → final transcript (was 200ms)
    });

    call.sttSession = sttSession;

    sttSession.on('transcript', (result) => {
      const currentCorrelationId = activeCalls.get(callId)?.currentCorrelationId ?? correlationId;

      if (!result.isFinal) {
        bus.emit(VoiceEvents.PARTIAL_TRANSCRIPT, {
          callSid: callId,
          streamSid: sessionId,
          correlationId: currentCorrelationId,
          text: result.text,
          confidence: result.confidence,
          timestamp: Date.now(),
        });
        sessionStore.update(callId, { partialTranscript: result.text });
      } else if (result.text.trim()) {
        log.info({ callId, text: result.text, confidence: result.confidence }, 'Final transcript');

        const activeCall = activeCalls.get(callId);
        const speechStartedAt = activeCall?.speechStartedAt ?? Date.now();

        bus.emit(VoiceEvents.FINAL_TRANSCRIPT, {
          callSid: callId,
          streamSid: sessionId,
          correlationId: currentCorrelationId,
          text: result.text,
          confidence: result.confidence,
          languageDetected: result.language,
          timestamp: Date.now(),
          utteranceDurationMs: Date.now() - speechStartedAt,
        });
      }
    });

    sttSession.on('error', (err) => log.error({ err, callId }, 'STT error'));
    sttSession.on('closed', () => log.debug({ callId }, 'STT session closed'));

  } catch (err) {
    log.error({ err, callId }, 'Failed to open STT session');
  }

  // 9. Wire VAD events
  vad.on('speech_start', ({ energyLevel }) => {
    const newCorrId = newCorrelationId(callId);
    call.currentCorrelationId = newCorrId;
    call.speechStartedAt = Date.now();

    bus.emit(VoiceEvents.USER_STARTED_SPEAKING, {
      callSid: callId,
      streamSid: sessionId,
      timestamp: Date.now(),
      energyLevel,
    });

    const callState = sessionStore.get(callId);
    if (callState?.isAgentSpeaking) {
      const interruptedText = callState.currentResponseText;
      bus.emit(VoiceEvents.BARGE_IN_DETECTED, {
        callSid: callId,
        streamSid: sessionId,
        correlationId: newCorrId,
        interruptedText,
        timestamp: Date.now(),
      });
      // Flush telephony audio buffer immediately — don't wait for the orchestrator
      call.session.clearAudioBuffer();
    }
  });

  vad.on('speech_end', ({ energyLevel }) => {
    bus.emit(VoiceEvents.USER_STOPPED_SPEAKING, {
      callSid: callId,
      streamSid: sessionId,
      timestamp: Date.now(),
      energyLevel,
    });
  });

  activeCalls.set(callId, call);
  sessionIndex.set(sessionId, callId);

  // 10. Emit CALL_STARTED
  bus.emit(VoiceEvents.CALL_STARTED, {
    callSid: callId,
    streamSid: sessionId,
    from,
    correlationId,
    timestamp: Date.now(),
  });

  // 11. Play greeting
  void orchestrator.playGreeting(sessionStore.get(callId)!);

  log.info({ callId, sessionId, from, leadId: lead?.id }, 'Call initialized');

  return call;
}

// ─── Call teardown ─────────────────────────────────────────────────────────

async function teardownCall(callId: string): Promise<void> {
  const call = activeCalls.get(callId);
  if (!call) return;

  log.info({ callId }, 'Tearing down call');

  try {
    if (call.sttSession) {
      await call.sttSession.close().catch(() => {});
    }

    await call.orchestrator.onCallEnd().catch(() => {});

    const state = sessionStore.get(callId);
    call.bus.emit(VoiceEvents.CALL_ENDED, {
      callSid: callId,
      streamSid: call.sessionId,
      correlationId: call.currentCorrelationId,
      durationMs: Date.now() - (state?.createdAt ?? Date.now()),
      timestamp: Date.now(),
    });

    eventBusRegistry.destroy(callId);
    sessionStore.delete(callId);
    call.vad.reset();
    sessionIndex.delete(call.sessionId);
    activeCalls.delete(callId);
  } catch (err) {
    log.error({ err, callId }, 'Error during call teardown');
  }
}

// ─── Audio frame processing ────────────────────────────────────────────────

const audioProcessor = createAudioProcessor();

async function processAudioFrame(call: ActiveCall, rawFrame: Buffer): Promise<void> {
  // Krisp noise cancellation (passthrough if Krisp is not configured)
  const cleanFrame = await audioProcessor.processFrame(rawFrame);

  // VAD — runs continuously, even while the agent is speaking (barge-in detection)
  call.vad.processFrame(cleanFrame);

  // STT — send clean audio to Deepgram
  if (call.sttSession) {
    call.sttSession.sendAudio(cleanFrame);
  }
}

// ─── WebSocket server factory ──────────────────────────────────────────────

/**
 * Create and return the media-stream WebSocket server.
 * Mount this on the HTTP server at the '/media-stream' upgrade path.
 *
 * The server is provider-agnostic: each new connection is handed to the
 * active TelephonyProvider which handles the provider-specific protocol
 * and emits normalized events consumed here.
 */
export function createAudioGateway(): WebSocketServer {
  const provider = getTelephonyProvider();
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    log.info({ url: req.url, provider: provider.name }, 'New media-stream connection');

    // Hand the raw WebSocket to the provider; it returns a normalized session.
    const session = provider.handleWebSocketConnection(ws);

    session.on('call_started', async (event) => {
      await initializeCall(event.callId, event.sessionId, event.from, session);
    });

    session.on('audio_frame', async (event) => {
      // O(1) lookup via sessionIndex — audio_frame is the hot path
      const callId = sessionIndex.get(event.sessionId);
      const call = callId ? activeCalls.get(callId) : undefined;
      if (!call) return; // frames can arrive before call_started on first connect
      await processAudioFrame(call, event.payload);
    });

    session.on('call_ended', async (event) => {
      await teardownCall(event.callId);
    });

    session.on('error', (err) => {
      log.error({ err, callId: session.callId }, 'Telephony session error');
    });
  });

  log.info({ provider: provider.name }, 'Audio gateway WebSocket server created');

  return wss;
}

export function getActiveCallCount(): number {
  return activeCalls.size;
}
