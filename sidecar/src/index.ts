// Tauri ↔ Node sidecar bridge.
//
// stdin: one JSON command per line (SidecarCmd)
// stdout: one JSON event per line (SidecarEvent)
//
// douyin-danma-listener API (lib/index.js + types/types.d.ts):
//   class DouYinDanmaClient extends TypedEmitter
//   constructor(roomId, options?)
//   connect: connect() / disconnect: close()
//   events: 'open' | 'close' | 'error' | 'reconnect' | 'init' | 'chat' | 'message' | ...
//   ChatMessage: { user: { id, nickName, BadgeImageList }, content, eventTime }

import readline from 'node:readline';
import { Matcher } from './matcher.js';
import { SidecarCmdSchema, type Config, type SidecarCmd, type SidecarEvent } from './types.js';

let DouYinDanmaClient: any = null;
let listener: any = null;
let matcher: Matcher | null = null;

function emit(ev: SidecarEvent): void {
  process.stdout.write(JSON.stringify(ev) + '\n');
}

function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string): void {
  emit({ event: 'log', level, msg });
}

// The kugou server and its upstream modules log through console.*. Route those
// lines into the JSON protocol instead of letting them corrupt stdout, and
// redact credentials before they reach the UI log panel.
const redactSensitive = (msg: string): string =>
  msg.replace(/(cookie|token|userid|dfid)=[^&\s]*/gi, '$1=***');

console.log = (...args: unknown[]) => log('info', redactSensitive(args.map(String).join(' ')));
console.warn = (...args: unknown[]) => log('warn', redactSensitive(args.map(String).join(' ')));
console.error = (...args: unknown[]) => log('error', redactSensitive(args.map(String).join(' ')));

// URL short code (web_rid) → real id_str.
// The number in the live URL https://live.douyin.com/{web_rid} is the web_rid,
// but douyin-danma-listener expects the id_str (~20-digit long ID).
// We fetch the live-room HTML and extract id_str via the `roomId":"..."` pattern.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (${url})`);
    return res;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`request timed out after ${FETCH_TIMEOUT_MS / 1000}s (${url})`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function getTtwid(): Promise<string> {
  const res = await fetchWithTimeout('https://live.douyin.com/', {
    method: 'GET',
    headers: { 'User-Agent': UA },
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(/ttwid=([^;,\s]+)/);
  if (!m) throw new Error('no ttwid in response — Douyin may have changed their cookie format');
  return m[1];
}

async function resolveIdStr(input: string): Promise<string> {
  // If it already looks like an id_str (>= 18 digits) use it directly.
  if (/^\d{18,}$/.test(input)) return input;

  log('info', `resolving web_rid ${input} -> id_str ...`);
  const ttwid = await getTtwid();
  const res = await fetchWithTimeout(`https://live.douyin.com/${encodeURIComponent(input)}`, {
    headers: {
      'User-Agent': UA,
      Cookie: `ttwid=${ttwid}; __ac_nonce=0123407cc00a9e438deb4`,
      'Accept-Encoding': 'gzip, deflate',
    },
  });
  const html = await res.text();

  const m = html.match(/roomId\\":\\"(\d+)\\"/);
  if (!m) {
    throw new Error(`room not found or page structure changed for web_rid: ${input} — check that the room ID is correct and the room is live`);
  }
  log('info', `id_str = ${m[1]}`);
  return m[1];
}

async function start(config: Config): Promise<void> {
  if (listener) {
    log('warn', 'already started, ignoring');
    return;
  }
  if (!DouYinDanmaClient) {
    const mod: any = await import('douyin-danma-listener');
    DouYinDanmaClient = mod.default ?? mod;
  }
  matcher = new Matcher(config);

  const idStr = await resolveIdStr(config.room_id.trim());
  // Note: first arg is the roomId string (id_str, not web_rid)
  listener = new DouYinDanmaClient(idStr);

  listener.on('open', () => {
    emit({ event: 'status', connected: true, message: 'Connected' });
    log('info', '✅ ws open');
  });
  listener.on('close', () => {
    emit({ event: 'status', connected: false, message: 'Disconnected' });
    log('warn', 'ws close');
  });
  listener.on('error', (e: Error) => emit({ event: 'error', msg: String(e?.message ?? e) }));
  listener.on('reconnect', (count: number) => log('info', `reconnecting attempt ${count}`));
  listener.on('init', (url: string) => log('info', `ws url: ${url.slice(0, 80)}...`));
  // Diagnostic: log every decoded message's `method` name, including ones the lib drops silently
  // (e.g. WebcastBatchGiftMessage, WebcastInRoomBannerMessage), so we can identify them.
  try {
    const protoMod: any = await import('douyin-danma-listener/lib/proto.js');
    const proto = protoMod.default ?? protoMod;
    const PushFrame = proto.douyin.PushFrame;
    const Response = proto.douyin.Response;
    const { gunzip } = await import('node:zlib');
    const origDecode = listener.decode.bind(listener);
    listener.decode = async function (data: Buffer | Uint8Array) {
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const frame = PushFrame.decode(buf);
        if (frame.payload && frame.payload.length) {
          const decompressed: Buffer = await new Promise((res, rej) =>
            gunzip(Buffer.from(frame.payload), (err, r) => (err ? rej(err) : res(r as Buffer))),
          );
          const resp = Response.decode(decompressed).toJSON();
          const methods = (resp.messagesList ?? [])
            .map((m: any) => m.method)
            .filter(Boolean);
          if (methods.length) log('debug', `[methods] ${methods.join(', ')}`);
        }
      } catch {
        /* swallow; let origDecode handle */
      }
      return origDecode(data);
    };
  } catch (e) {
    log('warn', `decode tap setup failed: ${(e as Error)?.message ?? e}`);
  }

  // chat: { user: { id, nickName, BadgeImageList: [{ content: { level, alternativeText } }] }, content }
  listener.on('chat', (msg: any) => {
    const uid = String(msg?.user?.id ?? '');
    const uname = String(msg?.user?.nickName ?? '');
    const content = String(msg?.content ?? '');
    let medal_level = 0;
    let medal_name = '';
    const badge = msg?.user?.BadgeImageList?.[0];
    if (badge?.content?.level) {
      medal_level = parseInt(badge.content.level, 10) || 0;
      medal_name = String(badge.content.alternativeText ?? '');
    }

    const r = matcher!.match({ uid, uname, content, medal_level, medal_name });
    // One debug line per chat message: "user: content ✅/❌/↩️ reason"
    const medalTag = medal_level > 0 ? `[${medal_name} ${medal_level}] ` : '';
    let summary: string;
    if (r.kind === 'song') {
      summary = `✅ matched (song: ${r.danmu.song_name})`;
      emit({ event: 'danmu', data: r.danmu });
    } else if (r.kind === 'cancel') {
      summary = '↩️ cancel';
      emit({ event: 'cancel', uid: r.uid });
    } else {
      summary = `❌ ${r.reason}`;
    }
    log('debug', `${medalTag}${uname}: ${content} ${summary}`);
  });

  await listener.connect();
  log('info', `connected to room ${config.room_id}`);
}

async function stop(): Promise<void> {
  if (!listener) return;
  try {
    listener.close();
  } catch (e) {
    log('warn', `close error: ${String((e as Error)?.message ?? e)}`);
  }
  listener = null;
  matcher = null;
}

async function kugouStart(port: number): Promise<void> {
  const { startKugouServer } = await import('../../kugou-slim/server.cjs');
  await startKugouServer({ port, host: '127.0.0.1' });
  log('info', `kugou server ready on :${port}`);
}

async function kugouStop(): Promise<void> {
  const { stopKugouServer } = await import('../../kugou-slim/server.cjs');
  await stopKugouServer();
  log('info', 'kugou server stopped');
}

async function handleCmd(cmd: SidecarCmd): Promise<void> {
  try {
    switch (cmd.cmd) {
      case 'start':
        await start(cmd.config);
        break;
      case 'stop':
        await stop();
        break;
      case 'reload_config':
        if (matcher) matcher.reload(cmd.config);
        else log('warn', 'reload_config before start, ignored');
        break;
      case 'kugou_start':
        await kugouStart(cmd.port);
        break;
      case 'kugou_stop':
        await kugouStop();
        break;
    }
  } catch (e) {
    emit({ event: 'error', msg: String((e as Error)?.message ?? e) });
  }
}

// Unified shutdown: best-effort stop the kugou server and the live-room
// listener, then exit. Never blocks on stop() — a hung close() must not keep
// the process alive. Idempotent.
let shuttingDown = false;
function shutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    log('info', `shutting down: ${reason}`);
  } catch {
    /* stdout may be gone if the parent already died */
  }
  void kugouStop().catch(() => {});
  void stop(); // closes the listener synchronously; do not await
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (e) {
    emit({ event: 'error', msg: `invalid JSON cmd: ${(e as Error).message}` });
    return;
  }
  const result = SidecarCmdSchema.safeParse(parsed);
  if (!result.success) {
    emit({ event: 'error', msg: `cmd schema violation: ${result.error.message}` });
    return;
  }
  void handleCmd(result.data);
});

// Primary parent-death signal: when the Tauri parent dies, the stdin pipe's
// write end closes and we get EOF here. Far more reliable than polling ppid
// (which can be cached / defeated by PID reuse on macOS). Covers force-quit
// and crashes where the Rust-side cleanup never runs.
rl.on('close', () => shutdown('stdin closed (parent gone)'));

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Survive late events from douyin-danma-listener after close()
// (e.g. queued WS frames decoded after the listener is null'd).
// Without these, an unhandled 'error' or rejection crashes the process and
// the Tauri side sees a stderr stack and process exit.
process.on('uncaughtException', (err) => {
  log('warn', `uncaughtException: ${(err as Error)?.message ?? err}`);
});
process.on('unhandledRejection', (reason) => {
  log('warn', `unhandledRejection: ${(reason as Error)?.message ?? String(reason)}`);
});

// Dev hot-reload: when esbuild --watch rewrites our own bundled file,
// exit so the Tauri-side recovery hook respawns us with the new code.
if (process.env.SIDECAR_DEV) {
  void (async () => {
    try {
      const { watch } = await import('node:fs');
      const watcher = watch(__filename, { persistent: false }, () => {
        log('info', '[dev] source rebuilt — exiting for restart');
        watcher.close();
        setTimeout(() => process.exit(0), 200);
      });
    } catch {
      /* fs.watch may be unavailable on some platforms */
    }
  })();
}

// Parent process watchdog — exit if the Tauri parent disappears.
//
// We use TWO checks to be robust against macOS PID reuse:
//  1. process.ppid changed (becomes 1 / launchd when reparented to init).
//     On Unix, an orphan is reparented; ppid reflects the new parent.
//  2. process.kill(originalPpid, 0) → ESRCH. Belt-and-suspenders for
//     systems where ppid doesn't update reliably.
const originalParentPid = process.ppid;
setInterval(() => {
  const currentPpid = process.ppid;
  let parentGone = false;
  if (currentPpid !== originalParentPid) {
    parentGone = true;
  } else {
    try {
      process.kill(originalParentPid, 0);
    } catch (e: any) {
      if (e?.code === 'ESRCH') parentGone = true;
    }
  }
  if (parentGone) {
    // Belt-and-suspenders behind the stdin-EOF handler above.
    shutdown(`parent process gone (ppid was ${originalParentPid}, now ${currentPpid})`);
  }
}, 2000);

log('info', 'sidecar ready');
