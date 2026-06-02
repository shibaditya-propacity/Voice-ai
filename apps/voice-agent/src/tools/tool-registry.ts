/**
 * tool-registry.ts — Centralized tool definitions and worker registry.
 *
 * This is the ONLY place where tools are defined. The Planner Agent
 * receives these definitions and decides which tool to call. The Tool
 * Router reads this registry to find the worker function to execute.
 *
 * Adding a new tool:
 *   1. Create the worker in tools/workers/
 *   2. Register it here
 *   3. Done — Planner and Router automatically pick it up
 */

import type { LlmToolDefinition } from '../providers/llm/provider.js';
import type { ConversationState } from '../session/session-store.js';

// ─── Tool execution context ────────────────────────────────────────────────

export interface ToolContext {
  callSid: string;
  correlationId: string;
  leadId?: string;
  phoneNumber: string;
  state: ConversationState;
}

// ─── Tool worker signature ─────────────────────────────────────────────────

export type ToolWorker = (
  parameters: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

export interface ToolResult {
  success: boolean;
  data?: unknown;
  /** Human-readable message for the Response Agent to use */
  message: string;
  /** Machine-readable error code if success=false */
  errorCode?: string;
}

// ─── Tool definitions (sent to Claude as context) ─────────────────────────

export const TOOL_DEFINITIONS: LlmToolDefinition[] = [
  {
    name: 'search_properties',
    description: 'Search for available properties matching the customer\'s requirements (budget, BHK, location). Call this when the customer asks about available units, pricing, or wants property recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        budget_min: { type: 'string', description: 'Minimum budget in lakhs (e.g. "100" for ₹1 Cr)' },
        budget_max: { type: 'string', description: 'Maximum budget in lakhs' },
        bhk: { type: 'string', description: 'BHK requirement (2, 2.5, or 3)' },
        city: { type: 'string', description: 'Preferred city' },
      },
      required: [],
    },
  },
  {
    name: 'book_site_visit',
    description: 'Book a site visit for the customer at Akshay Vista. Call this when the customer agrees to visit the property. Requires a date/time preference.',
    inputSchema: {
      type: 'object',
      properties: {
        preferred_date: { type: 'string', description: 'Preferred visit date (e.g. "tomorrow", "Saturday", "2024-12-15")' },
        preferred_time: { type: 'string', description: 'Preferred time slot (morning/afternoon/evening or specific time)' },
        customer_name: { type: 'string', description: 'Customer name for the booking' },
      },
      required: ['preferred_date'],
    },
  },
  {
    name: 'update_lead_info',
    description: 'Update the customer lead record with newly collected information. Call when you learn the customer\'s name, budget, BHK requirement, loan status, or timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Customer full name' },
        budget: { type: 'string', description: 'Budget range (e.g. "1.2 Cr", "80 lakh")' },
        bhk: { type: 'string', description: 'BHK requirement (2, 2.5, 3)' },
        area: { type: 'string', description: 'Preferred area in the city' },
        loan_required: { type: 'string', description: 'Whether customer needs home loan (yes/no)' },
        timeline: { type: 'string', description: 'When they want to buy (immediate, 3 months, 6 months, 1 year)' },
      },
      required: [],
    },
  },
  {
    name: 'check_unit_availability',
    description: 'Check real-time availability of specific unit configurations at Akshay Vista. Use when customer asks about specific unit types or if we have units available.',
    inputSchema: {
      type: 'object',
      properties: {
        bhk: { type: 'string', description: 'Unit type to check (2BHK, 2.5BHK, 3BHK)' },
        floor_preference: { type: 'string', description: 'Floor preference (low/mid/high or specific floor number)', },
      },
      required: [],
    },
  },
];

// ─── Tool registry map ────────────────────────────────────────────────────

type ToolRegistry = Map<string, ToolWorker>;

let _registry: ToolRegistry | null = null;

export async function getToolRegistry(): Promise<ToolRegistry> {
  if (_registry) return _registry;

  // Lazy import workers to avoid circular deps and allow testing individual workers
  const [
    propertySearch,
    { bookSiteVisit },
    { updateLeadInfo },
  ] = await Promise.all([
    import('./workers/property-search.js'),
    import('./workers/site-visit.js'),
    import('./workers/lead-update.js'),
  ]);

  const { searchProperties, checkUnitAvailability } = propertySearch;

  _registry = new Map<string, ToolWorker>([
    ['search_properties', searchProperties],
    ['book_site_visit', bookSiteVisit],
    ['update_lead_info', updateLeadInfo],
    ['check_unit_availability', checkUnitAvailability],
  ]);

  return _registry;
}
