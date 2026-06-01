import { prisma } from '@property-ai/database';
import { makeOutboundCall } from '@property-ai/twilio';
import { createChildLogger } from '@property-ai/logger';

const log = createChildLogger({ module: 'follow-up-job' });

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export async function runFollowUps(): Promise<void> {
  log.info('Running follow-up job');

  const voiceAgentUrl = process.env.VOICE_AGENT_URL;
  if (!voiceAgentUrl) {
    log.warn('VOICE_AGENT_URL not set, skipping follow-ups');
    return;
  }

  const twoDaysAgo = new Date(Date.now() - TWO_DAYS_MS);

  const leads = await prisma.lead.findMany({
    where: {
      leadScore: { lt: 80 },
      updatedAt: { lt: twoDaysAgo },
    },
    take: 20,
  });

  let called = 0;

  for (const lead of leads) {
    if (!lead.phone) continue;

    const hasScheduled = await prisma.siteVisit.findFirst({
      where: { leadId: lead.id, status: 'SCHEDULED' },
    });
    if (hasScheduled) continue;

    try {
      const callSid = await makeOutboundCall({
        to: lead.phone,
        webhookUrl: `${voiceAgentUrl}/voice/outbound`,
        statusCallbackUrl: `${voiceAgentUrl}/voice/status`,
      });

      await prisma.callLog.create({
        data: {
          callSid,
          leadId: lead.id,
          direction: 'outbound',
          to: lead.phone,
          from: process.env.TWILIO_PHONE_NUMBER,
        },
      });

      called++;
      log.info({ leadId: lead.id, callSid }, 'Follow-up call initiated');
    } catch (err) {
      log.error({ err, leadId: lead.id }, 'Failed to initiate follow-up call');
    }
  }

  log.info({ candidates: leads.length, called }, 'Follow-up job complete');
}
