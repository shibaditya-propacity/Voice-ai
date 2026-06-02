import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  VOICE_AGENT_PORT: z.coerce.number().default(4001),
  JWT_SECRET: z.string().min(32),
  DATABASE_URL: z.string().url(),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),
  BEDROCK_MODEL_ID: z.string().default('anthropic.claude-3-5-sonnet-20241022-v2:0'),
  TWILIO_ACCOUNT_SID: z.string().startsWith('AC'),
  TWILIO_AUTH_TOKEN: z.string(),
  TWILIO_PHONE_NUMBER: z.string(),
  VOICE_AGENT_URL: z.string().url(),
  ELEVENLABS_API_KEY: z.string(),
  ELEVENLABS_VOICE_ID: z.string(),
  // Streaming STT
  DEEPGRAM_API_KEY: z.string().optional(),
  // Optional Redis for distributed session store
  REDIS_URL: z.string().url().optional(),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${missing}`);
  }
  return result.data;
}

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = parseEnv();
  }
  return _config;
}

export { envSchema };
