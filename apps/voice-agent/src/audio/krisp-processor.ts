/**
 * krisp-processor.ts — Noise cancellation and voice isolation layer.
 *
 * Sits immediately after the Twilio audio stream. Cleans audio before
 * it reaches VAD or STT — noise-cancelled audio produces dramatically
 * better transcription accuracy and VAD reliability.
 *
 * PRODUCTION UPGRADE (optional):
 *   Krisp has no server-side Node.js SDK. For server-side noise reduction use:
 *   - RNNoise via `@dqbd/rnnoise` (open-source, zero latency, no API key)
 *   - Dolby.io Media Enhance API (REST, ~50-100ms added latency)
 *
 *   To integrate either, implement the AudioProcessor interface below
 *   and swap it in createAudioProcessor() — zero other changes needed.
 *
 * CURRENT STATE: PassthroughProcessor (no-op).
 * Deepgram Nova-3 handles real-world phone noise robustly without preprocessing.
 *
 * AUDIO FORMAT: μ-law (mulaw), 8kHz, mono, 20ms frames (160 bytes/frame)
 */

export interface AudioProcessor {
  /**
   * Process a single 20ms frame of μ-law audio.
   * Returns cleaned audio in the same format.
   */
  processFrame(frame: Buffer): Promise<Buffer>;

  /**
   * Reset internal state (e.g. on call end).
   */
  reset(): void;

  readonly isActive: boolean;
}

/**
 * PassthroughProcessor — zero-latency identity transform.
 * Used when Krisp SDK is not configured. Adds no overhead.
 */
export class PassthroughProcessor implements AudioProcessor {
  readonly isActive = false;

  async processFrame(frame: Buffer): Promise<Buffer> {
    return frame;
  }

  reset(): void {
    // no-op
  }
}

/**
 * Factory: returns the best available processor.
 * When KRISP_API_KEY is set and the SDK is installed, returns KrispProcessor.
 * Otherwise returns the zero-overhead passthrough.
 */
export function createAudioProcessor(): AudioProcessor {
  // PassthroughProcessor is the correct choice for server-side Twilio audio.
  // Deepgram Nova-3 handles phone-quality noise without preprocessing.
  // To add RNNoise: implement AudioProcessor using @dqbd/rnnoise and return it here.
  return new PassthroughProcessor();
}
