import { prisma } from '@property-ai/database';
import { z } from 'zod';
import { AppError } from '../../middlewares/error-handler.js';

const propertySchema = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  area: z.string().min(1),
  bhk: z.string().min(1),
  propertyType: z.enum(['APARTMENT', 'VILLA', 'COMMERCIAL', 'PLOT']),
  price: z.number().positive(),
  description: z.string().min(1),
  amenities: z.array(z.string()).default([]),
});

export class PropertiesService {
  async getProperties(query: Record<string, string>) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.city) where.city = { equals: query.city, mode: 'insensitive' };
    if (query.propertyType) where.propertyType = query.propertyType;
    if (query.bhk) where.bhk = query.bhk;
    if (query.minPrice || query.maxPrice) {
      where.price = {
        ...(query.minPrice ? { gte: Number(query.minPrice) } : {}),
        ...(query.maxPrice ? { lte: Number(query.maxPrice) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      prisma.property.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.property.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async getPropertyById(id: string) {
    const property = await prisma.property.findUnique({ where: { id } });
    if (!property) throw new AppError(404, 'Property not found');
    return property;
  }

  async createProperty(body: unknown) {
    const data = propertySchema.parse(body);
    return prisma.property.create({ data });
  }

  async updateProperty(id: string, body: unknown) {
    const data = propertySchema.partial().parse(body);
    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Property not found');
    return prisma.property.update({ where: { id }, data });
  }

  async deleteProperty(id: string) {
    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Property not found');
    await prisma.property.delete({ where: { id } });
  }
}
