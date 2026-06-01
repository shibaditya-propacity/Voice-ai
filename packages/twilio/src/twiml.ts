import twilio from 'twilio';

const VoiceResponse = twilio.twiml.VoiceResponse;

export interface TwiMLOptions {
  audioUrl?: string;
  text?: string;
  language?: string;
  webhookUrl: string;
  speechTimeout?: string;
}

export function generateGatherTwiML(options: TwiMLOptions): string {
  const response = new VoiceResponse();

  const gather = response.gather({
    input: ['speech'],
    action: options.webhookUrl,
    method: 'POST',
    speechTimeout: options.speechTimeout ?? 'auto',
    language: mapLanguageCode(options.language ?? 'en'),
    enhanced: true,
  });

  if (options.audioUrl) {
    gather.play(options.audioUrl);
  } else if (options.text) {
    gather.say(
      {
        voice: 'Polly.Matthew',
        language: 'en-US',
      },
      options.text
    );
  }

  // Fallback if no input received
  response.redirect({ method: 'POST' }, options.webhookUrl);

  return response.toString();
}

export function generatePlayTwiML(audioUrl: string, nextWebhookUrl: string): string {
  const response = new VoiceResponse();
  const gather = response.gather({
    input: ['speech'],
    action: nextWebhookUrl,
    method: 'POST',
    speechTimeout: 'auto',
    enhanced: true,
  });
  gather.play(audioUrl);
  response.redirect({ method: 'POST' }, nextWebhookUrl);
  return response.toString();
}

export function generateHangupTwiML(audioUrl?: string, text?: string): string {
  const response = new VoiceResponse();
  if (audioUrl) {
    response.play(audioUrl);
  } else if (text) {
    response.say({ voice: 'Polly.Matthew' }, text);
  }
  response.hangup();
  return response.toString();
}

function mapLanguageCode(lang: string): string {
  const map: Record<string, string> = {
    en: 'en-IN',
    hi: 'hi-IN',
    mr: 'mr-IN',
  };
  return map[lang] ?? 'en-IN';
}
