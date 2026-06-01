import type { LeadData } from '@property-ai/shared';
import { createChildLogger } from '@property-ai/logger';

const log = createChildLogger({ module: 'lead-extractor' });

export function mergeLeadData(
  existing: Partial<LeadData>,
  incoming: Partial<LeadData>
): Partial<LeadData> {
  const merged: Partial<LeadData> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined && value !== '') {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  log.debug({ merged }, 'Merged lead data');
  return merged;
}

export function isLeadQualified(data: Partial<LeadData>): boolean {
  return !!(data.name && data.budget && data.city && data.propertyType);
}

export function getNextQuestion(data: Partial<LeadData>): string | null {
  if (!data.name) return 'name';
  if (!data.city) return 'city';
  if (!data.budget) return 'budget';
  if (!data.bhk) return 'bhk';
  if (!data.propertyType) return 'propertyType';
  if (!data.timeline) return 'timeline';
  if (data.loanRequired === undefined) return 'loanRequired';
  return null;
}
