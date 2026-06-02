/**
 * tool-router.ts — Parallel tool execution with retries and circuit breaking.
 *
 * The Tool Router is the only component that executes tools.
 * Claude (Planner) says WHAT to run. The Router RUNS it.
 * Claude never waits for tool results — that's the Router's job.
 *
 * Features:
 *   - Parallel execution of multiple tools
 *   - Per-tool circuit breakers (open circuit = instant fallback, no timeout)
 *   - Configurable retries with exponential backoff
 *   - Timeout enforcement
 *   - Structured logging of all tool executions
 */

import { createChildLogger } from '@property-ai/logger';
import { CircuitBreaker } from './circuit-breaker.js';
import { getToolRegistry } from './tool-registry.js';
import type { ToolResult, ToolContext } from './tool-registry.js';

const log = createChildLogger({ module: 'tool-router' });

export interface ToolExecutionResult {
  toolName: string;
  requestId: string;
  result: ToolResult;
  durationMs: number;
  retries: number;
  fromFallback: boolean;
}

interface ToolExecution {
  toolName: string;
  parameters: Record<string, unknown>;
  requestId: string;
}

// One circuit breaker per tool — persists across calls
const circuitBreakers = new Map<string, CircuitBreaker>();

function getCircuitBreaker(toolName: string): CircuitBreaker {
  if (!circuitBreakers.has(toolName)) {
    circuitBreakers.set(toolName, new CircuitBreaker(toolName, {
      failureThreshold: 3,
      cooldownMs: 60_000,   // 1 minute cooldown
      timeoutMs: 6_000,     // 6s per tool call
    }));
  }
  return circuitBreakers.get(toolName)!;
}

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 200;

async function executeWithRetry(
  toolName: string,
  parameters: Record<string, unknown>,
  context: ToolContext,
  requestId: string
): Promise<{ result: ToolResult; retries: number; fromFallback: boolean }> {
  const registry = await getToolRegistry();
  const worker = registry.get(toolName);

  if (!worker) {
    log.warn({ toolName, requestId }, 'Tool not found in registry');
    return {
      result: {
        success: false,
        errorCode: 'TOOL_NOT_FOUND',
        message: `Tool ${toolName} is not available.`,
      },
      retries: 0,
      fromFallback: true,
    };
  }

  const breaker = getCircuitBreaker(toolName);
  let lastError: Error | null = null;

  // If circuit is open, skip to fallback immediately
  if (breaker.currentState === 'OPEN') {
    log.warn({ toolName, requestId }, 'Circuit open — using fallback');
    return {
      result: {
        success: false,
        errorCode: 'CIRCUIT_OPEN',
        message: `The ${toolName} service is temporarily unavailable. I'll use the information I have.`,
      },
      retries: 0,
      fromFallback: true,
    };
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await breaker.execute(() => worker(parameters, context));
      return { result, retries: attempt, fromFallback: false };
    } catch (err) {
      lastError = err as Error;
      log.warn({ toolName, requestId, attempt, err: lastError.message }, 'Tool attempt failed');

      if (attempt < MAX_RETRIES) {
        // Exponential backoff: 200ms, 400ms
        await new Promise(r => setTimeout(r, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
      }
    }
  }

  log.error({ toolName, requestId, err: lastError?.message }, 'Tool exhausted retries');
  return {
    result: {
      success: false,
      errorCode: 'TOOL_FAILED',
      message: `I'll note that and have our team follow up with the details.`,
    },
    retries: MAX_RETRIES,
    fromFallback: true,
  };
}

/**
 * Execute one or more tools IN PARALLEL.
 * Returns when all tools complete (or fail).
 * Never throws — always returns results (success or fallback).
 */
export async function executeTools(
  executions: ToolExecution[],
  context: ToolContext
): Promise<ToolExecutionResult[]> {
  if (executions.length === 0) return [];

  log.info({
    tools: executions.map(e => e.toolName),
    callSid: context.callSid,
    correlationId: context.correlationId,
    count: executions.length,
  }, 'Executing tools');

  const results = await Promise.all(
    executions.map(async (execution) => {
      const start = Date.now();

      log.debug({ toolName: execution.toolName, requestId: execution.requestId }, 'Tool starting');

      const { result, retries, fromFallback } = await executeWithRetry(
        execution.toolName,
        execution.parameters,
        context,
        execution.requestId
      );

      const durationMs = Date.now() - start;

      log.info({
        toolName: execution.toolName,
        requestId: execution.requestId,
        success: result.success,
        durationMs,
        retries,
        fromFallback,
      }, 'Tool completed');

      return {
        toolName: execution.toolName,
        requestId: execution.requestId,
        result,
        durationMs,
        retries,
        fromFallback,
      };
    })
  );

  return results;
}

/**
 * Build a tool execution request from planner output.
 */
export function buildToolExecution(
  toolName: string,
  parameters: Record<string, unknown>,
  requestId: string
): ToolExecution {
  return { toolName, parameters, requestId };
}
