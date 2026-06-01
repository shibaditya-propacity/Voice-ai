import type { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service.js';

const authService = new AuthService();

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.login(req.body as { email: string; password: string });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response) {
  res.json({ success: true, data: req.user });
}
