import type { Request, Response, NextFunction } from 'express';
import { ConversationsService } from './conversations.service.js';

const conversationsService = new ConversationsService();

export async function getConversationsByLeadId(req: Request, res: Response, next: NextFunction) {
  try {
    const conversations = await conversationsService.getConversationsByLeadId(req.params.leadId);
    res.json({ success: true, data: conversations });
  } catch (err) { next(err); }
}
