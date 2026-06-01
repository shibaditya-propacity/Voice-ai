import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import {
  getLeads,
  getLeadById,
  createLead,
  updateLead,
  deleteLead,
} from './leads.controller.js';

export const leadsRouter = Router();

leadsRouter.use(authenticate);
leadsRouter.get('/', getLeads);
leadsRouter.get('/:id', getLeadById);
leadsRouter.post('/', createLead);
leadsRouter.patch('/:id', updateLead);
leadsRouter.delete('/:id', deleteLead);
