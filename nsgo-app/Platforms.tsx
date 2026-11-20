import { createMotion, Image, Scroll, signal, Text, token, View, windowSize } from "nsgo";
import { Dialog as ConfirmationDialog, Input } from "nsgo/base";
import { Dialog, Icon } from "nsgo/ui";
import type { State } from "./App";
import { Action, IconAction } from "./Controls";

type PanelProps = { state: State; act: (name: string, data?: unknown) => Promise<void> };
type PlaylistProps = PanelProps & { name: string; bound: boolean };
const platformName = (state: State) => state.platform === "kugou-web" ? "酷狗音乐" : "网易云音乐";

function Unconfirmed(props: PanelProps) {
  const acknowledged = signal("");
  return <Each of={props.state.unconfirmed || []} key={(entry) => entry.key}>
    {(entry) => <View class="gap-2 rounded border border-border p-3"><Text class="text-xs text-muted-foreground">「{entry().name}」加入结果未知。请先在 {platformName(props.state)} 的绑定歌单核对；只有确认未加入后才能重试。</Text>
      <Action label={acknowledged() === entry().key ? "确认已核对且未加入，解除写入锁" : "我已在平台核对，该曲未加入"} locked={props.state.busy}
        onPress={() => { if (acknowledged() === entry().key) { void props.act("platform.acknowledge", entry().key); acknowledged.set(""); } else acknowledged.set(entry().key); }} />
    </View>}
  </Each>;
}

export function Platforms(props: PanelProps) {
  const cookie = signal("");
  return <Scroll testID="platform-settings" class="min-h-0 flex-1 bg-card p-4"><View class="gap-4">
    <If when={!props.state.qrImage}>
    <Text class="text-[13px] font-semibold text-foreground">音乐平台插件</Text>
    <Text class="text-xs text-muted-foreground">可选一个平台，也可以都不开；歌单、同步与歌曲匹配只随所选平台显示。</Text>
    <Each of={[{ id: "kugou-web", testID: "plugin-kugou", name: "酷狗音乐" }, { id: "netease-web", testID: "plugin-netease", name: "网易云音乐" }]} key={(provider) => provider.id}>
      {(provider) => <View class="flex-row items-center gap-3 rounded-[6px] border border-border p-3" classList={{ "bg-secondary": props.state.platform === provider().id }}>
        <View class="min-w-0 flex-1 gap-1"><Text class="text-[13px] font-medium text-foreground">{provider().name}</Text><Text class="text-[11px] text-faint">{props.state.platform === provider().id ? "已启用" : "未启用"}</Text></View>
        <Action label={props.state.platform === provider().id ? "停用" : "启用"} testID={provider().testID} locked={props.state.busy} onPress={() => { cookie.set(""); void props.act("platform.select", props.state.platform === provider().id ? "" : provider().id); }} />
      </View>}
    </Each>
    <If when={!props.state.platform} else={<Action label="仅弹幕监听（停用平台）" testID="plugin-none" locked={props.state.busy} onPress={() => { cookie.set(""); void props.act("platform.select", ""); }} />}>
      <Text testID="plugin-none" class="text-xs text-muted-foreground">仅弹幕监听：连接直播间后收集点歌指令，不操作音乐平台。</Text>
    </If>
    </If>
    <If when={!!props.state.platform}>
      <View class="h-px bg-line" /><Text class="text-[13px] font-semibold text-foreground">{platformName(props.state)}登录</Text>
      <Text testID="platform-account" class="text-xs text-muted-foreground">{props.state.verified ? "已登录："+props.state.account : props.state.busy ? "正在验证账号…" : "未登录或尚未验证"}</Text>
      <If when={!props.state.verified} else={<View class="flex-row gap-2"><Action label="刷新登录与歌单" testID="refresh-login" icon="refresh" locked={props.state.busy} onPress={() => void props.act("platform.refresh")} /><Action label="退出登录" testID="logout" locked={props.state.busy} onPress={() => void props.act("platform.logout")} /></View>}>
        <Action label="生成登录二维码 / 刷新" testID="login-qr" icon="refresh" locked={props.state.busy} onPress={() => void props.act("platform.qr")} />
        <If when={props.state.qrStatus}><Text testID="qr-status" class="text-xs text-muted-foreground">{props.state.qrStatus}</Text><Action label="取消扫码" testID="cancel-qr" onPress={() => void props.act("platform.cancelQR")} /></If>
        <If when={props.state.qrImage}><View class="items-center gap-2"><Image testID="login-qr-image" src={props.state.qrImage} alt="登录二维码" class="size-[180px]" /><Text class="text-xs text-muted-foreground">请使用 {platformName(props.state)} App 扫码并在手机确认。</Text></View></If>
        <If when={props.state.platform === "netease-web"}>
          <Text class="text-xs text-muted-foreground">如果平台拒绝扫码，可使用自己的 MUSIC_U Cookie；不要发到聊天中。</Text>
          <Input testID="netease-cookie" accessibilityLabel="网易云 Cookie" masked value={cookie()} onChange={({ value }) => cookie.set(value)} placeholder="包含 MUSIC_U 的 Cookie" class="h-8 rounded border border-border bg-background px-2 text-sm text-foreground" />
          <Action label="验证 Cookie 登录" testID="cookie-login" disabled={!cookie().trim()} locked={props.state.busy} onPress={() => { const value = cookie(); cookie.set(""); void props.act("platform.cookie", value); }} />
        </If>
      </If>
      <Text class="text-[11px] text-faint">授权保存在系统钥匙串；切换平台或退出账号会停止同步。</Text>
      <Unconfirmed state={props.state} act={props.act} />
    </If>
  </View></Scroll>;
}

function SyncIndicator() {
  const motion = createMotion({ enter: "spin" });
  return <View style={motion.style}><Icon name="refresh" size={12} color={token("foreground")} /></View>;
}

export function PlaylistControls(props: PlaylistProps & { setName: (name: string) => void; notify: (message: string) => void }) {
  const picker = signal(false);
  const confirmation = signal("");
  const confirmationKey = () => props.state.platform+":"+props.state.target.account+":"+props.state.target.id+":"+props.state.target.name;
  const openClear = () => {
    if (!props.bound) {
      props.notify(props.name.trim() ? "请先选择与输入框同名的歌单；找不到时可先刷新列表。" : "请先选择要清理的歌单。");
      return;
    }
    confirmation.set(confirmationKey());
  };
  return <View testID="playlist-controls" class="gap-2 border-b border-line p-4">
    <View class="flex-row items-center justify-between"><Text class="text-[13px] font-medium text-foreground">{platformName(props.state)}歌单</Text><IconAction label="选择已有歌单" icon="list" testID="playlist-picker" onPress={() => picker.set(true)} /></View>
    <View class="flex-row items-center justify-between"><Text class="text-xs text-muted-foreground">歌单名称</Text><Text class="font-mono text-[11px] text-faint">id: {props.bound ? props.state.target.id : "—"}</Text></View>
    <Input testID="playlist-name" accessibilityLabel="歌单名称" value={props.name} disabled={props.state.busy} onChange={({ value }) => { props.setName(value); confirmation.set(""); void props.act("platform.name", value); }} placeholder="自动加入歌单的名字" class="h-8 rounded border border-border bg-background px-2 text-sm text-foreground" />
    <View class="flex-row gap-2"><Action label="清理" icon="trash" testID="clear-platform-playlist" stretch danger onPress={openClear} />
      <View role="button" accessibilityLabel={props.state.auto ? "停止同步" : "自动同步"} testID="auto-sync"
        class="h-8 flex-1 flex-row items-center justify-center gap-1.5 rounded-[5px] border bg-card px-2.5 hover:bg-secondary"
        classList={{ "border-transparent": props.state.auto, "border-border": !props.state.auto,
          "opacity-55": !props.state.auto && !!props.name.trim(), "opacity-40": !props.state.auto && !props.name.trim() }}
        style={props.state.auto ? { boxShadow: "0 0 12px rgba(100,180,255,0.4), 0 0 24px rgba(100,180,255,0.2)" } : undefined}
        disabled={!props.state.auto && (props.state.busy || !props.name.trim())}
        onPress={() => void props.act(props.state.auto ? "platform.stopSync" : "platform.startSync", props.name)}>
        <If when={props.state.auto} else={<Icon name="refresh" size={12} color={token("foreground")} />}><SyncIndicator /></If>
        <Text class="text-xs text-foreground">{props.state.auto ? "同步中" : "自动同步"}</Text>
      </View></View>
    <Dialog open={picker()} testID="playlist-picker-dialog" title="选择已有歌单" onOpenChange={({ open }) => picker.set(open)} style={{ width: Math.min(460, windowSize().width - 32), maxHeight: Math.min(500, windowSize().height - 60) }}>
      <View class="flex-row items-center gap-2"><Text class="min-w-0 flex-1 text-xs text-muted-foreground" testID="bound-playlist">{props.state.target.id ? props.state.target.name+" · ID "+props.state.target.id : "尚未绑定歌单"}</Text><IconAction label="刷新歌单" icon="refresh" testID="refresh-playlists" locked={props.state.busy} onPress={() => void props.act("platform.refresh")} /><IconAction label="关闭歌单选择" icon="close" testID="close-playlist-picker" onPress={() => picker.set(false)} /></View>
      <Scroll class="min-h-0 shrink"><Each of={props.state.playlists || []} key={(item) => item.listid}>{(item) => <View class="flex-row items-center gap-2 border-b border-line py-2"><Text class="min-w-0 flex-1 text-xs text-foreground">{item().name} · {item().count} 首</Text><Action label={props.bound && props.state.target.id === item().listid ? "已绑定" : "选择"} testID={"bind-"+item().listid} locked={props.state.busy} onPress={() => { props.setName(item().name); confirmation.set(""); void props.act("platform.bind", item().listid); }} /></View>}</Each></Scroll>
    </Dialog>
    <ConfirmationDialog open={props.bound && confirmation() !== "" && confirmation() === confirmationKey()} testID="clear-playlist-dialog"
      animation="none" accessibilityLabel="清空并重建歌单？" backdropClass="bg-transparent" backdropTestID="clear-playlist-backdrop"
      class="m-auto gap-3 rounded-[10px] border border-border bg-card p-5 shadow-lg"
      style={{ width: Math.min(440, windowSize().width - 32) }}
      onOpenChange={({ open }) => { if (!open) confirmation.set(""); }}>
      <Text class="text-base font-semibold text-foreground">清空并重建歌单？</Text>
      <Text class="text-sm text-foreground">将删除 {platformName(props.state)} 的「{props.state.target.name}」(ID {props.state.target.id}) 并同名重建；其他同名歌单不会删除。自动同步将停止。</Text>
      <If when={props.state.busy}><Text class="text-xs text-muted-foreground">{props.state.addingSong ? "当前正在加歌，完成后即可确认清理。" : "请等待当前歌单操作完成后再确认。"}</Text></If>
      <View class="flex-row justify-end gap-2"><Action label="取消" testID="cancel-clear-platform" onPress={() => confirmation.set("")} /><Action label="确认清理并重建" testID="confirm-clear-platform" danger disabled={props.state.busy || !props.bound} onPress={() => {
        if (props.state.busy || !props.bound || confirmation() !== confirmationKey()) return;
        void props.act("platform.clear", { name: props.name, id: props.state.target.id });
        confirmation.set("");
      }} /></View>
    </ConfirmationDialog>
  </View>;
}

export function SongMenu(props: PlaylistProps & { songID: string; copy: (value: string) => Promise<void>; close: () => void }) {
  const song = () => [...props.state.songs, ...props.state.played].find((entry) => entry.id === props.songID);
  const queued = () => props.state.songs.some((entry) => entry.id === props.songID);
  const query = signal(song()?.name || "");
  return <Dialog open testID="song-menu-dialog" accessibilityLabel="歌曲操作" bare onOpenChange={({ open }) => { if (!open) props.close(); }} style={{ width: Math.min(540, windowSize().width - 32), height: Math.min(570, windowSize().height - 60) }}>
    <View class="h-12 shrink-0 flex-row items-center gap-2 border-b border-line px-4"><Text class="min-w-0 flex-1 text-sm font-semibold text-foreground">{song()?.name || "操作已完成"}</Text><IconAction label="关闭歌曲操作" icon="close" testID="close-song-menu" onPress={props.close} /></View>
    <Scroll class="min-h-0 flex-1 p-4"><View class="gap-3">
      <If when={!!song()}><View class="flex-row flex-wrap gap-2"><Action label="复制歌名" icon="copy" onPress={() => void props.copy(song()?.name || "")} /><Action label="复制原弹幕" icon="copy" testID="copy-raw-message" onPress={() => void props.copy(song()?.raw || song()?.name || "")} />
        <Action label="拉黑匹配歌曲" icon="ban" testID="blacklist-matched-song" onPress={() => void props.act("board.blacklist", { kind: "song", name: song()?.matched || song()?.name, artist: song()?.artist })} />
        <If when={!!song()?.artist}><Action label="拉黑歌手" icon="ban" testID="blacklist-matched-artist" onPress={() => void props.act("board.blacklist", { kind: "singer", name: song()?.artist })} /></If>
        <Action label="删除" icon="trash" danger testID="delete-song-menu" onPress={() => { void props.act(queued() ? "board.remove" : "board.removePlayed", props.songID); props.close(); }} />
      </View></If>
      <If when={queued() && !!props.state.platform}>
        <Text class="text-xs text-muted-foreground">行内「加入歌单」使用首个匹配；如需其他版本，可在这里搜索选择。</Text>
        <View class="flex-row gap-2"><Input testID="platform-query" accessibilityLabel="搜索歌曲" value={query()} onChange={({ value }) => query.set(value)} onSubmit={() => { if (!props.state.busy) void props.act("platform.search", query()); }} placeholder="歌曲名或歌手" class="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-sm text-foreground" /><IconAction label="搜索" icon="search" testID="platform-search" disabled={!query().trim()} locked={props.state.busy} onPress={() => void props.act("platform.search", query())} /></View>
        <Each of={props.state.results || []} key={(item) => item.key || item.hash || ""}>{(item) => <View class="flex-row items-center gap-2 border-b border-line py-2"><View class="min-w-0 flex-1 gap-1"><Text class="text-sm text-foreground">{item().name}</Text><Text class="text-xs text-muted-foreground">{item().artist}</Text></View><IconAction label="加入绑定歌单" icon="list-plus" testID={"add-result-"+(item().key || item().hash)} disabled={!props.bound || !!song()?.uncertain} locked={props.state.busy} onPress={() => void props.act("platform.add", { song: props.songID, name: props.name, id: props.state.target.id, key: item().key || item().hash })} /></View>}</Each>
      </If>
      <Unconfirmed state={props.state} act={props.act} />
    </View></Scroll>
  </Dialog>;
}
