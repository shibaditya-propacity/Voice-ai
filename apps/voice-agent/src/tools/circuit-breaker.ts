/**
 * circuit-breaker.ts — Circuit breaker for tool execution.
 *
 * Prevents cascading failures when external services (DB, APIs) are degraded.
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing recovery)
 *
 * When a tool's circuit is OPEN:
 *   - Calls fail immediately with a fallback response
 *   - No request is sent to the failing service
 *   - The agent gets a fast "service unavailable" rather than a timeout
 */

import { createChildLogger } from '@property-ai/logger';

const log = createChildLogger({ module: 'circuit-breaker' });

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit. Default: 3 */
  failureThreshold: number;
  /** Time in ms to keep circuit OPEN before trying HALF_OPEN. Default: 30000 */
  cooldownMs: number;
  /** Number of successes in HALF_OPEN before closing. Default: 2 */
  successThreshold: number;
  /** Timeout for individual calls in ms. Default: 5000 */
  timeoutMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 30_000,
  successThreshold: 2,
  timeoutMs: 5_000,
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureAt = 0;
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws immediately if circuit is OPEN.
   * Wraps the call with a timeout.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkState();

    if (this.state === 'OPEN') {
      const err = new Error(`Circuit OPEN for ${this.name} — service unavailable`);
      log.warn({ tool: this.name, state: this.state }, 'Circuit breaker rejected call');
      throw err;
    }

    try {
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err as Error);
      throw err;
    }
  }

  private checkState(): void {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureAt;
      if (elapsed >= this.config.cooldownMs) {
        log.info({ tool: this.name }, 'Circuit entering HALF_OPEN state');
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      }
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        log.info({ tool: this.name }, 'Circuit CLOSED — service recovered');
        this.state = 'CLOSED';
      }
    }
  }

  private onFailure(err: Error): void {
    this.failureCount++;
    this.lastFailureAt = Date.now();

    log.warn({ tool: this.name, failures: this.failureCount, err: err.message }, 'Circuit breaker failure');

    if (
      this.state === 'CLOSED' && this.failureCount >= this.config.failureThreshold ||
      this.state === 'HALF_OPEN'
    ) {
      log.error({ tool: this.name }, 'Circuit OPEN — too many failures');
      this.state = 'OPEN';
    }
  }

  private withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool ${this.name} timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      fn().then(
        (result) => { clearTimeout(timer); resolve(result); },
        (err)    => { clearTimeout(timer); reject(err); }
      );
    });
  }

  get currentState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
  }
}
