import { createChildLogger } from '@property-ai/logger';
import { createHash } from 'crypto';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const log = createChildLogger({ module: 'elevenlabs' });

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const CACHE_DIR = join(process.cwd(), '.audio-cache');

export interface SpeechOptions {
  text: string;
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
}

export async function generateSpeech(options: SpeechOptions): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = options.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) throw new Error('ElevenLabs credentials not configured');

  log.info({ textLength: options.text.length, voiceId }, 'Generating speech');

  const response = await fetch(
    `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: options.text,
        model_id: options.modelId ?? 'eleven_flash_v2_5',
        voice_settings: {
          stability: options.stability ?? 0.3,
          similarity_boost: options.similarityBoost ?? 0.9,
          style: options.style ?? 0.5,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    log.error({ status: response.status, error }, 'ElevenLabs API error');
    throw new Error(`ElevenLabs API error: ${response.status} ${error}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function cacheSpeech(
  text: string,
  audioBuffer: Buffer
): Promise<string> {
  if (!existsSync(CACHE_DIR)) {
    await mkdir(CACHE_DIR, { recursive: true });
  }
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  const filePath = join(CACHE_DIR, `${hash}.mp3`);
  await writeFile(filePath, audioBuffer);
  return filePath;
}

export async function getCachedSpeech(text: string): Promise<Buffer | null> {
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  const filePath = join(CACHE_DIR, `${hash}.mp3`);
  if (!existsSync(filePath)) return null;
  return readFile(filePath);
}

export async function generateAndCacheSpeech(
  options: SpeechOptions
): Promise<{ buffer: Buffer; cached: boolean }> {
  const cached = await getCachedSpeech(options.text);
  if (cached) {
    log.debug({ textLength: options.text.length }, 'Returning cached audio');
    return { buffer: cached, cached: true };
  }
  // Retry once on failure
  let buffer: Buffer;
  try {
    buffer = await generateSpeech(options);
  } catch (err) {
    log.warn({ err }, 'ElevenLabs first attempt failed, retrying');
    buffer = await generateSpeech(options);
  }
  await cacheSpeech(options.text, buffer);
  return { buffer, cached: false };
}

export async function streamSpeech(
  options: SpeechOptions
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = options.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) throw new Error('ElevenLabs credentials not configured');

  const response = await fetch(
    `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: options.text,
        model_id: options.modelId ?? 'eleven_multilingual_v2',
        voice_settings: {
          stability: options.stability ?? 0.5,
          similarity_boost: options.similarityBoost ?? 0.75,
        },
      }),
    }
  );

  if (!response.ok || !response.body) {
    throw new Error(`ElevenLabs stream error: ${response.status}`);
  }

  return response.body;
}
