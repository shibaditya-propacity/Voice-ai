/**
 * providers/tts/elevenlabs-streaming.ts — ElevenLabs WebSocket streaming TTS.
 *
 * Uses ElevenLabs' WebSocket input-streaming endpoint for ultra-low latency:
 *   wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input
 *
 * Why WebSocket over REST?
 *   REST: send full text → wait → receive full audio (~800ms+ latency)
 *   WebSocket: stream text tokens → receive audio chunks in parallel (~200ms TTFA)
 *
 * Output format: ulaw_8000 (μ-law, 8kHz, mono)
 *   This is EXACTLY what Twilio Media Streams expects — zero audio conversion needed.
 *
 * Text-to-audio pipeline:
 *   LLM token → SpeechChunker → ElevenLabs WS → audio chunk → Twilio WS
 *
 * ElevenLabs Flash v2.5 model is used:
 *   - Lowest latency of all ElevenLabs models
 *   - Good quality for real-time voice applications
 *   - Supports streaming input
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { createChildLogger } from '@property-ai/logger';
import type { TtsProvider, TtsStream, TtsChunk, TtsStreamEvents, TtsStreamOptions } from './provider.js';

const log = createChildLogger({ module: 'elevenlabs-tts' });

const ELEVENLABS_WS_BASE = 'wss://api.elevenlabs.io/v1/text-to-speech';

class ElevenLabsStream extends EventEmitter implements TtsStream {
  private ws: WebSocket;
  private chunkIndex = 0;
  private isAborted = false;
  private isFinished = false;
  private isWsOpen = false;
  /** finish() was called before WS opened — flush + close once open */
  private pendingFinish = false;
  private textBuffer = '';
  private readonly MIN_TEXT_BEFORE_FLUSH = 8; // chars (was 20) — send to ElevenLabs sooner

  constructor(ws: WebSocket) {
    super();
    this.ws = ws;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.ws.on('message', (data: Buffer | string) => {
      if (this.isAborted) return;

      try {
        const msg = JSON.parse(data.toString()) as {
          audio?: string;
          isFinal?: boolean;
          error?: string;
          message?: string;
        };

        if (msg.error || msg.message) {
          this.emit('error', new Error(`ElevenLabs error: ${msg.error ?? msg.message}`));
          return;
        }

        if (msg.audio) {
          const audioBuffer = Buffer.from(msg.audio, 'base64');
          const chunk: TtsChunk = {
            audio: audioBuffer,
            isFinal: msg.isFinal ?? false,
            chunkIndex: this.chunkIndex++,
          };
          this.emit('chunk', chunk);
        }

        if (msg.isFinal) {
          this.emit('done');
        }
      } catch (err) {
        log.warn({ err }, 'Failed to parse ElevenLabs message');
      }
    });

    this.ws.on('error', (err) => {
      log.error({ err }, 'ElevenLabs WebSocket error');
      this.emit('error', err);
    });

    this.ws.on('close', () => {
      if (!this.isAborted) {
        this.emit('done');
      }
    });

    this.ws.on('open', () => {
      log.debug('ElevenLabs WebSocket opened');
      this.isWsOpen = true;

      // Send initial voice settings
      this.ws.send(JSON.stringify({
        text: ' ',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.85,
          style: 0,
          use_speaker_boost: true,
        },
        generation_config: {
          // Start very small for fast first audio, grow for efficiency
          chunk_length_schedule: [20, 50, 80, 120],
        },
      }));

      // Flush any text that arrived before the WS opened
      if (this.textBuffer.length > 0) {
        this.flushBuffer(this.pendingFinish);
      }

      // If finish() was called before WS opened, send EOS now
      if (this.pendingFinish) {
        this.ws.send(JSON.stringify({ text: '' }));
      }
    });
  }

  sendText(text: string): void {
    if (this.isAborted || this.isFinished) return;

    this.textBuffer += text;

    // If WS not yet open, buffer the text — open handler will flush
    if (!this.isWsOpen) return;

    // Send when we have enough text to trigger generation
    if (this.textBuffer.length >= this.MIN_TEXT_BEFORE_FLUSH) {
      this.flushBuffer(false);
    }
  }

  finish(): void {
    if (this.isAborted || this.isFinished) return;
    this.isFinished = true;

    if (this.isWsOpen) {
      // WS is already open — flush and send EOS immediately
      if (this.textBuffer.length > 0) {
        this.flushBuffer(true);
      }
      this.ws.send(JSON.stringify({ text: '' }));
    } else {
      // WS not yet open — mark pending; open handler will flush + send EOS
      this.pendingFinish = true;
    }
  }

  abort(): void {
    if (this.isAborted) return;
    this.isAborted = true;
    this.textBuffer = '';
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'barge-in');
      }
    } catch {
      // Ignore close errors during abort
    }
    log.debug('ElevenLabs stream aborted (barge-in)');
  }

  private flushBuffer(isFinal: boolean): void {
    if (this.textBuffer.length === 0) return;
    const text = this.textBuffer;
    this.textBuffer = '';

    try {
      this.ws.send(JSON.stringify({
        text,
        try_trigger_generation: isFinal || text.length >= this.MIN_TEXT_BEFORE_FLUSH,
        flush: isFinal,
      }));
    } catch (err) {
      log.warn({ err }, 'Failed to send text to ElevenLabs');
    }
  }

  on<K extends keyof TtsStreamEvents>(event: K, listener: TtsStreamEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof TtsStreamEvents>(event: K, listener: TtsStreamEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

export class ElevenLabsStreamingProvider implements TtsProvider {
  readonly name = 'elevenlabs-streaming';
  private readonly apiKey: string;
  private readonly defaultVoiceId: string;

  constructor(apiKey?: string, voiceId?: string) {
    const key = apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error('ELEVENLABS_API_KEY is required');
    const vid = voiceId ?? process.env.ELEVENLABS_VOICE_ID;
    if (!vid) throw new Error('ELEVENLABS_VOICE_ID is required');

    this.apiKey = key;
    this.defaultVoiceId = vid;
  }

  openStream(options: TtsStreamOptions = {}): TtsStream {
    const voiceId = options.voiceId ?? this.defaultVoiceId;

    const params = new URLSearchParams({
      model_id: 'eleven_flash_v2_5',
      output_format: 'ulaw_8000',          // Direct Twilio-compatible format
      optimize_streaming_latency: '4',     // Maximum latency optimization
      inactivity_timeout: '180',
    });

    const url = `${ELEVENLABS_WS_BASE}/${voiceId}/stream-input?${params}`;

    const ws = new WebSocket(url, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    const stream = new ElevenLabsStream(ws);

    log.debug({ voiceId }, 'ElevenLabs streaming session opened');

    return stream;
  }
}
