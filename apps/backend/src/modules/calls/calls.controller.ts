import type { Request, Response, NextFunction } from 'express';
import { CallsService } from './calls.service.js';

const callsService = new CallsService();

export async function initiateOutboundCall(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await callsService.initiateOutboundCall(req.body as Record<string, unknown>);
    res.status(202).json({ success: true, data: result });
  } catch (err) { next(err); }
}
