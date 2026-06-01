import type { Request, Response, NextFunction } from 'express';
import { PropertiesService } from './properties.service.js';

const propertiesService = new PropertiesService();

export async function getProperties(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await propertiesService.getProperties(req.query as Record<string, string>);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

export async function getPropertyById(req: Request, res: Response, next: NextFunction) {
  try {
    const property = await propertiesService.getPropertyById(req.params.id);
    res.json({ success: true, data: property });
  } catch (err) { next(err); }
}

export async function createProperty(req: Request, res: Response, next: NextFunction) {
  try {
    const property = await propertiesService.createProperty(req.body as Record<string, unknown>);
    res.status(201).json({ success: true, data: property });
  } catch (err) { next(err); }
}

export async function updateProperty(req: Request, res: Response, next: NextFunction) {
  try {
    const property = await propertiesService.updateProperty(req.params.id, req.body as Record<string, unknown>);
    res.json({ success: true, data: property });
  } catch (err) { next(err); }
}

export async function deleteProperty(req: Request, res: Response, next: NextFunction) {
  try {
    await propertiesService.deleteProperty(req.params.id);
    res.json({ success: true, message: 'Property deleted' });
  } catch (err) { next(err); }
}
