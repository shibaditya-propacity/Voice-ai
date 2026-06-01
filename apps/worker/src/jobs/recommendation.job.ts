import { prisma } from '@property-ai/database';
import { findMatchingProperties } from '@property-ai/property-engine';
import { createChildLogger } from '@property-ai/logger';
import type { PropertySearchParams } from '@property-ai/shared';

const log = createChildLogger({ module: 'recommendation-job' });

export async function runRecommendations(): Promise<void> {
  log.info('Running recommendation job');

  const leads = await prisma.lead.findMany({
    where: { city: { not: null } },
    take: 50,
  });

  const allProperties = await prisma.property.findMany();
  if (allProperties.length === 0) return;

  let updated = 0;

  for (const lead of leads) {
    const params: PropertySearchParams = {
      city: lead.city ?? undefined,
      area: lead.area ?? undefined,
      propertyType: lead.propertyType ?? undefined,
      bhk: lead.bhk ?? undefined,
    };

    if (lead.budget) {
      const budgetNum = parseBudget(lead.budget);
      if (budgetNum) {
        params.minBudget = budgetNum * 0.8;
        params.maxBudget = budgetNum * 1.2;
      }
    }

    const matches = findMatchingProperties(allProperties, params, 3);
    if (matches.length === 0) continue;

    const top = matches[0];
    const note = `Top match: ${top.property.name}, ${top.property.area}, ${top.property.city} (score: ${top.score})`;

    await prisma.lead.update({ where: { id: lead.id }, data: { notes: note } });
    updated++;
  }

  log.info({ total: leads.length, updated }, 'Recommendation job complete');
}

function parseBudget(budget: string): number | null {
  const cleaned = budget.toLowerCase().replace(/[,\s]/g, '');
  const crMatch = cleaned.match(/^(\d+\.?\d*)\s*cr/);
  if (crMatch) return parseFloat(crMatch[1]) * 10_000_000;
  const lakhMatch = cleaned.match(/^(\d+\.?\d*)\s*l/);
  if (lakhMatch) return parseFloat(lakhMatch[1]) * 100_000;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}
