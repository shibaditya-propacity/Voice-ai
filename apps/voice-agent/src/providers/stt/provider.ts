/**
 * providers/stt/provider.ts — STT Provider interface.
 *
 * All STT implementations must satisfy this interface.
 * Swap between Deepgram, AssemblyAI, Google, AWS Transcribe by
 * instantiating a different provider — zero code changes elsewhere.
 */

export interface SttTranscript {
  text: string;
  isFinal: boolean;
  confidence: number;
  /** Detected language code (BCP-47) */
  language?: string;
  /** Duration of the spoken utterance in ms */
  durationMs?: number;
}

export interface SttProviderEvents {
  /** Fired on every interim/final transcript */
  transcript: (result: SttTranscript) => void;
  /** Fired when the STT connection is ready to receive audio */
  ready: () => void;
  /** Fired on connection error */
  error: (err: Error) => void;
  /** Fired when the STT connection closes */
  closed: () => void;
}

export interface SttSession {
  /**
   * Send a raw μ-law audio frame (160 bytes = 20ms at 8kHz).
   * Must be called continuously — do not buffer before sending.
   */
  sendAudio(frame: Buffer): void;

  /**
   * Signal end of utterance — provider will finalize transcript.
   * Some providers (Deepgram) auto-detect via endpointing; this is a hint.
   */
  finalize(): Promise<void>;

  /**
   * Cleanly close the STT connection.
   */
  close(): Promise<void>;

  on<K extends keyof SttProviderEvents>(event: K, listener: SttProviderEvents[K]): this;
  off<K extends keyof SttProviderEvents>(event: K, listener: SttProviderEvents[K]): this;
}

export interface SttProvider {
  /**
   * Open a new live transcription session for one call.
   * Returns a session handle for sending audio and receiving transcripts.
   */
  openSession(options?: SttSessionOptions): Promise<SttSession>;

  readonly name: string;
}

export interface SttSessionOptions {
  /** BCP-47 language code hint. Provider may auto-detect. */
  language?: string;
  /**
   * Input audio encoding. Defaults to mulaw (Twilio format).
   * mulaw = μ-law 8kHz (Twilio Media Streams format)
   */
  encoding?: 'mulaw' | 'linear16' | 'flac';
  sampleRate?: number;
  channels?: number;
  /** Ms of trailing silence before auto-finalizing an utterance */
  endpointingMs?: number;
  /** Whether to return interim results */
  interimResults?: boolean;
}
