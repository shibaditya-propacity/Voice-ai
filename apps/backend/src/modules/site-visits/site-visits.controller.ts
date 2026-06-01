import type { Request, Response, NextFunction } from 'express';
import { SiteVisitsService } from './site-visits.service.js';

const siteVisitsService = new SiteVisitsService();

export async function getSiteVisits(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await siteVisitsService.getSiteVisits(req.query as Record<string, string>);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

export async function createSiteVisit(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await siteVisitsService.createSiteVisit(req.body as Record<string, unknown>);
    res.status(201).json({ success: true, data: visit });
  } catch (err) { next(err); }
}

export async function updateSiteVisit(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await siteVisitsService.updateSiteVisit(req.params.id, req.body as Record<string, unknown>);
    res.json({ success: true, data: visit });
  } catch (err) { next(err); }
}
