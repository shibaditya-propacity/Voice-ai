import type { Request, Response } from 'express';
import { VoiceService } from './voice.service.js';
import { logger } from '@property-ai/logger';

const voiceService = new VoiceService();

export async function handleIncomingCall(req: Request, res: Response) {
  try {
    const { CallSid, From } = req.body as { CallSid: string; From: string };
    logger.info({ callSid: CallSid, from: From }, 'Incoming call');
    const twiml = await voiceService.handleIncoming(CallSid, From);
    res.type('text/xml').send(twiml);
  } catch (err) {
    logger.error({ err }, 'Error handling incoming call');
    res.type('text/xml').send(buildErrorTwiML());
  }
}

export async function handleGather(req: Request, res: Response) {
  try {
    const {
      CallSid,
      From,
      SpeechResult,
      Confidence,
    } = req.body as { CallSid: string; From?: string; SpeechResult?: string; Confidence?: string };

    logger.info({ callSid: CallSid, speechResult: SpeechResult, confidence: Confidence }, 'Speech gathered');
    // Re-create session if lost (e.g. server restart mid-call)
    const twiml = await voiceService.handleSpeech(CallSid, SpeechResult ?? '', From);
    res.type('text/xml').send(twiml);
  } catch (err) {
    logger.error({ err }, 'Error handling gather');
    res.type('text/xml').send(buildErrorTwiML());
  }
}

export async function handleOutboundCall(req: Request, res: Response) {
  try {
    const { CallSid, To } = req.body as { CallSid: string; To: string };
    logger.info({ callSid: CallSid, to: To }, 'Outbound call connected');
    const twiml = await voiceService.handleOutbound(CallSid, To);
    res.type('text/xml').send(twiml);
  } catch (err) {
    logger.error({ err }, 'Error handling outbound call');
    res.type('text/xml').send(buildErrorTwiML());
  }
}

export async function handleCallStatus(req: Request, res: Response) {
  try {
    const { CallSid, CallStatus, CallDuration } = req.body as {
      CallSid: string;
      CallStatus: string;
      CallDuration?: string;
    };
    logger.info({ callSid: CallSid, status: CallStatus, duration: CallDuration }, 'Call status update');
    await voiceService.handleCallComplete(CallSid, CallStatus, Number(CallDuration ?? 0));
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'Error handling call status');
    res.status(204).send();
  }
}

function buildErrorTwiML(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">I apologize, we are experiencing technical difficulties. Please call back shortly.</Say>
  <Hangup/>
</Response>`;
}
