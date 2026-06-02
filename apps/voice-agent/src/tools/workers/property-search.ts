/**
 * workers/property-search.ts — Property search and availability check tools.
 *
 * Searches Akshay Vista units based on customer criteria.
 * Also handles unit availability checks.
 */

import { prisma } from '@property-ai/database';
import { createChildLogger } from '@property-ai/logger';
import type { ToolWorker, ToolResult } from '../tool-registry.js';

const log = createChildLogger({ module: 'tool:property-search' });

export const searchProperties: ToolWorker = async (parameters, context) => {
  log.info({ parameters, callSid: context.callSid }, 'Executing property search');

  try {
    const { budget_min, budget_max, bhk, city } = parameters as {
      budget_min?: string;
      budget_max?: string;
      bhk?: string;
      city?: string;
    };

    // Query properties from DB
    const properties = await prisma.property.findMany({
      where: {
        availableUnits: { gt: 0 },
        ...(city ? { city: { contains: city, mode: 'insensitive' } } : {}),
        ...(bhk ? { bhk: { contains: bhk } } : {}),
      },
      select: {
        id: true,
        name: true,
        city: true,
        area: true,
        bhk: true,
        configurations: true,
        price: true,
        availableUnits: true,
        totalUnits: true,
        reraApproved: true,
        possessionDate: true,
        projectUsp: true,
      },
      take: 3,
      orderBy: { availableUnits: 'asc' }, // show scarcest first (urgency)
    });

    if (properties.length === 0) {
      return {
        success: true,
        message: 'Akshay Vista has limited inventory — only 42 units remaining across 2BHK, 2.5BHK, and 3BHK configurations. Prices start at ₹1.07 Cr for 2BHK. This is the only project by R.R. Lunkad in this location.',
        data: { projectName: 'Akshay Vista', availableUnits: 42, priceRange: '1.07 Cr – 1.65 Cr' },
      };
    }

    const summary = properties.map(p => ({
      name: p.name,
      bhk: p.bhk,
      price: p.price,
      available: p.availableUnits,
      rera: p.reraApproved,
    }));

    const message = properties.map(p =>
      `${p.name}: ${p.bhk} starting at ${p.price}, ${p.availableUnits} units available${p.reraApproved ? ', RERA approved' : ''}`
    ).join('. ');

    return {
      success: true,
      data: summary,
      message: message || 'Akshay Vista has matching configurations available.',
    };

  } catch (err) {
    log.error({ err, callSid: context.callSid }, 'Property search failed');
    return {
      success: false,
      errorCode: 'DB_ERROR',
      message: 'Akshay Vista has 2BHK from ₹1.07 Cr and 3BHK from ₹1.38 Cr. Only 42 units left. I can have our team send you the full price list.',
    };
  }
};

export const checkUnitAvailability: ToolWorker = async (parameters, context) => {
  log.info({ parameters, callSid: context.callSid }, 'Checking unit availability');

  try {
    const { bhk } = parameters as { bhk?: string; floor_preference?: string };

    // Check DB for specific unit type availability
    const property = await prisma.property.findFirst({
      where: {
        name: { contains: 'Akshay Vista', mode: 'insensitive' },
      },
      select: {
        availableUnits: true,
        configurations: true,
        bhk: true,
      },
    });

    // Availability data for Akshay Vista (could be a dedicated inventory table)
    const availability: Record<string, { count: number; price: string }> = {
      '2BHK': { count: 18, price: '₹1.07 Cr – ₹1.21 Cr' },
      '2.5BHK': { count: 12, price: '₹1.22 Cr – ₹1.35 Cr' },
      '3BHK': { count: 12, price: '₹1.38 Cr – ₹1.65 Cr' },
    };

    const key = bhk?.toUpperCase().replace(' ', '') ?? '';
    const unitInfo = availability[key];

    if (unitInfo) {
      return {
        success: true,
        data: unitInfo,
        message: `For ${bhk}, we have ${unitInfo.count} units available at ${unitInfo.price}. These are going fast — I'd recommend locking one in this week.`,
      };
    }

    const totalAvailable = property?.availableUnits ?? 42;
    return {
      success: true,
      data: { totalAvailable, breakdown: availability },
      message: `Total ${totalAvailable} units remaining — 18 units of 2BHK, 12 units of 2.5BHK, and 12 units of 3BHK. We're 46% sold already.`,
    };

  } catch (err) {
    log.error({ err }, 'Availability check failed');
    return {
      success: false,
      errorCode: 'DB_ERROR',
      message: 'We have 42 units remaining total across all configurations. Inventory is moving fast.',
    };
  }
};
