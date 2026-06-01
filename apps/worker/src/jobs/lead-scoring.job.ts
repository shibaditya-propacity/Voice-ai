import { prisma } from '@property-ai/database';
import { calculateLeadScore } from '@property-ai/lead-engine';
import { createChildLogger } from '@property-ai/logger';
import type { PropertyType } from '@property-ai/shared';

const log = createChildLogger({ module: 'lead-scoring-job' });

export async function runLeadScoring(): Promise<void> {
  log.info('Running lead scoring job');

  const leads = await prisma.lead.findMany({ take: 200 });
  let updated = 0;

  for (const lead of leads) {
    const hasSiteVisit = (await prisma.siteVisit.count({ where: { leadId: lead.id } })) > 0;
    const score = calculateLeadScore(lead as { propertyType?: PropertyType }, hasSiteVisit).total;

    if (score !== lead.leadScore) {
      await prisma.lead.update({ where: { id: lead.id }, data: { leadScore: score } });
      updated++;
    }
  }

  log.info({ total: leads.length, updated }, 'Lead scoring complete');
}
