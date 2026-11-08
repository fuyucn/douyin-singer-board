import { Image, mount, Scroll, signal, Text, View } from "nsh";
import { Button, Input } from "nsh/base";
import Client from "./listener-bundle.js";
import { qrCheck, qrKey, search as kugouSearch } from "./plugins/kugou/index.ts";

const DEFAULT_ROOM = "145997388006";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function App() {
  const room = signal(DEFAULT_ROOM);
  const status = signal("idle");
  const frames = signal(0);
  const lines = signal<string[]>([]);
  const add = (line: string) => lines.update((v) => [...v.slice(-60), line]);

  const keyword = signal("周杰伦");
  const kgStatus = signal("");
  const kgTracks = signal<string[]>([]);
  const qrImage = signal("");
  const qrValue = signal("");
  const qrStatus = signal("");

  let active: any = null;
  let generation = 0;

  async function connect(input: string) {
    const rid = input.trim();
    if (!/^\d{6,}$/.test(rid)) { status.set("房间号只能填数字"); return; }
    const gen = ++generation;
    if (active) { try { active.close(); } catch {} active = null; }
    lines.set([]); frames.set(0);
    status.set("解析房间...");
    add(`room ${rid}`);
    try {
      const html = await (await fetch(`https://live.douyin.com/${rid}`, { headers: { "User-Agent": UA } })).text();
      if (gen !== generation) return;
      const ids = [...html.matchAll(/roomId\\":\\"([^"\\]+)/g)]
        .map((m) => m[1])
        .filter((v) => /^\d{15,}$/.test(v));
      const roomId = ids[0] ?? rid;
      if (/status\\":2/.test(html)) add("streamer is live");
      add(`id_str ${roomId}`);
      status.set("连接中...");

      const client: any = new Client(roomId, { autoReconnect: 0, autoStart: false });
      active = client;
      const decode = client.decode.bind(client);
      client.decode = async (data: any) => {
        frames.update((n) => n + 1);
        try { return await decode(data); }
        catch (e: any) { add("decode FAIL " + String(e?.message ?? e)); }
      };
      client.on("init", (url: string) => add("init " + String(url).slice(0, 70)));
      client.on("open", () => { status.set("open"); add("open"); });
      let lastOnline = "";
      client.on("decoded", (ev: any) => {
        const method = String(ev?.method ?? "");
        const d = ev?.data;
        const nick = d?.user?.nickName ?? d?.user?.nickname ?? "?";
        if (method === "WebcastChatMessage") add(`[弹幕] ${nick}: ${String(d?.content ?? "")}`);
        else if (method === "WebcastMemberMessage") add(`[进入] ${nick}`);
        else if (method === "WebcastGiftMessage") add(`[礼物] ${nick}: ${String(d?.giftName ?? d?.giftId ?? "")} ×${d?.repeatCount ?? d?.comboCount ?? 1}`);
        else if (method === "WebcastLikeMessage") add(`[点赞] ${nick} ×${d?.count ?? 1}`);
        else if (method === "WebcastSocialMessage") add(`[关注] ${nick}`);
        else if (method === "WebcastRoomStatsMessage") {
          const value = String(d?.displayShort ?? d?.displayMiddle ?? d?.displayLong ?? "");
          if (value && value !== lastOnline) { lastOnline = value; add(`[在线] ${value}`); }
        }
      });
      client.on("error", (e: any) => add("error " + String(e?.message ?? e)));
      client.on("close", () => { status.set("closed"); add("close"); });
      await client.connect();
      if (gen === generation) add("connect() returned");
    } catch (e: any) {
      if (gen === generation) { status.set("失败"); add("FAIL " + String(e?.message ?? e)); }
    }
  }

  async function runKugouSearch() {
    kgStatus.set("搜索中...");
    kgTracks.set([]);
    try {
      const tracks = await kugouSearch({ keyword: keyword(), pagesize: 6 });
      kgStatus.set(`${tracks.length} 首`);
      kgTracks.set(tracks.map((t) => `${t.name} — ${t.artist}  ${t.hash.slice(0, 8)}`));
      console.log("[kugou] search", tracks.length, tracks[0]?.name);
    } catch (e: any) {
      kgStatus.set("失败: " + String(e?.message ?? e));
    }
  }

  async function makeQr() {
    qrStatus.set("生成中...");
    try {
      const qr = await qrKey();
      qrValue.set(qr.key);
      qrImage.set(qr.image);
      qrStatus.set("用酷狗 App 扫码");
      console.log("[kugou] qr", qr.key);
    } catch (e: any) {
      qrStatus.set("失败: " + String(e?.message ?? e));
    }
  }

  async function checkQr() {
    if (!qrValue()) return;
    qrStatus.set("检查中...");
    try {
      const r = await qrCheck(qrValue());
      qrStatus.set(`扫码状态 ${r.status}${r.token ? " · token 已拿到" : ""}`);
    } catch (e: any) {
      qrStatus.set("失败: " + String(e?.message ?? e));
    }
  }

  connect(DEFAULT_ROOM);

  return (
    <View class="flex-1 gap-3 p-5 bg-background">
      <Text class="text-xl font-semibold text-foreground">douyin-singer-new · 弹幕 + 酷狗插件测试</Text>
      <View class="flex-row items-center gap-2">
        <Input
          value={room()}
          onChange={({ value }) => room.set(value)}
          onSubmit={() => connect(room())}
          placeholder="抖音房间号"
          class="w-72 rounded-(--radius) border border-input px-3 py-2 text-foreground"
        />
        <Button onPress={() => connect(room())} class="rounded-(--radius) bg-primary px-4 py-2 active:opacity-60">
          <Text class="text-primary-foreground">连接</Text>
        </Button>
      </View>
      <Text class="text-sm text-muted-foreground">status: {status()} · frames: {frames()}</Text>
      <Scroll class="flex-1">
        <Text class="text-xs text-foreground">{lines().join("\n")}</Text>
      </Scroll>

      <View class="gap-2 border-t border-border pt-3">
        <Text class="font-semibold text-foreground">酷狗插件（直连 API，无 Node server）</Text>
        <View class="flex-row items-center gap-2">
          <Input
            value={keyword()}
            onChange={({ value }) => keyword.set(value)}
            onSubmit={runKugouSearch}
            placeholder="搜歌"
            class="w-56 rounded-(--radius) border border-input px-3 py-2 text-foreground"
          />
          <Button onPress={runKugouSearch} class="rounded-(--radius) bg-primary px-3 py-2 active:opacity-60">
            <Text class="text-primary-foreground">酷狗搜索</Text>
          </Button>
          <Button onPress={makeQr} class="rounded-(--radius) border border-border px-3 py-2 active:bg-muted">
            <Text class="text-foreground">扫码登录</Text>
          </Button>
          <Button onPress={checkQr} class="rounded-(--radius) border border-border px-3 py-2 active:bg-muted">
            <Text class="text-foreground">检查扫码</Text>
          </Button>
        </View>
        <Text class="text-xs text-muted-foreground">kugou: {kgStatus()}</Text>
        <If when={kgTracks().length > 0}>
          <Text class="text-xs text-foreground">{kgTracks().join("\n")}</Text>
        </If>
        <If when={qrImage().length > 0}>
          <View class="flex-row items-center gap-3">
            <Image src={qrImage()} style={{ width: 140, height: 140 }} />
            <Text class="text-xs text-muted-foreground">{qrStatus()} {"\n"}{qrValue()}</Text>
          </View>
        </If>
        <If when={qrImage().length === 0}>
          <Text class="text-xs text-muted-foreground">{qrStatus()}</Text>
        </If>
      </View>
    </View>
  );
}
mount(App);
