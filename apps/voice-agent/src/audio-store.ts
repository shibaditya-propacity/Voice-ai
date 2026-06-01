import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createChildLogger } from '@property-ai/logger';

const log = createChildLogger({ module: 'audio-store' });

const AUDIO_DIR = join(process.cwd(), 'public', 'audio');
const BASE_URL = process.env.VOICE_AGENT_URL ?? 'http://localhost:4001';

export async function uploadAudio(key: string, buffer: Buffer): Promise<void> {
  if (!existsSync(AUDIO_DIR)) {
    await mkdir(AUDIO_DIR, { recursive: true });
  }
  const filePath = join(AUDIO_DIR, key);
  await writeFile(filePath, buffer);
  log.debug({ key }, 'Audio saved to disk');
}

export function getAudioPublicUrl(key: string): string {
  return `${BASE_URL}/audio/${key}`;
}
