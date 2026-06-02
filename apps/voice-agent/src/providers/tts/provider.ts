/**
 * providers/tts/provider.ts — TTS Provider interface.
 *
 * All TTS implementations must satisfy this interface.
 * Key requirement: streaming output — audio must arrive in chunks
 * before the full text is available, enabling parallel LLM+TTS.
 */

export interface TtsChunk {
  /** μ-law encoded audio at 8kHz, ready to send directly to Twilio */
  audio: Buffer;
  isFinal: boolean;
  chunkIndex: number;
}

export interface TtsStreamEvents {
  chunk: (chunk: TtsChunk) => void;
  error: (err: Error) => void;
  done: () => void;
}

export interface TtsStream {
  /**
   * Send a text chunk to be synthesized.
   * Chunks are queued and synthesized as audio becomes available.
   * Call this as LLM tokens stream in — don't wait for full text.
   */
  sendText(text: string): void;

  /**
   * Signal end of text input. Provider will flush remaining audio.
   */
  finish(): void;

  /**
   * Abort synthesis immediately — discard buffered audio.
   * Called on barge-in.
   */
  abort(): void;

  on<K extends keyof TtsStreamEvents>(event: K, listener: TtsStreamEvents[K]): this;
  off<K extends keyof TtsStreamEvents>(event: K, listener: TtsStreamEvents[K]): this;
}

export interface TtsProvider {
  /**
   * Open a streaming TTS session.
   * Audio chunks will be emitted as they are generated.
   */
  openStream(options?: TtsStreamOptions): TtsStream;

  readonly name: string;
}

export interface TtsStreamOptions {
  /** Voice ID. If omitted, uses provider default. */
  voiceId?: string;
  /** Language/locale hint */
  language?: string;
  /** Speaking rate (1.0 = normal) */
  speed?: number;
  /** Voice stability (ElevenLabs: 0–1) */
  stability?: number;
  /** Voice similarity (ElevenLabs: 0–1) */
  similarityBoost?: number;
}
