import { prisma } from '@property-ai/database';
import { z } from 'zod';
import { AppError } from '../../middlewares/error-handler.js';
import { calculateLeadScore } from '@property-ai/lead-engine';
import type { PropertyType } from '@property-ai/shared';

const createVisitSchema = z.object({
  leadId: z.string(),
  propertyId: z.string(),
  visitDate: z.string().datetime(),
  notes: z.string().optional(),
});

const updateVisitSchema = z.object({
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
  visitDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export class SiteVisitsService {
  async getSiteVisits(query: Record<string, string>) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.leadId) where.leadId = query.leadId;
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      prisma.siteVisit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { visitDate: 'asc' },
        include: { lead: true, property: true },
      }),
      prisma.siteVisit.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async createSiteVisit(body: unknown) {
    const data = createVisitSchema.parse(body);

    const [lead, property] = await Promise.all([
      prisma.lead.findUnique({ where: { id: data.leadId } }),
      prisma.property.findUnique({ where: { id: data.propertyId } }),
    ]);
    if (!lead) throw new AppError(404, 'Lead not found');
    if (!property) throw new AppError(404, 'Property not found');

    const visit = await prisma.siteVisit.create({
      data: { ...data, visitDate: new Date(data.visitDate) },
      include: { lead: true, property: true },
    });

    // Recalculate lead score now that a site visit exists
    const score = calculateLeadScore(lead as { propertyType?: PropertyType }, true).total;
    await prisma.lead.update({ where: { id: data.leadId }, data: { leadScore: score } });

    return visit;
  }

  async updateSiteVisit(id: string, body: unknown) {
    const data = updateVisitSchema.parse(body);
    const existing = await prisma.siteVisit.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Site visit not found');

    return prisma.siteVisit.update({
      where: { id },
      data: { ...data, ...(data.visitDate ? { visitDate: new Date(data.visitDate) } : {}) },
      include: { lead: true, property: true },
    });
  }
}
