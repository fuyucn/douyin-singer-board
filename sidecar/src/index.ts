// Tauri ↔ Node sidecar 桥接
//
// stdin: 一行一个 JSON 命令 (SidecarCmd)
// stdout: 一行一个 JSON 事件 (SidecarEvent)
//
// douyin-danma-listener API (lib/index.js + types/types.d.ts):
//   class DouYinDanmaClient extends TypedEmitter
//   constructor(roomId, options?)
//   连接: connect() / 断开: close()
//   事件: 'open' | 'close' | 'error' | 'reconnect' | 'init' | 'chat' | 'message' | ...
//   ChatMessage: { user: { id, nickName, BadgeImageList }, content, eventTime }

import readline from 'node:readline';
import { Matcher } from './matcher.js';
import type { Config, SidecarCmd, SidecarEvent } from './types.js';

let DouYinDanmaClient: any = null;
let listener: any = null;
let matcher: Matcher | null = null;

function emit(ev: SidecarEvent): void {
  process.stdout.write(JSON.stringify(ev) + '\n');
}

function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string): void {
  emit({ event: 'log', level, msg });
}

// URL 短码 (web_rid) → 真正的 id_str
// 抖音直播间链接 https://live.douyin.com/{web_rid} 里那串数字是 web_rid,
// douyin-danma-listener 要的是 id_str (~20 位长 ID).
// 抓直播间 HTML, 正则匹 `roomId":"..."` 拿到 id_str.
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
  // 已经像 id_str (>= 18 位) 就直接用
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
  // 注意: 第一参数是 roomId 字符串 (id_str, 不是 web_rid)
  listener = new DouYinDanmaClient(idStr);

  listener.on('open', () => {
    emit({ event: 'status', connected: true, message: '已连接抖音' });
    log('info', '✅ ws open');
  });
  listener.on('close', () => {
    emit({ event: 'status', connected: false, message: '抖音连接关闭' });
    log('warn', 'ws close');
  });
  listener.on('error', (e: Error) => emit({ event: 'error', msg: String(e?.message ?? e) }));
  listener.on('reconnect', (count: number) => log('info', `reconnecting attempt ${count}`));
  listener.on('init', (url: string) => log('info', `ws url: ${url.slice(0, 80)}...`));
  // 低频事件 (gift/social) 还是值得 log; member/like/roomStats/roomRank 太刷屏不留
  listener.on('gift', (m: any) =>
    log('info', `🎁 ${m?.user?.nickName ?? '?'} 送礼 (${m?.common?.describe ?? m?.common?.method ?? ''})`),
  );
  listener.on('social', (m: any) =>
    log('info', `👥 ${m?.user?.nickName ?? '?'} ${m?.common?.describe ?? '关注'}`),
  );

  // 诊断: 把所有进入 decode 的消息 method 名打出来 (含 lib 不处理的那些).
  // 帮我们看到比如 WebcastBatchGiftMessage / WebcastInRoomBannerMessage 这类 lib 直接 drop 的类型.
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
        /* 不打印, 失败就让 origDecode 走 */
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
    // 每条弹幕一行 debug 日志: "user: content ✅/❌/↩️ reason"
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

log('info', 'sidecar ready');
