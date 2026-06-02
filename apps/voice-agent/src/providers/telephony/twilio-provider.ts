/**
 * providers/telephony/twilio-provider.ts — Twilio implementation of TelephonyProvider.
 *
 * Encapsulates ALL Twilio SDK usage and Media Streams protocol details.
 * Nothing outside this file should import from the twilio SDK directly.
 *
 * Twilio Media Streams protocol (WebSocket, JSON framing):
 *   Inbound:  connected | start | media | stop | dtmf | mark
 *   Outbound: media | clear | mark
 *   Audio:    μ-law, 8kHz, mono, base64-encoded in JSON payload field
 */

import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { createChildLogger } from '@property-ai/logger';
import { getTwilioClient, makeOutboundCall as twilioMakeOutboundCall, getCallDetails as twilioGetCallDetails } from '@property-ai/twilio';
import type {
  TelephonyProvider,
  TelephonyStreamSession,
  TelephonyStreamSessionEvents,
  OutboundCallOptions,
  CallDetails,
  TransferCallOptions,
} from './provider.js';

const log = createChildLogger({ module: 'twilio-provider' });

// ─── Twilio Media Streams inbound message types ────────────────────────────
// These are Twilio-specific protocol details — never leak outside this file.

interface TwilioConnectedMsg {
  event: 'connected';
  protocol: string;
  version: string;
}
interface TwilioStartMsg {
  event: 'start';
  sequenceNumber: string;
  streamSid: string;
  start: {
    streamSid: string;
    callSid: string;
    accountSid: string;
    tracks: string[];
    mediaFormat: { encoding: string; sampleRate: number; channels: number };
    customParameters?: Record<string, string>;
  };
}
interface TwilioMediaMsg {
  event: 'media';
  sequenceNumber: string;
  streamSid: string;
  media: { track: string; chunk: string; timestamp: string; payload: string };
}
interface TwilioStopMsg {
  event: 'stop';
  sequenceNumber: string;
  streamSid: string;
  stop: { accountSid: string; callSid: string };
}
interface TwilioDtmfMsg {
  event: 'dtmf';
  sequenceNumber: string;
  streamSid: string;
  dtmf: { track: string; digit: string };
}
interface TwilioMarkMsg {
  event: 'mark';
  sequenceNumber: string;
  streamSid: string;
  mark: { name: string };
}

type TwilioInboundMessage =
  | TwilioConnectedMsg
  | TwilioStartMsg
  | TwilioMediaMsg
  | TwilioStopMsg
  | TwilioDtmfMsg
  | TwilioMarkMsg;

// ─── TwilioStreamSession ───────────────────────────────────────────────────

class TwilioStreamSession implements TelephonyStreamSession {
  private readonly emitter = new EventEmitter();
  private _callId: string | null = null;
  private _sessionId: string | null = null;

  constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => void this.handleMessage(data.toString()));
    ws.on('close', () => this.handleClose());
    ws.on('error', (err) => this.emitter.emit('error', err));
  }

  get callId(): string | null { return this._callId; }
  get sessionId(): string | null { return this._sessionId; }

  // ─── Inbound protocol handling ───────────────────────────────────────────

  private handleMessage(raw: string): void {
    let msg: TwilioInboundMessage;
    try {
      msg = JSON.parse(raw) as TwilioInboundMessage;
    } catch {
      log.warn('Received non-JSON message on Twilio WebSocket');
      return;
    }

    switch (msg.event) {
      case 'connected':
        log.debug({ protocol: msg.protocol, version: msg.version }, 'Twilio WS connected');
        break;

      case 'start': {
        const { callSid, streamSid, customParameters } = msg.start;
        this._callId = callSid;
        this._sessionId = streamSid;
        log.debug({ callSid, streamSid }, 'Twilio stream started');
        this.emitter.emit('call_started', {
          type: 'call_started',
          callId: callSid,
          sessionId: streamSid,
          from: customParameters?.from ?? 'unknown',
          customParameters,
        });
        break;
      }

      case 'media':
        this.emitter.emit('audio_frame', {
          type: 'audio_frame',
          sessionId: msg.streamSid,
          // Twilio sends μ-law base64 — decode and emit raw Buffer.
          payload: Buffer.from(msg.media.payload, 'base64'),
        });
        break;

      case 'stop':
        log.debug({ callSid: msg.stop.callSid }, 'Twilio stream stopped');
        this.emitter.emit('call_ended', {
          type: 'call_ended',
          callId: msg.stop.callSid,
          sessionId: this._sessionId ?? msg.streamSid,
        });
        break;

      case 'dtmf':
        this.emitter.emit('dtmf', {
          type: 'dtmf',
          sessionId: msg.streamSid,
          digit: msg.dtmf.digit,
        });
        break;

      case 'mark':
        log.debug({ markName: msg.mark.name }, 'Twilio mark event');
        break;
    }
  }

  private handleClose(): void {
    if (this._callId && this._sessionId) {
      log.debug({ callId: this._callId }, 'Twilio WS closed — synthesizing call_ended');
      this.emitter.emit('call_ended', {
        type: 'call_ended',
        callId: this._callId,
        sessionId: this._sessionId,
      });
    }
  }

  // ─── Outbound operations ─────────────────────────────────────────────────

  sendAudio(buffer: Buffer): void {
    // buffer is μ-law from ElevenLabs — Twilio accepts μ-law directly, no conversion needed.
    if (this.ws.readyState !== WebSocket.OPEN || !this._sessionId) return;
    try {
      this.ws.send(JSON.stringify({
        event: 'media',
        streamSid: this._sessionId,
        media: { payload: buffer.toString('base64') },
      }));
    } catch (err) {
      log.warn({ err }, 'Failed to send audio to Twilio');
    }
  }

  clearAudioBuffer(): void {
    if (this.ws.readyState !== WebSocket.OPEN || !this._sessionId) return;
    try {
      this.ws.send(JSON.stringify({ event: 'clear', streamSid: this._sessionId }));
      log.debug({ sessionId: this._sessionId }, 'Sent buffer clear to Twilio');
    } catch (err) {
      log.warn({ err }, 'Failed to clear Twilio audio buffer');
    }
  }

  disconnect(): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }

  // ─── Typed event emitter ─────────────────────────────────────────────────

  on<K extends keyof TelephonyStreamSessionEvents>(
    event: K,
    listener: TelephonyStreamSessionEvents[K]
  ): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof TelephonyStreamSessionEvents>(
    event: K,
    listener: TelephonyStreamSessionEvents[K]
  ): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }
}

// ─── TwilioProvider ────────────────────────────────────────────────────────

export class TwilioProvider implements TelephonyProvider {
  readonly name = 'twilio';
  readonly streamConnectContentType = 'text/xml';

  constructor(private readonly streamUrl: string) {}

  generateStreamConnectResponse(from: string): string {
    // TwiML <Connect><Stream> instructs Twilio to open a Media Streams WebSocket
    // to streamUrl and pass the caller's number as a custom parameter so the
    // Audio Gateway can look up or create the lead immediately on connect.
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${this.streamUrl}">
      <Parameter name="from" value="${from}" />
    </Stream>
  </Connect>
</Response>`;
  }

  handleWebSocketConnection(ws: WebSocket): TelephonyStreamSession {
    return new TwilioStreamSession(ws);
  }

  async makeOutboundCall(options: OutboundCallOptions): Promise<string> {
    return twilioMakeOutboundCall(options);
  }

  async getCallDetails(callId: string): Promise<CallDetails> {
    const call = await twilioGetCallDetails(callId);
    return {
      callId: call.sid,
      status: call.status,
      from: call.from,
      to: call.to,
      direction: call.direction === 'inbound' ? 'inbound' : 'outbound',
      durationSecs: call.duration ? Number(call.duration) : undefined,
    };
  }

  async transferCall(callId: string, to: string, _options?: TransferCallOptions): Promise<void> {
    const client = getTwilioClient();
    log.info({ callId, to }, 'Transferring call via Twilio');
    // Cold transfer: redirect the live call to dial the target number.
    await client.calls(callId).update({
      twiml: `<Response><Dial>${to}</Dial></Response>`,
    });
  }
}
