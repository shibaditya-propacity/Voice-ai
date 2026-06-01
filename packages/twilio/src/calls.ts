import { getTwilioClient } from './client.js';
import { createChildLogger } from '@property-ai/logger';

const log = createChildLogger({ module: 'twilio-calls' });

export interface OutboundCallOptions {
  to: string;
  from?: string;
  webhookUrl: string;
  statusCallbackUrl?: string;
}

export async function makeOutboundCall(options: OutboundCallOptions): Promise<string> {
  const client = getTwilioClient();
  const from = options.from ?? process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error('Twilio phone number not configured');

  log.info({ to: options.to, from }, 'Making outbound call');

  const call = await client.calls.create({
    to: options.to,
    from,
    url: options.webhookUrl,
    method: 'POST',
    statusCallback: options.statusCallbackUrl,
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['completed', 'failed'],
  });

  log.info({ callSid: call.sid }, 'Outbound call initiated');
  return call.sid;
}

export async function getCallDetails(callSid: string) {
  const client = getTwilioClient();
  return client.calls(callSid).fetch();
}
