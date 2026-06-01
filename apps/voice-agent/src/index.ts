import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { logger } from '@property-ai/logger';
import { prisma } from '@property-ai/database';
import { voiceRouter } from './voice.routes.js';
import { join } from 'path';
import { mkdirSync } from 'fs';

const app = express();
const PORT = Number(process.env.VOICE_AGENT_PORT ?? 4001);

// Ensure audio directory exists
const audioDir = join(process.cwd(), 'public', 'audio');
mkdirSync(audioDir, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(pinoHttp({ logger }));

// Serve generated audio files so Twilio can fetch them
app.use('/audio', express.static(audioDir));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'voice-agent' });
});

app.use('/voice', voiceRouter);

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Voice agent started');
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down voice agent');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
