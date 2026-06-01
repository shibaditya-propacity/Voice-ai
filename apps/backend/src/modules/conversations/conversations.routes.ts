import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { getConversationsByLeadId } from './conversations.controller.js';

export const conversationsRouter = Router();
conversationsRouter.use(authenticate);
conversationsRouter.get('/:leadId', getConversationsByLeadId);
