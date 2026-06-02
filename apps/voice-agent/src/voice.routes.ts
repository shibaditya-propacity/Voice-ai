/**
 * voice.routes.ts — HTTP webhook routes for telephony call events.
 *
 * These routes return the provider-specific connect response (TwiML for Twilio,
 * equivalent format for other providers) that instructs the telephony provider
 * to connect the call to our media-stream WebSocket. All actual conversation
 * processing happens over the WebSocket — not over HTTP.
 *
 * Route responsibilities:
 *   POST /voice/incoming → Connect inbound call to media stream
 *   POST /voice/outbound → Connect outbound call to media stream
 *   POST /voice/status   → Log call completion (provider callback)
 *
 * This file is TELEPHONY-AGNOSTIC — provider selection is handled inside
 * getTelephonyProvider(). To swap providers, change TELEPHONY_PROVIDER in .env.
 */

import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import { createChildLogger } from '@property-ai/logger';
import { getTelephonyProvider } from './providers/telephony/index.js';

const log = createChildLogger({ module: 'voice-routes' });

export const voiceRouter: ExpressRouter = Router();

/**
 * POST /voice/incoming
 * Called by the telephony provider when an inbound call is received.
 * Returns the stream-connect response for this provider.
 */
voiceRouter.post('/incoming', (req: Request, res: Response) => {
  const callSid = (req.body.CallSid ?? req.body.call_sid ?? 'unknown') as string;
  const from    = (req.body.From  ?? req.body.from  ?? 'unknown') as string;

  log.info({ callSid, from }, 'Inbound call — connecting to media stream');

  const provider = getTelephonyProvider();
  res.set('Content-Type', provider.streamConnectContentType);
  res.send(provider.generateStreamConnectResponse(from));
});

/**
 * POST /voice/outbound
 * Called by the telephony provider when an outbound call is answered.
 * Same response structure as incoming — the media stream handles both.
 */
voiceRouter.post('/outbound', (req: Request, res: Response) => {
  const callSid = (req.body.CallSid ?? req.body.call_sid ?? 'unknown') as string;
  const to      = (req.body.To     ?? req.body.to     ?? 'unknown') as string;

  log.info({ callSid, to }, 'Outbound call answered — connecting to media stream');

  const provider = getTelephonyProvider();
  res.set('Content-Type', provider.streamConnectContentType);
  res.send(provider.generateStreamConnectResponse(to));
});

/**
 * POST /voice/status
 * Called by the telephony provider when a call ends (completed/failed/busy/no-answer).
 * The Audio Gateway handles actual teardown via the WebSocket 'call_ended' event.
 * This route just logs the final status for observability.
 */
voiceRouter.post('/status', (req: Request, res: Response) => {
  const {
    CallSid:      callSid,
    CallStatus:   status,
    CallDuration: duration,
    From:         from,
    To:           to,
  } = req.body as {
    CallSid?:      string;
    CallStatus?:   string;
    CallDuration?: string;
    From?:         string;
    To?:           string;
  };

  log.info({
    callSid,
    status,
    duration: duration ? Number(duration) : undefined,
    from,
    to,
  }, 'Call status update');

  res.sendStatus(204);
});
