/**
 * @deprecated — Superseded by the streaming architecture in v2.
 *
 * The VoiceService was the HTTP-webhook pipeline handler.
 * In v2, this logic is distributed across:
 *   - ConversationOrchestrator (orchestrator/conversation-orchestrator.ts)
 *   - PlannerAgent (agents/planner-agent.ts)
 *   - ResponseAgent (agents/response-agent.ts)
 *   - ToolWorkers (tools/workers/)
 *
 * Kept for reference only — not imported or used.
 */
export {};
