import type { Lead } from '@property-ai/database';

export const SCORE_WEIGHTS = {
  budget: 20,
  location: 20,
  propertyType: 20,
  timeline: 20,
  siteVisitBooked: 20,
} as const;

export type LeadScoreBreakdown = {
  budget: number;
  location: number;
  propertyType: number;
  timeline: number;
  siteVisitBooked: number;
  total: number;
};

export function calculateLeadScore(
  lead: Partial<Lead>,
  hasSiteVisit: boolean = false
): LeadScoreBreakdown {
  const budget = lead.budget ? SCORE_WEIGHTS.budget : 0;
  const location = lead.city || lead.area ? SCORE_WEIGHTS.location : 0;
  const propertyType = lead.propertyType ? SCORE_WEIGHTS.propertyType : 0;
  const timeline = lead.timeline ? SCORE_WEIGHTS.timeline : 0;
  const siteVisitBooked = hasSiteVisit ? SCORE_WEIGHTS.siteVisitBooked : 0;
  const total = budget + location + propertyType + timeline + siteVisitBooked;
  return { budget, location, propertyType, timeline, siteVisitBooked, total };
}

export function qualifyLead(score: number): 'HOT' | 'WARM' | 'COLD' {
  if (score >= 80) return 'HOT';
  if (score >= 40) return 'WARM';
  return 'COLD';
}
