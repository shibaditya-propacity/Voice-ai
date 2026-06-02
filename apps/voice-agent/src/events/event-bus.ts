/**
 * event-bus.ts — Typed in-process event bus for the voice pipeline.
 *
 * Built on Node.js EventEmitter but enforces type safety across all events.
 * Each call gets its own scoped bus so events from different calls never mix.
 *
 * Usage:
 *   const bus = new VoiceEventBus();
 *   bus.on(VoiceEvents.FINAL_TRANSCRIPT, (payload) => { ... });
 *   bus.emit(VoiceEvents.FINAL_TRANSCRIPT, { ... });
 */

import { EventEmitter } from 'events';
import type { VoiceEventMap, VoiceEventName } from './events.js';
import { createChildLogger } from '@property-ai/logger';

const log = createChildLogger({ module: 'event-bus' });

export class VoiceEventBus extends EventEmitter {
  private readonly callSid: string;
  /** Track listener counts for observability */
  private readonly listenerRegistry = new Map<VoiceEventName, number>();

  constructor(callSid: string) {
    super();
    this.callSid = callSid;
    // Increase default max listeners — we have many subscribers per event
    this.setMaxListeners(50);
  }

  /**
   * Strongly-typed emit. TypeScript ensures payload matches the event name.
   */
  emit<K extends VoiceEventName>(event: K, payload: VoiceEventMap[K]): boolean {
    return super.emit(event, payload);
  }

  /**
   * Strongly-typed on. Callback receives the correct payload type.
   */
  on<K extends VoiceEventName>(
    event: K,
    listener: (payload: VoiceEventMap[K]) => void
  ): this {
    const count = (this.listenerRegistry.get(event) ?? 0) + 1;
    this.listenerRegistry.set(event, count);
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * One-time subscription.
   */
  once<K extends VoiceEventName>(
    event: K,
    listener: (payload: VoiceEventMap[K]) => void
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Remove a specific listener.
   */
  off<K extends VoiceEventName>(
    event: K,
    listener: (payload: VoiceEventMap[K]) => void
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Cleanly destroy the bus — remove all listeners to prevent memory leaks.
   */
  destroy(): void {
    log.debug({ callSid: this.callSid, events: this.listenerRegistry.size }, 'Destroying event bus');
    this.removeAllListeners();
    this.listenerRegistry.clear();
  }
}

/**
 * Global registry of per-call event buses.
 * The AudioGateway creates a bus when a call starts and the orchestrator
 * and all services subscribe to it. Buses are destroyed when calls end.
 */
class EventBusRegistry {
  private readonly buses = new Map<string, VoiceEventBus>();

  create(callSid: string): VoiceEventBus {
    if (this.buses.has(callSid)) {
      log.warn({ callSid }, 'Event bus already exists for call — reusing');
      return this.buses.get(callSid)!;
    }
    const bus = new VoiceEventBus(callSid);
    this.buses.set(callSid, bus);
    log.debug({ callSid }, 'Event bus created');
    return bus;
  }

  get(callSid: string): VoiceEventBus | undefined {
    return this.buses.get(callSid);
  }

  destroy(callSid: string): void {
    const bus = this.buses.get(callSid);
    if (bus) {
      bus.destroy();
      this.buses.delete(callSid);
      log.debug({ callSid }, 'Event bus destroyed');
    }
  }

  activeCallCount(): number {
    return this.buses.size;
  }
}

// Singleton registry — the single source of truth for all active call buses
export const eventBusRegistry = new EventBusRegistry();
