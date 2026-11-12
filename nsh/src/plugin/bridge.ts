/** One plugin page's channel to the app.
 *
 *  Both sides call the other with an id and answer with it:
 *    plugin → app   `window.nsh.postMessage({id, method, params})` and the app
 *                   answers with `injectJavaScript("…resolve(id, ok, text)")`
 *    app → plugin   `injectJavaScript("…receive(id, text)")` and the plugin
 *                   answers with `postMessage({id, reply: true, …})`
 *  Every payload crosses as a JSON *string*, so a `null`, a number or a string
 *  result needs no quoting rules and a page cannot inject script text. */
export type HostPrimitive = (params: any) => Promise<any>;

export class PluginChannel {
  private view: any = null;
  /** Declared before `readySignal`: the initializer assigns it, and a later
   *  field definition would reset it to undefined. */
  private markReady!: () => void;
  /** Resolved by the page's `ready` message (not by a timer: a manual-clock
   *  test must not race the page's real load). */
  private readySignal = new Promise<void>((resolve) => { this.markReady = resolve; });
  private pageReady = false;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: number }>();

  constructor(
    private readonly id: string,
    private readonly primitives: Record<string, HostPrimitive>,
    private readonly log: (line: string) => void,
  ) {}

  /** The web view's ref, once it is mounted. */
  attach(view: any): void {
    if (this.view !== view) {
      // A re-enabled plugin mounts a new page; its readiness has to be waited
      // for again, and calls that were in flight on the old page are gone.
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("插件页面已重新加载"));
      }
      this.pending.clear();
      this.pageReady = false;
      this.readySignal = new Promise<void>((resolve) => { this.markReady = resolve; });
    }
    this.view = view;
  }

  /** Whether the app may call the plugin yet: the view is mounted *and* the
   *  page said its methods are registered. */
  get ready(): boolean {
    return this.view != null && this.pageReady;
  }

  /** Resolves once the page is ready; rejects when `ms` of real time passed
   *  (a page that failed to load never posts it). */
  waitForReady(ms: number): Promise<void> {
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("插件页面未就绪")), ms));
    return Promise.race([this.readySignal, timeout]);
  }

  /** The page's `window.nsh.postMessage`: its ready note, its calls, and its replies. */
  onPageMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg?.ready) {
      this.pageReady = true;
      this.markReady();
      return;
    }
    if (typeof msg?.id !== "number") return;
    if (msg.reply) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) {
        entry.resolve(JSON.parse(String(msg.result)));
        return;
      }
      const raw = msg.error ?? "插件调用失败";
      const fields = typeof raw === "object" ? raw : (() => {
        try { return JSON.parse(String(raw)); } catch { return { message: String(raw) }; }
      })();
      const error: any = new Error(String(fields.message ?? raw));
      if (fields.code) error.code = fields.code;
      if (fields.deletedOld) error.deletedOld = true;
      if (fields.deletedId) error.deletedId = fields.deletedId;
      if (fields.deletedIds) error.deletedIds = fields.deletedIds;
      if (fields.refused) error.refused = true;
      if (fields.unknownResult) error.unknownResult = true;
      entry.reject(error);
      return;
    }
    const method = String(msg.method ?? "");
    const handler = this.primitives[method];
    const result = handler
      ? handler(msg.params ?? {})
      : Promise.reject(new Error(`插件用了未开放的接口: ${method}`));
    Promise.resolve(result).then(
      (value) => this.answer(msg.id, true, value),
      (e: any) => {
        this.log(`插件 ${this.id} 调用 ${method} 失败: ${String(e?.message ?? e)}`);
        this.answer(msg.id, false, String(e?.message ?? e));
      },
    );
  }

  /** Calls a method the plugin registered. Rejects when the page is not up,
   *  does not know the method, or takes too long. */
  invoke(method: string, params: any = {}, timeoutMs = 8000): Promise<any> {
    if (!this.view) return Promise.reject(new Error("插件尚未加载"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error: any = new Error(`插件超时（${method}）`);
        // The call may still finish inside the page; a write that timed out is
        // an unknown outcome, not a failure the app may undo.
        error.timeout = true;
        reject(error);
      }, timeoutMs) as unknown as number;
      this.pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify(JSON.stringify({ method, params }));
      this.view.injectJavaScript(`window.__nshPlugin.receive(${id}, ${payload})`);
    });
  }

  private answer(id: number, ok: boolean, value: any): void {
    const payload = JSON.stringify(JSON.stringify(value ?? null));
    this.view?.injectJavaScript(`window.__nshPlugin.resolve(${id}, ${ok}, ${payload})`);
  }
}
