import { Router } from 'express';
import {
  handleIncomingCall,
  handleGather,
  handleOutboundCall,
  handleCallStatus,
} from './voice.controller.js';

export const voiceRouter = Router();

voiceRouter.post('/incoming', handleIncomingCall);
voiceRouter.post('/gather', handleGather);
voiceRouter.post('/outbound', handleOutboundCall);
voiceRouter.post('/status', handleCallStatus);
