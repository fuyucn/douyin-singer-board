/** The page a plugin runs in.
 *
 *  The wrapper comes first and defines the two globals a plugin sees:
 *  `app.call(method, params)`, which reaches the app's own primitives, and
 *  `plugin.define({...})`, which answers the app's calls. The plugin's module
 *  follows it. Both directions carry JSON over `window.nsh.postMessage` /
 *  `injectJavaScript`, so a plugin needs no imports and no network. */
export function pluginPage(source: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
(function () {
  var seq = 0;
  var pending = {};
  var listeners = {};
  var asText = function (value) { try { return JSON.stringify(value); } catch (e) { return "null"; } };
  window.__nshPlugin = {
    receive: function (id, text) {
      var msg = JSON.parse(text);
      var answer = function (ok, value) {
        window.nsh.postMessage(JSON.stringify({ id: id, reply: true, ok: ok, result: asText(value), error: ok ? null : (value && typeof value === "object" ? value : String(value)) }));
      };
      var fn = listeners[msg.method];
      if (!fn) { answer(false, "no such method: " + msg.method); return; }
      Promise.resolve().then(function () { return fn(msg.params || {}); }).then(function (r) {
        answer(true, r === undefined ? null : r);
      }, function (e) {
        answer(false, {
          message: String((e && e.message) || e),
          name: String((e && e.name) || "Error"),
          code: (e && e.code) || null,
          deletedOld: !!(e && e.deletedOld),
          deletedId: (e && e.deletedId) || null,
          unknownResult: !!(e && e.unknownResult)
        });
      });
    },
    resolve: function (id, ok, text) {
      var entry = pending[id];
      if (!entry) { return; }
      delete pending[id];
      var value = JSON.parse(text);
      if (ok) { entry.resolve(value); } else { entry.reject(new Error(String(value))); }
    }
  };
  window.app = {
    call: function (method, params) {
      return new Promise(function (resolve, reject) {
        var id = ++seq;
        pending[id] = { resolve: resolve, reject: reject };
        window.nsh.postMessage(JSON.stringify({ id: id, method: method, params: params || {} }));
      });
    }
  };
  window.plugin = {
    define: function (methods) {
      for (var name in methods) { listeners[name] = methods[name]; }
      window.nsh.postMessage(JSON.stringify({ ready: true }));
    }
  };
})();
</script>
<script>
${source}
</script></body></html>`;
}
