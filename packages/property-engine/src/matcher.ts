import type { Property } from '@property-ai/database';
import type { PropertySearchParams } from '@property-ai/shared';
import { createChildLogger } from '@property-ai/logger';

const log = createChildLogger({ module: 'property-matcher' });

export interface ScoredProperty {
  property: Property;
  score: number;
  matchReasons: string[];
}

export function calculatePropertyScore(
  property: Property,
  params: PropertySearchParams
): ScoredProperty {
  let score = 0;
  const matchReasons: string[] = [];

  if (params.city && property.city.toLowerCase() === params.city.toLowerCase()) {
    score += 30;
    matchReasons.push(`City match: ${property.city}`);
  }

  if (params.area && property.area.toLowerCase().includes(params.area.toLowerCase())) {
    score += 25;
    matchReasons.push(`Area match: ${property.area}`);
  }

  if (params.propertyType && property.propertyType === params.propertyType) {
    score += 20;
    matchReasons.push(`Property type match: ${property.propertyType}`);
  }

  if (params.bhk && property.bhk === params.bhk) {
    score += 15;
    matchReasons.push(`BHK match: ${property.bhk}`);
  }

  if (params.minBudget !== undefined && params.maxBudget !== undefined) {
    if (property.price >= params.minBudget && property.price <= params.maxBudget) {
      score += 10;
      matchReasons.push(`Budget match: ₹${property.price}`);
    } else if (property.price <= params.maxBudget * 1.1) {
      score += 5;
      matchReasons.push(`Near budget: ₹${property.price}`);
    }
  }

  return { property, score, matchReasons };
}

export function findMatchingProperties(
  properties: Property[],
  params: PropertySearchParams,
  limit = 5
): ScoredProperty[] {
  log.info({ params, totalProperties: properties.length }, 'Finding matching properties');

  const scored = properties
    .map((p) => calculatePropertyScore(p, params))
    .filter((sp) => sp.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  log.info({ found: scored.length }, 'Property matching complete');
  return scored;
}

export function recommendProperties(
  properties: Property[],
  params: PropertySearchParams
): ScoredProperty[] {
  return findMatchingProperties(properties, params, 3);
}
