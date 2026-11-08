export class EventEmitter {
  private listeners: Record<string, Function[]> = {};
  on(event: string, listener: Function) {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }
  off(event: string, listener: Function) {
    const list = this.listeners[event];
    if (list) this.listeners[event] = list.filter((l) => l !== listener);
    return this;
  }
  once(event: string, listener: Function) {
    const wrapper = (...args: any[]) => {
      this.off(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }
  emit(event: string, ...args: any[]) {
    for (const listener of this.listeners[event] ?? []) listener(...args);
    return true;
  }
  removeAllListeners(event?: string) {
    if (event) delete this.listeners[event];
    else this.listeners = {};
    return this;
  }
}
