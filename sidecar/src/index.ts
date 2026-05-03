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
import type { Config, SidecarCmd, SidecarEvent } from './types.js';

let DouYinDanmaClient: any = null;
let listener: any = null;
let matcher: Matcher | null = null;
let companionPid: number | null = null;

function emit(ev: SidecarEvent): void {
  process.stdout.write(JSON.stringify(ev) + '\n');
}

function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string): void {
  emit({ event: 'log', level, msg });
}

// URL short code (web_rid) → real id_str.
// The number in the live URL https://live.douyin.com/{web_rid} is the web_rid,
// but douyin-danma-listener expects the id_str (~20-digit long ID).
// We fetch the live-room HTML and extract id_str via the `roomId":"..."` pattern.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function getTtwid(): Promise<string> {
  const res = await fetch('https://live.douyin.com/', {
    method: 'GET',
    headers: { 'User-Agent': UA },
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(/ttwid=([^;,\s]+)/);
  if (!m) throw new Error('no ttwid in response');
  return m[1];
}

async function resolveIdStr(input: string): Promise<string> {
  // If it already looks like an id_str (>= 18 digits) use it directly.
  if (/^\d{18,}$/.test(input)) return input;

  log('info', `resolving web_rid ${input} -> id_str ...`);
  const ttwid = await getTtwid();
  const html = await fetch(`https://live.douyin.com/${encodeURIComponent(input)}`, {
    headers: {
      'User-Agent': UA,
      Cookie: `ttwid=${ttwid}; __ac_nonce=0123407cc00a9e438deb4`,
      'Accept-Encoding': 'gzip, deflate',
    },
  }).then((r) => r.text());

  const m = html.match(/roomId\\":\\"(\d+)\\"/);
  if (!m) {
    log('warn', `no roomId match in HTML, use input ${input} as-is`);
    return input;
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
      case 'set_companion_pid':
        companionPid = cmd.pid;
        log('info', `companion pid set: ${cmd.pid}`);
        break;
    }
  } catch (e) {
    emit({ event: 'error', msg: String((e as Error)?.message ?? e) });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const cmd = JSON.parse(line) as SidecarCmd;
    void handleCmd(cmd);
  } catch {
    emit({ event: 'error', msg: `invalid cmd: ${line}` });
  }
});

process.on('SIGTERM', () => void stop().then(() => process.exit(0)));
process.on('SIGINT', () => void stop().then(() => process.exit(0)));

// Parent process watchdog — exit if the Tauri parent disappears.
// Also kills the companion kugou-api process if one was registered.
// Only exit on ESRCH (process not found); ignore EPERM/other errors
// so we don't false-positive on Windows permission checks.
const parentPid = process.ppid;
setInterval(() => {
  try {
    process.kill(parentPid, 0);
  } catch (e: any) {
    if (e?.code === 'ESRCH') {
      log('info', 'parent process gone, exiting');
      if (companionPid !== null) {
        try {
          if (process.platform === 'win32') {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { execSync } = require('node:child_process') as typeof import('node:child_process');
            execSync(`taskkill /F /T /PID ${companionPid}`, { stdio: 'ignore' });
          } else {
            process.kill(companionPid, 'SIGTERM');
          }
        } catch {}
      }
      void stop().then(() => process.exit(0));
    }
  }
}, 2000);

log('info', 'sidecar ready');
