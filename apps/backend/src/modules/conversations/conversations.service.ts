import { prisma } from '@property-ai/database';
import { AppError } from '../../middlewares/error-handler.js';

export class ConversationsService {
  async getConversationsByLeadId(leadId: string) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new AppError(404, 'Lead not found');
    return prisma.conversation.findMany({
      where: { leadId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
