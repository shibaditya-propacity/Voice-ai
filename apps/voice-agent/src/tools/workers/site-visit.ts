/**
 * workers/site-visit.ts — Site visit booking tool.
 *
 * Books a property site visit when the customer agrees to visit.
 * This is the PRIMARY conversion goal for every call.
 */

import { prisma } from '@property-ai/database';
import { createChildLogger } from '@property-ai/logger';
import type { ToolWorker } from '../tool-registry.js';

const log = createChildLogger({ module: 'tool:site-visit' });

function parseDateHint(hint: string): Date {
  const normalized = hint.toLowerCase().trim();
  const now = new Date();

  if (normalized === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d;
  }

  const dayMap: Record<string, number> = {
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
  };

  for (const [day, num] of Object.entries(dayMap)) {
    if (normalized.includes(day)) {
      const d = new Date(now);
      const diff = (num - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
  }

  // Try parsing as date string
  const parsed = new Date(hint);
  if (!isNaN(parsed.getTime())) return parsed;

  // Default to 3 days from now
  const d = new Date(now);
  d.setDate(d.getDate() + 3);
  return d;
}

export const bookSiteVisit: ToolWorker = async (parameters, context) => {
  log.info({ parameters, callSid: context.callSid }, 'Booking site visit');

  try {
    const { preferred_date, preferred_time, customer_name } = parameters as {
      preferred_date?: string;
      preferred_time?: string;
      customer_name?: string;
    };

    const leadId = context.leadId;
    if (!leadId) {
      return {
        success: false,
        errorCode: 'NO_LEAD_ID',
        message: 'I\'ll note your interest and have our team call you back to confirm the visit time.',
      };
    }

    const visitDate = preferred_date ? parseDateHint(preferred_date) : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    // Find Akshay Vista property
    let property = await prisma.property.findFirst({
      where: { name: { contains: 'Akshay Vista', mode: 'insensitive' } },
      select: { id: true },
    });

    // If property doesn't exist in DB yet, create a placeholder
    if (!property) {
      property = await prisma.property.create({
        data: {
          name: 'Akshay Vista',
          city: 'Pune',
          area: 'Pimple Gurav',
          address: 'Near Swami Samarth Temple, Pimple Gurav, Pune 411061',
          bhk: '2, 2.5, 3 BHK',
          configurations: ['2BHK', '2.5BHK', '3BHK'],
          propertyType: 'APARTMENT',
          price: 10700000, // ₹1.07 Cr in paise/base unit
          description: 'Premium 2 & 3 BHK apartments by R.R. Lunkad in Pimple Gurav, Pune',
          developer: 'R. R. Lunkad',
          totalUnits: 78,
          availableUnits: 42,
          reraApproved: true,
          possessionDate: 'April 2027',
          launchDate: 'January 2024',
        },
      });
    }

    // Create site visit
    await prisma.siteVisit.create({
      data: {
        leadId,
        propertyId: property.id,
        visitDate,
        status: 'SCHEDULED',
        notes: [
          preferred_time ? `Preferred time: ${preferred_time}` : '',
          customer_name ? `Customer: ${customer_name}` : '',
          `Booked via voice agent`,
        ].filter(Boolean).join('. '),
      },
    });

    // Update lead stage
    await prisma.lead.update({
      where: { id: leadId },
      data: { leadScore: { increment: 20 } },
    });

    // Update session state
    context.state.leadData.siteVisitBooked = true;
    context.state.leadData.siteVisitDate = visitDate.toDateString();
    context.state.stage = 'booking_confirmed';

    const dateStr = visitDate.toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long'
    });

    log.info({ leadId, visitDate, callSid: context.callSid }, 'Site visit booked');

    return {
      success: true,
      data: { visitDate: visitDate.toISOString(), propertyId: property.id },
      message: `Site visit booked for ${dateStr}${preferred_time ? ` at ${preferred_time}` : ''}. Our team will call to confirm.`,
    };

  } catch (err) {
    log.error({ err, callSid: context.callSid }, 'Site visit booking failed');
    return {
      success: false,
      errorCode: 'DB_ERROR',
      message: 'I\'ll have our sales team call you back within 2 hours to confirm the site visit booking.',
    };
  }
};
