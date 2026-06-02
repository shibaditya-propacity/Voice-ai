/**
 * providers/telephony/provider.ts — Telephony Provider interface.
 *
 * All telephony implementations (Twilio, Exotel, etc.) must satisfy
 * this interface. Swap providers by setting TELEPHONY_PROVIDER in .env
 * and adding the corresponding case in index.ts — zero changes elsewhere.
 *
 * Current active provider: TwilioProvider (twilio-provider.ts)
 *
 * TODO: Exotel Migration
 * Future provider: ExotelProvider (exotel-provider.ts)
 * See index.ts for the migration extension point.
 */

import type { WebSocket } from 'ws';

// ─── Normalized inbound events (provider-agnostic) ─────────────────────────

export interface TelephonyCallStartedEvent {
  type: 'call_started';
  /** Provider-assigned call identifier (Twilio: CallSid). */
  callId: string;
  /** Provider-assigned stream/session identifier (Twilio: StreamSid). */
  sessionId: string;
  /** Caller's phone number. */
  from: string;
  /** Provider-specific custom parameters passed at stream setup. */
  customParameters?: Record<string, string>;
}

export interface TelephonyAudioFrameEvent {
  type: 'audio_frame';
  sessionId: string;
  /** Raw μ-law 8kHz mono audio frame, already decoded from transport encoding. */
  payload: Buffer;
}

export interface TelephonyCallEndedEvent {
  type: 'call_ended';
  callId: string;
  sessionId: string;
}

export interface TelephonyDtmfEvent {
  type: 'dtmf';
  sessionId: string;
  digit: string;
}

export type TelephonyEvent =
  | TelephonyCallStartedEvent
  | TelephonyAudioFrameEvent
  | TelephonyCallEndedEvent
  | TelephonyDtmfEvent;

// ─── Stream session event map ──────────────────────────────────────────────

export interface TelephonyStreamSessionEvents {
  call_started: (event: TelephonyCallStartedEvent) => void;
  audio_frame: (event: TelephonyAudioFrameEvent) => void;
  call_ended: (event: TelephonyCallEndedEvent) => void;
  dtmf: (event: TelephonyDtmfEvent) => void;
  error: (err: Error) => void;
}

// ─── Stream session (one instance per active call) ─────────────────────────

export interface TelephonyStreamSession {
  /** Provider-assigned call ID. Null until call_started fires. */
  readonly callId: string | null;
  /** Provider-assigned stream/session ID. Null until call_started fires. */
  readonly sessionId: string | null;

  /**
   * Send a μ-law 8kHz audio buffer to the caller.
   * No-op if the transport connection is not open.
   */
  sendAudio(buffer: Buffer): void;

  /**
   * Flush the provider's audio playout buffer immediately.
   * Called on barge-in to stop the agent mid-sentence.
   */
  clearAudioBuffer(): void;

  /**
   * Initiate a graceful disconnect of the media stream.
   */
  disconnect(): void;

  on<K extends keyof TelephonyStreamSessionEvents>(
    event: K,
    listener: TelephonyStreamSessionEvents[K]
  ): this;
  off<K extends keyof TelephonyStreamSessionEvents>(
    event: K,
    listener: TelephonyStreamSessionEvents[K]
  ): this;
}

// ─── REST operation types ──────────────────────────────────────────────────

export interface OutboundCallOptions {
  to: string;
  /** Caller ID. Falls back to the provider's configured default number. */
  from?: string;
  /** URL the provider calls when the call is answered (returns stream connect response). */
  webhookUrl: string;
  /** URL the provider calls with final call disposition (completed/failed). */
  statusCallbackUrl?: string;
}

export interface CallDetails {
  callId: string;
  status: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  durationSecs?: number;
}

export interface TransferCallOptions {
  type?: 'warm' | 'cold';
  /** Optional audio to play to the caller before the transfer connects. */
  announcement?: string;
}

// ─── Top-level provider interface ─────────────────────────────────────────

export interface TelephonyProvider {
  readonly name: string;

  /**
   * MIME type for the HTTP response returned by generateStreamConnectResponse.
   * Twilio: 'text/xml'  (TwiML)
   * Exotel: 'application/json'
   */
  readonly streamConnectContentType: string;

  /**
   * Generate the HTTP response body that instructs the telephony provider
   * to connect this call to our media-stream WebSocket for audio streaming.
   *
   * Twilio:  returns TwiML <Connect><Stream> XML.
   * Exotel:  returns JSON { url, customParameters }.
   */
  generateStreamConnectResponse(from: string): string;

  /**
   * Wrap a raw WebSocket connection in a normalized stream session.
   * The implementation handles all provider-specific protocol internally
   * and emits provider-agnostic TelephonyStreamSessionEvents.
   */
  handleWebSocketConnection(ws: WebSocket): TelephonyStreamSession;

  /**
   * Initiate an outbound call.
   * Returns the provider-assigned call ID.
   */
  makeOutboundCall(options: OutboundCallOptions): Promise<string>;

  /**
   * Fetch current status and metadata for an active or completed call.
   */
  getCallDetails(callId: string): Promise<CallDetails>;

  /**
   * Transfer an active call to another number.
   * Implementation varies per provider (warm vs cold transfer support).
   */
  transferCall(callId: string, to: string, options?: TransferCallOptions): Promise<void>;
}
