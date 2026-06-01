import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { initiateOutboundCall } from './calls.controller.js';

export const callsRouter = Router();
callsRouter.use(authenticate);
callsRouter.post('/outbound', initiateOutboundCall);
