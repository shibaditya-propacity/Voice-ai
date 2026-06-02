/**
 * providers/telephony/exotel-provider.ts — Exotel implementation (COMMENTED OUT)
 *
 * Exotel is the future provider for Indian virtual numbers and local PSTN termination.
 * This file is fully implemented and ready — Twilio is the currently active provider.
 *
 * To activate Exotel:
 *   1. Uncomment the entire implementation below
 *   2. In index.ts: uncomment ExotelProvider import + 'exotel' factory case
 *   3. Set TELEPHONY_PROVIDER=exotel in .env
 *   4. Fill in EXOTEL_* vars in .env (see .env.example)
 *
 * CRITICAL AUDIO NOTE (for when you activate this):
 *   Twilio → pipeline: μ-law 8kHz  (no conversion)
 *   Exotel → pipeline: PCM16 LE 8kHz → decoded to μ-law here before emitting
 *   Pipeline → Exotel: μ-law → encoded to PCM16 here before sending
 *   All conversion is inside this file. The rest of the system always sees μ-law.
 *
 * Exotel AgentStream docs: https://developer.exotel.com/docs/agentstream/developer-guide
 * Exotel REST API docs:    https://developer.exotel.com/api/
 */

// import { EventEmitter } from 'events';
// import { WebSocket } from 'ws';
// import { createChildLogger } from '@property-ai/logger';
// import type {
//   TelephonyProvider,
//   TelephonyStreamSession,
//   TelephonyStreamSessionEvents,
//   OutboundCallOptions,
//   CallDetails,
//   TransferCallOptions,
// } from './provider.js';
//
// const log = createChildLogger({ module: 'exotel-provider' });
//
// // ─── G.711 μ-law ↔ PCM16 codec ────────────────────────────────────────────
// // Implemented inline to avoid an npm dependency on a hot audio path.
//
// const MULAW_EXP_LUT = new Uint8Array([
//   0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3,
//   4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
//   5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
//   5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
//   6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
//   6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
//   6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
//   6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
//   7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
//   7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
//   7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
//   7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
//   7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
//   7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
//   7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
//   7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
// ]);
//
// function pcm16SampleToMulaw(sample: number): number {
//   const BIAS = 0x84;
//   const CLIP = 32635;
//   const sign = (sample >> 8) & 0x80;
//   if (sign !== 0) sample = -sample;
//   if (sample > CLIP) sample = CLIP;
//   sample += BIAS;
//   const exp = MULAW_EXP_LUT[(sample >> 7) & 0xFF];
//   const mantissa = (sample >> (exp + 3)) & 0x0F;
//   return (~(sign | (exp << 4) | mantissa)) & 0xFF;
// }
//
// function mulawSampleToPcm16(mulaw: number): number {
//   mulaw = (~mulaw) & 0xFF;
//   const sign = mulaw & 0x80;
//   const exp = (mulaw >> 4) & 0x07;
//   const mantissa = mulaw & 0x0F;
//   let sample = ((mantissa << 3) + 0x84) << exp;
//   sample -= 0x84;
//   return sign !== 0 ? -sample : sample;
// }
//
// function pcm16ToMulaw(pcm16: Buffer): Buffer {
//   const sampleCount = pcm16.length >> 1;
//   const out = Buffer.allocUnsafe(sampleCount);
//   for (let i = 0; i < sampleCount; i++) {
//     out[i] = pcm16SampleToMulaw(pcm16.readInt16LE(i * 2));
//   }
//   return out;
// }
//
// function mulawToPcm16(mulaw: Buffer): Buffer {
//   const out = Buffer.allocUnsafe(mulaw.length * 2);
//   for (let i = 0; i < mulaw.length; i++) {
//     out.writeInt16LE(mulawSampleToPcm16(mulaw[i]!), i * 2);
//   }
//   return out;
// }
//
// // ─── Exotel WebSocket message types ───────────────────────────────────────
// // Source: https://developer.exotel.com/docs/agentstream/developer-guide
//
// interface ExotelConnectedMsg {
//   event: 'connected';
//   stream_sid: string;
// }
// interface ExotelStartMsg {
//   event: 'start';
//   sequence_number: string;
//   stream_sid: string;
//   start: {
//     stream_sid: string;
//     call_sid: string;
//     account_sid: string;
//     from: string;
//     to: string;
//     custom_parameters?: Record<string, string>;
//     media_format: { sample_rate: number; encoding: string; bit_depth: number };
//   };
// }
// interface ExotelMediaMsg {
//   event: 'media';
//   sequence_number: string;
//   stream_sid: string;
//   media: { chunk: string; timestamp: string; payload: string };
// }
// interface ExotelStopMsg {
//   event: 'stop';
//   sequence_number: string;
//   stream_sid: string;
//   stop: { reason: string };
// }
// interface ExotelDtmfMsg {
//   event: 'dtmf';
//   sequence_number: string;
//   stream_sid: string;
//   dtmf: { digit: string; duration: string };
// }
// interface ExotelMarkMsg {
//   event: 'mark';
//   stream_sid: string;
//   mark: { name: string };
// }
//
// type ExotelInboundMessage =
//   | ExotelConnectedMsg
//   | ExotelStartMsg
//   | ExotelMediaMsg
//   | ExotelStopMsg
//   | ExotelDtmfMsg
//   | ExotelMarkMsg;
//
// // ─── ExotelStreamSession ───────────────────────────────────────────────────
//
// class ExotelStreamSession implements TelephonyStreamSession {
//   private readonly emitter = new EventEmitter();
//   private _callId: string | null = null;
//   private _sessionId: string | null = null;
//   // Accumulates PCM16 bytes until we have a 320-byte aligned payload to send.
//   // (320 bytes PCM16 = 160 samples = 20ms @ 8kHz)
//   private pendingPcm16 = Buffer.alloc(0);
//
//   constructor(private readonly ws: WebSocket) {
//     ws.on('message', (data) => void this.handleMessage(data.toString()));
//     ws.on('close',   () => this.handleClose());
//     ws.on('error',   (err) => this.emitter.emit('error', err));
//   }
//
//   get callId():    string | null { return this._callId; }
//   get sessionId(): string | null { return this._sessionId; }
//
//   private handleMessage(raw: string): void {
//     let msg: ExotelInboundMessage;
//     try {
//       msg = JSON.parse(raw) as ExotelInboundMessage;
//     } catch {
//       log.warn('Received non-JSON message on Exotel WebSocket');
//       return;
//     }
//
//     switch (msg.event) {
//       case 'connected':
//         log.debug({ streamSid: msg.stream_sid }, 'Exotel AgentStream connected');
//         break;
//
//       case 'start': {
//         const s = msg.start;
//         this._callId    = s.call_sid;
//         this._sessionId = s.stream_sid;
//         log.debug({ callId: s.call_sid, sessionId: s.stream_sid, from: s.from }, 'Exotel stream started');
//         this.emitter.emit('call_started', {
//           type: 'call_started',
//           callId:   s.call_sid,
//           sessionId: s.stream_sid,
//           from:      s.from,
//           customParameters: s.custom_parameters,
//         });
//         break;
//       }
//
//       case 'media': {
//         // Exotel sends PCM16 LE base64 — convert to μ-law for the pipeline.
//         const pcm16 = Buffer.from(msg.media.payload, 'base64');
//         const mulaw = pcm16ToMulaw(pcm16);
//         this.emitter.emit('audio_frame', {
//           type:      'audio_frame',
//           sessionId:  msg.stream_sid,
//           payload:    mulaw,
//         });
//         break;
//       }
//
//       case 'stop':
//         log.debug({ sessionId: msg.stream_sid, reason: msg.stop.reason }, 'Exotel stream stopped');
//         // Exotel stop event carries no call_sid — use cached _callId.
//         this.emitter.emit('call_ended', {
//           type:      'call_ended',
//           callId:    this._callId ?? '',
//           sessionId:  this._sessionId ?? msg.stream_sid,
//         });
//         break;
//
//       case 'dtmf':
//         this.emitter.emit('dtmf', {
//           type:      'dtmf',
//           sessionId:  msg.stream_sid,
//           digit:      msg.dtmf.digit,
//         });
//         break;
//
//       case 'mark':
//         log.debug({ markName: msg.mark.name }, 'Exotel mark event');
//         break;
//     }
//   }
//
//   private handleClose(): void {
//     if (this._callId && this._sessionId) {
//       log.debug({ callId: this._callId }, 'Exotel WS closed — synthesizing call_ended');
//       this.emitter.emit('call_ended', {
//         type:      'call_ended',
//         callId:    this._callId,
//         sessionId:  this._sessionId,
//       });
//     }
//   }
//
//   sendAudio(buffer: Buffer): void {
//     if (this.ws.readyState !== WebSocket.OPEN || !this._sessionId) return;
//     // buffer is μ-law from ElevenLabs — convert to PCM16 LE for Exotel.
//     const pcm16 = mulawToPcm16(buffer);
//     this.pendingPcm16 = Buffer.concat([this.pendingPcm16, pcm16]);
//     // Exotel requires payload to be a multiple of 320 bytes.
//     const aligned = Math.floor(this.pendingPcm16.length / 320) * 320;
//     if (aligned === 0) return;
//     const payload = this.pendingPcm16.subarray(0, aligned);
//     this.pendingPcm16 = this.pendingPcm16.subarray(aligned);
//     try {
//       this.ws.send(JSON.stringify({
//         event:      'media',
//         stream_sid: this._sessionId,
//         media:      { payload: payload.toString('base64') },
//       }));
//     } catch (err) {
//       log.warn({ err }, 'Failed to send audio to Exotel');
//     }
//   }
//
//   clearAudioBuffer(): void {
//     if (this.ws.readyState !== WebSocket.OPEN || !this._sessionId) return;
//     this.pendingPcm16 = Buffer.alloc(0); // discard buffered audio
//     try {
//       this.ws.send(JSON.stringify({ event: 'clear', stream_sid: this._sessionId }));
//       log.debug({ sessionId: this._sessionId }, 'Sent buffer clear to Exotel');
//     } catch (err) {
//       log.warn({ err }, 'Failed to clear Exotel audio buffer');
//     }
//   }
//
//   disconnect(): void {
//     if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
//   }
//
//   on<K extends keyof TelephonyStreamSessionEvents>(
//     event: K,
//     listener: TelephonyStreamSessionEvents[K]
//   ): this {
//     this.emitter.on(event, listener as (...args: unknown[]) => void);
//     return this;
//   }
//
//   off<K extends keyof TelephonyStreamSessionEvents>(
//     event: K,
//     listener: TelephonyStreamSessionEvents[K]
//   ): this {
//     this.emitter.off(event, listener as (...args: unknown[]) => void);
//     return this;
//   }
// }
//
// // ─── ExotelProvider ────────────────────────────────────────────────────────
//
// export interface ExotelProviderConfig {
//   apiKey: string;
//   apiToken: string;
//   accountSid: string;
//   callerId: string;
//   subdomain: string;
//   streamUrl: string;
// }
//
// export class ExotelProvider implements TelephonyProvider {
//   readonly name = 'exotel';
//   readonly streamConnectContentType = 'application/json';
//
//   constructor(private readonly config: ExotelProviderConfig) {}
//
//   generateStreamConnectResponse(from: string): string {
//     // Exotel VoiceBot webhook: respond with JSON containing our WSS URL.
//     return JSON.stringify({
//       url: this.config.streamUrl,
//       customParameters: { from },
//     });
//   }
//
//   handleWebSocketConnection(ws: WebSocket): TelephonyStreamSession {
//     return new ExotelStreamSession(ws);
//   }
//
//   async makeOutboundCall(options: OutboundCallOptions): Promise<string> {
//     const from = options.from ?? this.config.callerId;
//     log.info({ to: options.to, from }, 'Making outbound call via Exotel');
//     const params = new URLSearchParams({
//       From:     from,
//       To:       options.to,
//       CallerId: this.config.callerId,
//       ...(options.statusCallbackUrl && { StatusCallback: options.statusCallbackUrl }),
//     });
//     const res  = await this.request('POST', 'Calls/connect', params);
//     const json = await res.json() as { CallSid?: string; call_sid?: string };
//     const callId = json.CallSid ?? json.call_sid;
//     if (!callId) throw new Error(`Exotel outbound call failed: ${JSON.stringify(json)}`);
//     log.info({ callId }, 'Exotel outbound call initiated');
//     return callId;
//   }
//
//   async getCallDetails(callId: string): Promise<CallDetails> {
//     const res  = await this.request('GET', `Calls/${callId}.json`);
//     const json = await res.json() as {
//       CallSid?: string;
//       Status?: string;
//       From?: string;
//       To?: string;
//       Direction?: string;
//       Duration?: string | number;
//     };
//     return {
//       callId:      json.CallSid ?? callId,
//       status:      json.Status ?? 'unknown',
//       from:        json.From ?? '',
//       to:          json.To ?? '',
//       direction:   json.Direction === 'inbound' ? 'inbound' : 'outbound',
//       durationSecs: json.Duration ? Number(json.Duration) : undefined,
//     };
//   }
//
//   async transferCall(callId: string, to: string, _options?: TransferCallOptions): Promise<void> {
//     // Exotel has no live-redirect API — initiate a new connect leg to the target.
//     log.info({ callId, to }, 'Transferring call via Exotel (new connect leg)');
//     const params = new URLSearchParams({
//       From:     to,
//       To:       to,
//       CallerId: this.config.callerId,
//     });
//     await this.request('POST', 'Calls/connect', params);
//   }
//
//   private async request(
//     method: 'GET' | 'POST',
//     path: string,
//     body?: URLSearchParams
//   ): Promise<Response> {
//     const { apiKey, apiToken, subdomain, accountSid } = this.config;
//     const url  = `https://${subdomain}/v1/Accounts/${accountSid}/${path}`;
//     const auth = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');
//     const res  = await fetch(url, {
//       method,
//       headers: {
//         Authorization: `Basic ${auth}`,
//         ...(body && { 'Content-Type': 'application/x-www-form-urlencoded' }),
//       },
//       ...(body && { body: body.toString() }),
//     });
//     if (!res.ok) {
//       const text = await res.text().catch(() => '');
//       throw new Error(`Exotel API ${method} ${path} → HTTP ${res.status}: ${text}`);
//     }
//     return res;
//   }
// }

export {};
