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
        window.nsh.postMessage(JSON.stringify({ id: id, reply: true, ok: ok, result: asText(value), error: ok ? null : String(value && value.message || value) }));
      };
      var fn = listeners[msg.method];
      if (!fn) { answer(false, "no such method: " + msg.method); return; }
      Promise.resolve().then(function () { return fn(msg.params || {}); }).then(function (r) {
        answer(true, r === undefined ? null : r);
      }, function (e) {
        answer(false, e);
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
    define: function (methods) { for (var name in methods) { listeners[name] = methods[name]; } }
  };
})();
</script>
<script>
${source}
</script></body></html>`;
}
