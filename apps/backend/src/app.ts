import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { logger } from '@property-ai/logger';
import { authRouter } from './modules/auth/auth.routes.js';
import { leadsRouter } from './modules/leads/leads.routes.js';
import { propertiesRouter } from './modules/properties/properties.routes.js';
import { siteVisitsRouter } from './modules/site-visits/site-visits.routes.js';
import { callsRouter } from './modules/calls/calls.routes.js';
import { conversationsRouter } from './modules/conversations/conversations.routes.js';
import { errorHandler } from './middlewares/error-handler.js';
import { notFoundHandler } from './middlewares/not-found.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? '*',
      credentials: true,
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(
    pinoHttp({
      logger,
      redact: ['req.headers.authorization'],
    })
  );

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/ready', async (_req, res) => {
    try {
      const { prisma } = await import('@property-ai/database');
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready', db: 'connected' });
    } catch {
      res.status(503).json({ status: 'not ready', db: 'disconnected' });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/leads', leadsRouter);
  app.use('/api/properties', propertiesRouter);
  app.use('/api/site-visits', siteVisitsRouter);
  app.use('/api/calls', callsRouter);
  app.use('/api/conversations', conversationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
