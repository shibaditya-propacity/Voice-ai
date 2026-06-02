/**
 * providers/stt/deepgram.ts — Deepgram Live Transcription STT provider.
 *
 * Deepgram Nova-3 is the fastest available STT model as of 2025:
 *   - Streaming latency: ~200ms from speech end to final transcript
 *   - Accuracy on Indian English: excellent with nova-3
 *   - Supports mulaw 8kHz (Twilio format) natively — zero audio conversion
 *   - endpointing + utterance_end_ms handles speech segmentation
 *
 * The session connects once per call and streams audio continuously.
 * Deepgram handles all VAD/endpointing internally when configured.
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import type { ListenLiveClient } from '@deepgram/sdk';
import { EventEmitter } from 'events';
import { createChildLogger } from '@property-ai/logger';
import type { SttProvider, SttSession, SttSessionOptions, SttTranscript, SttProviderEvents } from './provider.js';

const log = createChildLogger({ module: 'deepgram-stt' });

class DeepgramSession extends EventEmitter implements SttSession {
  private readonly connection: ListenLiveClient;
  private isFinalized = false;
  private utteranceStartedAt = Date.now();

  constructor(connection: ListenLiveClient) {
    super();
    this.connection = connection;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.connection.on(LiveTranscriptionEvents.Open, () => {
      log.debug('Deepgram connection opened');
      this.emit('ready');
    });

    this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      const alt = data?.channel?.alternatives?.[0];
      if (!alt || !alt.transcript) return;

      const isFinal = data.is_final ?? false;
      const utteranceDurationMs = data.duration ? data.duration * 1000 : 0;

      const result: SttTranscript = {
        text: alt.transcript,
        isFinal,
        confidence: alt.confidence ?? 0,
        language: data.detected_language,
        durationMs: utteranceDurationMs,
      };

      this.emit('transcript', result);

      if (isFinal) {
        log.debug({
          text: result.text,
          confidence: result.confidence,
          durationMs: utteranceDurationMs,
        }, 'Deepgram final transcript');
      }
    });

    this.connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      // Deepgram signals utterance_end_ms silence was detected
      // This is our cue to finalize if not already done
      log.debug('Deepgram utterance end');
    });

    this.connection.on(LiveTranscriptionEvents.Error, (err) => {
      log.error({ err }, 'Deepgram error');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      log.debug('Deepgram connection closed');
      this.emit('closed');
    });
  }

  sendAudio(frame: Buffer): void {
    if (this.isFinalized) return;
    try {
      // Deepgram SDK expects ArrayBuffer — convert from Node.js Buffer
      const ab = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
      this.connection.send(ab as ArrayBuffer);
    } catch (err) {
      log.warn({ err }, 'Failed to send audio to Deepgram');
    }
  }

  async finalize(): Promise<void> {
    if (this.isFinalized) return;
    this.isFinalized = true;
    // Deepgram auto-finalizes via endpointing; this is a no-op hint
  }

  async close(): Promise<void> {
    this.isFinalized = true;
    try {
      this.connection.requestClose();
    } catch (err) {
      log.warn({ err }, 'Error closing Deepgram connection');
    }
  }

  on<K extends keyof SttProviderEvents>(event: K, listener: SttProviderEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof SttProviderEvents>(event: K, listener: SttProviderEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

export class DeepgramSttProvider implements SttProvider {
  readonly name = 'deepgram';
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.DEEPGRAM_API_KEY;
    if (!key) throw new Error('DEEPGRAM_API_KEY is required');
    this.apiKey = key;
  }

  async openSession(options: SttSessionOptions = {}): Promise<SttSession> {
    const client = createClient(this.apiKey);

    const connection = client.listen.live({
      model: 'nova-3',
      language: options.language ?? 'en-IN',
      encoding: options.encoding ?? 'mulaw',
      sample_rate: options.sampleRate ?? 8000,
      channels: options.channels ?? 1,

      // Transcription quality
      punctuate: true,
      smart_format: true,
      diarize: false,
      numerals: true,

      // Streaming latency settings
      interim_results: options.interimResults ?? true,
      endpointing: options.endpointingMs ?? 300,   // 300ms of silence = end of utterance
      utterance_end_ms: 1000,                        // Fallback: 1s of silence always finalizes
    });

    return new DeepgramSession(connection);
  }
}
