import 'dotenv/config';
import { createApp } from './app.js';
import { getConfig } from '@property-ai/config';
import { logger } from '@property-ai/logger';
import { prisma } from '@property-ai/database';

async function bootstrap() {
  const config = getConfig();
  const app = createApp();

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Backend server started');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    server.close(async () => {
      await prisma.$disconnect();
      logger.info('Server shut down cleanly');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
