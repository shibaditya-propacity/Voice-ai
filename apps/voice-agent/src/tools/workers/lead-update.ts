/**
 * workers/lead-update.ts — Lead information update tool.
 *
 * Updates lead record when Claude extracts new information from conversation.
 * Runs async after the conversation turn — does not block the response.
 */

import { prisma } from '@property-ai/database';
import { calculateLeadScore } from '@property-ai/lead-engine';
import { createChildLogger } from '@property-ai/logger';
import type { ToolWorker } from '../tool-registry.js';

const log = createChildLogger({ module: 'tool:lead-update' });

export const updateLeadInfo: ToolWorker = async (parameters, context) => {
  log.info({ parameters, callSid: context.callSid }, 'Updating lead info');

  try {
    const {
      name, budget, bhk, area, loan_required, timeline,
    } = parameters as {
      name?: string;
      budget?: string;
      bhk?: string;
      area?: string;
      loan_required?: string;
      timeline?: string;
    };

    const leadId = context.leadId;
    if (!leadId) {
      return {
        success: false,
        errorCode: 'NO_LEAD_ID',
        message: 'Lead not found in system.',
      };
    }

    const updateData: Record<string, unknown> = {};
    if (name) updateData['name'] = name;
    if (budget) updateData['budget'] = budget;
    if (bhk) updateData['bhk'] = bhk;
    if (area) updateData['area'] = area;
    if (loan_required) updateData['loanRequired'] = loan_required.toLowerCase() === 'yes';
    if (timeline) updateData['timeline'] = timeline;

    if (Object.keys(updateData).length === 0) {
      return { success: true, message: 'No new information to update.' };
    }

    // Recalculate score with new data
    const existingLead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (existingLead) {
      const merged = { ...existingLead, ...updateData };
      const score = calculateLeadScore(merged as Parameters<typeof calculateLeadScore>[0]).total;
      updateData['leadScore'] = score;
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: updateData,
    });

    // Keep session state in sync
    context.state.leadData = {
      ...context.state.leadData,
      name: (name ?? context.state.leadData.name) as string | undefined,
      budget: budget ?? context.state.leadData.budget,
      bhk: bhk ?? context.state.leadData.bhk,
      area: area ?? context.state.leadData.area,
      loanRequired: loan_required ? loan_required.toLowerCase() === 'yes' : context.state.leadData.loanRequired,
      timeline: timeline ?? context.state.leadData.timeline,
    };

    log.info({ leadId, fields: Object.keys(updateData) }, 'Lead updated');

    return {
      success: true,
      data: updateData,
      message: `Customer information updated successfully.`,
    };

  } catch (err) {
    log.error({ err, callSid: context.callSid }, 'Lead update failed');
    return {
      success: false,
      errorCode: 'DB_ERROR',
      message: 'Could not update customer record at this time.',
    };
  }
};
