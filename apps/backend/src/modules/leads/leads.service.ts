import { prisma } from '@property-ai/database';
import { z } from 'zod';
import { calculateLeadScore } from '@property-ai/lead-engine';
import { AppError } from '../../middlewares/error-handler.js';
import type { PropertyType } from '@property-ai/shared';

const createLeadSchema = z.object({
  phone: z.string().min(10),
  name: z.string().optional(),
  email: z.string().email().optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  budget: z.string().optional(),
  bhk: z.string().optional(),
  propertyType: z.enum(['APARTMENT', 'VILLA', 'COMMERCIAL', 'PLOT']).optional(),
  loanRequired: z.boolean().optional(),
  timeline: z.string().optional(),
  notes: z.string().optional(),
});

const updateLeadSchema = createLeadSchema.partial().omit({ phone: true });

export class LeadsService {
  async getLeads(query: Record<string, string>) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
        { city: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.city) where.city = { equals: query.city, mode: 'insensitive' };
    if (query.propertyType) where.propertyType = query.propertyType;

    const [data, total] = await Promise.all([
      prisma.lead.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.lead.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getLeadById(id: string) {
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: { conversations: { orderBy: { createdAt: 'asc' } }, siteVisits: true, callLogs: true },
    });
    if (!lead) throw new AppError(404, 'Lead not found');
    return lead;
  }

  async createLead(body: unknown) {
    const data = createLeadSchema.parse(body);
    const score = calculateLeadScore(data).total;
    return prisma.lead.create({ data: { ...data, leadScore: score } });
  }

  async updateLead(id: string, body: unknown) {
    const data = updateLeadSchema.parse(body);
    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Lead not found');

    const hasSiteVisit = (await prisma.siteVisit.count({ where: { leadId: id } })) > 0;
    const score = calculateLeadScore({ ...existing, ...data } as { propertyType?: PropertyType }, hasSiteVisit).total;

    return prisma.lead.update({ where: { id }, data: { ...data, leadScore: score } });
  }

  async deleteLead(id: string) {
    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Lead not found');
    await prisma.lead.delete({ where: { id } });
  }
}
