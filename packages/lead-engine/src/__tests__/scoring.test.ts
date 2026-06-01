import { describe, it, expect } from 'vitest';
import { calculateLeadScore, qualifyLead } from '../scoring.js';

describe('calculateLeadScore', () => {
  it('returns 0 for empty lead', () => {
    const result = calculateLeadScore({});
    expect(result.total).toBe(0);
  });

  it('scores 20 for budget provided', () => {
    const result = calculateLeadScore({ budget: '50L' });
    expect(result.budget).toBe(20);
    expect(result.total).toBe(20);
  });

  it('scores 20 for location (city)', () => {
    const result = calculateLeadScore({ city: 'Mumbai' });
    expect(result.location).toBe(20);
  });

  it('scores 20 for location (area)', () => {
    const result = calculateLeadScore({ area: 'Andheri' });
    expect(result.location).toBe(20);
  });

  it('scores 20 for property type', () => {
    const result = calculateLeadScore({ propertyType: 'APARTMENT' });
    expect(result.propertyType).toBe(20);
  });

  it('scores 20 for timeline', () => {
    const result = calculateLeadScore({ timeline: '3 months' });
    expect(result.timeline).toBe(20);
  });

  it('scores 20 for site visit booked', () => {
    const result = calculateLeadScore({}, true);
    expect(result.siteVisitBooked).toBe(20);
  });

  it('returns 100 for fully qualified lead with site visit', () => {
    const result = calculateLeadScore(
      {
        budget: '1Cr',
        city: 'Pune',
        propertyType: 'APARTMENT',
        timeline: '6 months',
      },
      true
    );
    expect(result.total).toBe(100);
  });
});

describe('qualifyLead', () => {
  it('returns HOT for score >= 80', () => {
    expect(qualifyLead(80)).toBe('HOT');
    expect(qualifyLead(100)).toBe('HOT');
  });

  it('returns WARM for score 40-79', () => {
    expect(qualifyLead(40)).toBe('WARM');
    expect(qualifyLead(60)).toBe('WARM');
  });

  it('returns COLD for score < 40', () => {
    expect(qualifyLead(0)).toBe('COLD');
    expect(qualifyLead(20)).toBe('COLD');
  });
});
