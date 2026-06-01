import twilio from 'twilio';
import { createChildLogger } from '@property-ai/logger';

const log = createChildLogger({ module: 'twilio-client' });

let _client: twilio.Twilio | null = null;

export function getTwilioClient(): twilio.Twilio {
  if (!_client) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials not configured');
    }
    _client = twilio(accountSid, authToken);
    log.info('Twilio client initialized');
  }
  return _client;
}
