import { z } from 'zod';
import { prisma } from '@property-ai/database';
import { makeOutboundCall } from '@property-ai/twilio';
import { AppError } from '../../middlewares/error-handler.js';
import { logger } from '@property-ai/logger';

const outboundCallSchema = z.object({
  phone: z.string().min(10),
  leadId: z.string().optional(),
});

export class CallsService {
  async initiateOutboundCall(body: unknown) {
    const { phone, leadId } = outboundCallSchema.parse(body);

    const voiceAgentUrl = process.env.VOICE_AGENT_URL;
    if (!voiceAgentUrl) throw new AppError(500, 'Voice agent URL not configured');

    const webhookUrl = `${voiceAgentUrl}/voice/outbound`;
    const callSid = await makeOutboundCall({ to: phone, webhookUrl });

    const callLog = await prisma.callLog.create({
      data: {
        callSid,
        leadId: leadId ?? null,
        direction: 'outbound',
        to: phone,
        from: process.env.TWILIO_PHONE_NUMBER,
      },
    });

    logger.info({ callSid, phone, leadId }, 'Outbound call initiated');
    return { callSid, callLogId: callLog.id };
  }
}
