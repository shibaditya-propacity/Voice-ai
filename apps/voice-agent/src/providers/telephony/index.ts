/**
 * providers/telephony/index.ts — Telephony provider factory and public exports.
 *
 * Active provider: twilio
 * Set TELEPHONY_PROVIDER in .env to select at startup.
 *
 * To switch to Exotel:
 *   1. Uncomment ExotelProvider in exotel-provider.ts
 *   2. Uncomment the import and 'exotel' case below
 *   3. Set TELEPHONY_PROVIDER=exotel in .env
 *   4. Fill in EXOTEL_* vars in .env
 */

import { TwilioProvider } from './twilio-provider.js';
import type { TelephonyProvider } from './provider.js';

// To switch to Exotel: uncomment exotel-provider.ts, then uncomment this line
// import { ExotelProvider } from './exotel-provider.js';

// ─── Public type exports ───────────────────────────────────────────────────

export type {
  TelephonyProvider,
  TelephonyStreamSession,
  TelephonyStreamSessionEvents,
  TelephonyEvent,
  TelephonyCallStartedEvent,
  TelephonyAudioFrameEvent,
  TelephonyCallEndedEvent,
  TelephonyDtmfEvent,
  OutboundCallOptions,
  CallDetails,
  TransferCallOptions,
} from './provider.js';

export { TwilioProvider } from './twilio-provider.js';

// ─── Singleton factory ─────────────────────────────────────────────────────

let _provider: TelephonyProvider | null = null;

export function getTelephonyProvider(): TelephonyProvider {
  if (_provider) return _provider;

  const providerName = process.env.TELEPHONY_PROVIDER ?? 'twilio';

  if (providerName === 'twilio') {
    _provider = new TwilioProvider(buildStreamUrl());
    return _provider;
  }

  // To switch to Exotel: uncomment this block
  // if (providerName === 'exotel') {
  //   _provider = new ExotelProvider({
  //     apiKey:     requireEnv('EXOTEL_API_KEY'),
  //     apiToken:   requireEnv('EXOTEL_API_TOKEN'),
  //     accountSid: requireEnv('EXOTEL_ACCOUNT_SID'),
  //     callerId:   requireEnv('EXOTEL_CALLER_ID'),
  //     subdomain:  process.env.EXOTEL_SUBDOMAIN ?? 'api.in.exotel.com',
  //     streamUrl:  buildStreamUrl(),
  //   });
  //   return _provider;
  // }

  throw new Error(
    `Unknown TELEPHONY_PROVIDER: "${providerName}". Valid values: twilio`
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function buildStreamUrl(): string {
  const host = process.env.VOICE_AGENT_URL ?? '';
  const wsHost = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `wss://${wsHost}/media-stream`;
}
