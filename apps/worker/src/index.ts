import 'dotenv/config';
import { logger } from '@property-ai/logger';
import { prisma } from '@property-ai/database';
import { runLeadScoring } from './jobs/lead-scoring.job.js';
import { runFollowUps } from './jobs/follow-up.job.js';
import { runRecommendations } from './jobs/recommendation.job.js';

const LEAD_SCORING_INTERVAL_MS = 5 * 60 * 1000;    // every 5 minutes
const FOLLOW_UP_INTERVAL_MS = 60 * 60 * 1000;       // every 1 hour
const RECOMMENDATION_INTERVAL_MS = 15 * 60 * 1000;  // every 15 minutes

async function bootstrap() {
  logger.info('Starting worker service (no Redis)');

  // Run all jobs immediately on startup
  await Promise.allSettled([runLeadScoring(), runFollowUps(), runRecommendations()]);

  // Schedule recurring jobs
  const intervals = [
    setInterval(() => runLeadScoring().catch((err) => logger.error({ err }, 'Lead scoring job failed')), LEAD_SCORING_INTERVAL_MS),
    setInterval(() => runFollowUps().catch((err) => logger.error({ err }, 'Follow-up job failed')), FOLLOW_UP_INTERVAL_MS),
    setInterval(() => runRecommendations().catch((err) => logger.error({ err }, 'Recommendation job failed')), RECOMMENDATION_INTERVAL_MS),
  ];

  logger.info('All workers scheduled');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down workers');
    intervals.forEach(clearInterval);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Worker startup failed');
  process.exit(1);
});
