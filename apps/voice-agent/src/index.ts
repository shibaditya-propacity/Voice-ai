/**
 * index.ts — Voice Agent server entry point.
 *
 * Architecture:
 *   HTTP server:
 *     POST /voice/incoming  → returns TwiML with Media Stream connect
 *     POST /voice/outbound  → returns TwiML with Media Stream connect
 *     POST /voice/status    → Twilio call status callback
 *     GET  /health          → health check
 *
 *   WebSocket upgrade at /media-stream:
 *     ↔ Twilio Media Streams (real-time μ-law audio, bidirectional)
 *     → Audio Gateway → VAD → STT → Orchestrator → TTS → Twilio
 *
 * The HTTP and WebSocket servers share the same port — WebSocket
 * connections are upgraded from the HTTP server via the 'upgrade' event.
 */

import 'dotenv/config';
import http from 'http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { logger } from '@property-ai/logger';
import { prisma } from '@property-ai/database';
import { voiceRouter } from './voice.routes.js';
import { createAudioGateway, getActiveCallCount } from './gateway/audio-gateway.js';

const app = express();
const PORT = Number(process.env.VOICE_AGENT_PORT ?? 4001);

// ─── HTTP middleware ───────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
// Twilio sends webhooks as URL-encoded form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(pinoHttp({ logger }));

// ─── Routes ───────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'voice-agent',
    activeCalls: getActiveCallCount(),
    uptime: Math.round(process.uptime()),
  });
});

app.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not ready', reason: 'database unavailable' });
  }
});

app.use('/voice', voiceRouter);

// ─── HTTP + WebSocket server ───────────────────────────────────────────────

const httpServer = http.createServer(app);

// Create the Twilio Media Streams WebSocket gateway
const audioGateway = createAudioGateway();

// Upgrade HTTP connections at /media-stream to WebSocket
httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  if (url.pathname === '/media-stream') {
    audioGateway.handleUpgrade(request, socket, head, (ws) => {
      audioGateway.emit('connection', ws, request);
    });
  } else {
    // Reject WebSocket upgrades to unknown paths
    socket.destroy();
  }
});

// ─── Server startup ────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  logger.info({
    port: PORT,
    websocketPath: '/media-stream',
    httpPaths: ['/voice/incoming', '/voice/outbound', '/voice/status'],
  }, 'Voice agent v2 started — streaming pipeline active');
});

// ─── Graceful shutdown ─────────────────────────────────────────────────────

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Graceful shutdown initiated');

  httpServer.close(async () => {
    audioGateway.close();
    await prisma.$disconnect();
    logger.info('Voice agent shut down cleanly');
    process.exit(0);
  });

  // Force exit after 15 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 15_000);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection — call not crashed');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — forcing shutdown');
  process.exit(1);
});
