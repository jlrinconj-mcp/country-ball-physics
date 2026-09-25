/**
 * Minimal typed event bus. The simulation emits; HUD, audio, camera, stats and
 * (later) the content pipeline subscribe. Handlers run synchronously inside
 * the fixed step, so they must never feed back into physics.
 */
export type EventMap = Record<string, unknown>;
export type Handler<T> = (payload: T) => void;

export class EventBus<E extends EventMap> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();
  private anyHandlers = new Set<<K extends keyof E>(type: K, payload: E[K]) => void>();

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(type, handler);
  }

  once<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof E>(type: K, handler: Handler<E[K]>): void {
    this.handlers.get(type)?.delete(handler as Handler<never>);
  }

  /** Receive every event (logging, recording, analytics). */
  onAny(handler: <K extends keyof E>(type: K, payload: E[K]) => void): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  hasListeners<K extends keyof E>(type: K): boolean {
    return (this.handlers.get(type)?.size ?? 0) > 0 || this.anyHandlers.size > 0;
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (set) {
      for (const handler of [...set]) (handler as Handler<E[K]>)(payload);
    }
    for (const handler of this.anyHandlers) handler(type, payload);
  }

  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
  }
}
