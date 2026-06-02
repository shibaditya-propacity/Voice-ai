/**
 * vad.ts — Voice Activity Detection for real-time barge-in and STT gating.
 *
 * Processes μ-law audio frames (160 bytes = 20ms at 8kHz) and detects:
 *   - Speech START: user begins speaking (trigger: stop TTS, start buffering)
 *   - Speech END: user stopped speaking (trigger: send to STT for final transcript)
 *   - Barge-in: speech detected WHILE agent is speaking
 *
 * Algorithm: Energy-based VAD on decoded PCM amplitude.
 *   μ-law decode → PCM → RMS energy → compare to adaptive threshold
 *
 * For production, consider replacing with:
 *   - Silero VAD via ONNX Runtime (very accurate, ~5ms latency)
 *   - WebRTC VAD via `node-vad` package (C++ binding, excellent quality)
 *
 * Current implementation is pure JS, zero native deps, ~0.1ms per frame.
 */

import { EventEmitter } from 'events';

// μ-law decoding table (ITU-T G.711)
const MULAW_DECODE_TABLE = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    let ulaw = ~i & 0xFF;
    const sign = ulaw & 0x80;
    const exp = (ulaw >> 4) & 0x07;
    const mantissa = ulaw & 0x0F;
    let sample = ((mantissa << 3) + 0x84) << exp;
    sample -= 0x84;
    table[i] = sign ? -sample : sample;
  }
  return table;
})();

/** Decode a buffer of μ-law bytes into 16-bit PCM samples */
function decodeMulaw(mulawBuffer: Buffer): Int16Array {
  const pcm = new Int16Array(mulawBuffer.length);
  for (let i = 0; i < mulawBuffer.length; i++) {
    pcm[i] = MULAW_DECODE_TABLE[mulawBuffer[i]!]!;
  }
  return pcm;
}

/** Root Mean Square energy of a PCM frame, normalized 0–1 */
function rmsEnergy(pcm: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    sum += (pcm[i]! / 32768) ** 2;
  }
  return Math.sqrt(sum / pcm.length);
}

// ─── Configuration ─────────────────────────────────────────────────────────

export interface VadConfig {
  /** Energy level above which a frame is considered speech (0–1). Default: 0.015 */
  speechThreshold: number;
  /** Number of consecutive speech frames before triggering SPEECH_START. Default: 3 (60ms) */
  speechOnsetFrames: number;
  /** Number of consecutive silence frames before triggering SPEECH_END. Default: 25 (500ms) */
  speechOffsetFrames: number;
  /** Number of silence frames in VAD window for background noise estimation. Default: 50 */
  noiseWindowFrames: number;
}

const DEFAULT_CONFIG: VadConfig = {
  speechThreshold: 0.015,
  speechOnsetFrames: 3,
  speechOffsetFrames: 25,
  noiseWindowFrames: 50,
};

// ─── VAD State Machine ─────────────────────────────────────────────────────

type VadState = 'silence' | 'onset' | 'speaking' | 'offset';

export interface VadEvents {
  speech_start: { energyLevel: number; timestamp: number };
  speech_end: { energyLevel: number; timestamp: number };
  frame_energy: { energy: number; isSpeech: boolean; timestamp: number };
}

export class VoiceActivityDetector extends EventEmitter {
  private state: VadState = 'silence';
  private readonly config: VadConfig;
  private consecutiveSpeechFrames = 0;
  private consecutiveSilenceFrames = 0;
  private recentEnergies: number[] = [];
  private adaptiveThreshold: number;

  constructor(config: Partial<VadConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.adaptiveThreshold = this.config.speechThreshold;
  }

  /**
   * Feed a 20ms μ-law frame into the VAD.
   * Emits 'speech_start' or 'speech_end' events as state changes.
   *
   * Call this for EVERY audio frame — VAD must run continuously,
   * even while the agent is speaking (to detect barge-in).
   */
  processFrame(mulawFrame: Buffer): { isSpeech: boolean; energy: number } {
    const pcm = decodeMulaw(mulawFrame);
    const energy = rmsEnergy(pcm);
    const now = Date.now();

    // Update adaptive threshold from recent silence frames
    this.updateNoiseFloor(energy);

    const effectiveThreshold = Math.max(
      this.config.speechThreshold,
      this.adaptiveThreshold * 2.5   // speech must be 2.5x above noise floor
    );

    const isSpeechFrame = energy > effectiveThreshold;

    this.emit('frame_energy', { energy, isSpeech: isSpeechFrame, timestamp: now });

    this.advanceStateMachine(isSpeechFrame, energy, now);

    return { isSpeech: isSpeechFrame, energy };
  }

  private advanceStateMachine(isSpeechFrame: boolean, energy: number, now: number): void {
    switch (this.state) {
      case 'silence':
        if (isSpeechFrame) {
          this.consecutiveSpeechFrames++;
          if (this.consecutiveSpeechFrames >= this.config.speechOnsetFrames) {
            this.state = 'speaking';
            this.consecutiveSilenceFrames = 0;
            this.emit('speech_start', { energyLevel: energy, timestamp: now });
          } else {
            this.state = 'onset';
          }
        }
        break;

      case 'onset':
        if (isSpeechFrame) {
          this.consecutiveSpeechFrames++;
          if (this.consecutiveSpeechFrames >= this.config.speechOnsetFrames) {
            this.state = 'speaking';
            this.consecutiveSilenceFrames = 0;
            this.emit('speech_start', { energyLevel: energy, timestamp: now });
          }
        } else {
          // Reset if silence during onset
          this.state = 'silence';
          this.consecutiveSpeechFrames = 0;
        }
        break;

      case 'speaking':
        if (!isSpeechFrame) {
          this.consecutiveSilenceFrames++;
          if (this.consecutiveSilenceFrames >= this.config.speechOffsetFrames) {
            this.state = 'silence';
            this.consecutiveSpeechFrames = 0;
            this.emit('speech_end', { energyLevel: energy, timestamp: now });
          }
        } else {
          this.consecutiveSilenceFrames = 0;
        }
        break;
    }
  }

  private updateNoiseFloor(energy: number): void {
    // Only update noise model during silence
    if (this.state === 'silence') {
      this.recentEnergies.push(energy);
      if (this.recentEnergies.length > this.config.noiseWindowFrames) {
        this.recentEnergies.shift();
      }
      // Noise floor = median of recent silence energies
      if (this.recentEnergies.length >= 10) {
        const sorted = [...this.recentEnergies].sort((a, b) => a - b);
        this.adaptiveThreshold = sorted[Math.floor(sorted.length / 2)]!;
      }
    }
  }

  get currentState(): VadState {
    return this.state;
  }

  get isSpeaking(): boolean {
    return this.state === 'speaking' || this.state === 'onset';
  }

  reset(): void {
    this.state = 'silence';
    this.consecutiveSpeechFrames = 0;
    this.consecutiveSilenceFrames = 0;
    this.recentEnergies = [];
    this.adaptiveThreshold = this.config.speechThreshold;
  }
}
