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
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: number }>();

  constructor(
    private readonly id: string,
    private readonly primitives: Record<string, HostPrimitive>,
    private readonly log: (line: string) => void,
  ) {}

  /** The web view's ref, once it is mounted. */
  attach(view: any): void {
    this.view = view;
  }

  /** Whether the app may call the plugin yet. */
  get ready(): boolean {
    return this.view != null;
  }

  /** The page's `window.nsh.postMessage`: its calls, and its replies. */
  onPageMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg?.id !== "number") return;
    if (msg.reply) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) entry.resolve(JSON.parse(String(msg.result)));
      else entry.reject(new Error(String(msg.error ?? "插件调用失败")));
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
        reject(new Error(`插件超时（${method}）`));
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
