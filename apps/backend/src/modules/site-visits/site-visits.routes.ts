import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { getSiteVisits, createSiteVisit, updateSiteVisit } from './site-visits.controller.js';

export const siteVisitsRouter = Router();
siteVisitsRouter.use(authenticate);
siteVisitsRouter.get('/', getSiteVisits);
siteVisitsRouter.post('/', createSiteVisit);
siteVisitsRouter.patch('/:id', updateSiteVisit);
