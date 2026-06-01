import type { Request, Response, NextFunction } from 'express';
import { LeadsService } from './leads.service.js';

const leadsService = new LeadsService();

export async function getLeads(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await leadsService.getLeads(req.query as Record<string, string>);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

export async function getLeadById(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await leadsService.getLeadById(req.params.id);
    res.json({ success: true, data: lead });
  } catch (err) { next(err); }
}

export async function createLead(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await leadsService.createLead(req.body as Record<string, unknown>);
    res.status(201).json({ success: true, data: lead });
  } catch (err) { next(err); }
}

export async function updateLead(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await leadsService.updateLead(req.params.id, req.body as Record<string, unknown>);
    res.json({ success: true, data: lead });
  } catch (err) { next(err); }
}

export async function deleteLead(req: Request, res: Response, next: NextFunction) {
  try {
    await leadsService.deleteLead(req.params.id);
    res.json({ success: true, message: 'Lead deleted' });
  } catch (err) { next(err); }
}
