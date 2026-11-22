import { createMotion, Image, Scroll, signal, Text, token, View, windowSize } from "nsgo";
import { Dialog as ConfirmationDialog, Input } from "nsgo/base";
import { Dialog, Icon, Switch } from "nsgo/ui";
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
    <Text class="text-[13px] font-semibold text-foreground">音乐平台插件</Text>
    <Text class="text-xs text-muted-foreground">可选一个平台，也可以都不开；歌单、同步与歌曲匹配只随所选平台显示。</Text>
    <View class="gap-3">
      <Each of={[{ id: "kugou-web", testID: "plugin-kugou", name: "酷狗音乐" }, { id: "netease-web", testID: "plugin-netease", name: "网易云音乐" }]} key={(provider) => provider.id}>{(provider) => {
        const active = () => props.state.platform === provider().id;
        return <View testID={"plugin-card-"+provider().id} class="gap-3 rounded-[8px] border p-3" classList={{ "border-foreground bg-secondary": active(), "border-border bg-card": !active() }}>
          <View class="flex-row items-center gap-3">
            <View class="min-w-0 flex-1 gap-1"><Text class="text-[13px] font-medium text-foreground">{provider().name}</Text><Text class="text-[11px] text-faint">{active() ? "已启用" : "未启用"}</Text></View>
            <Switch testID={provider().testID} accessibilityLabel={"启用"+provider().name} checked={active()} disabled={props.state.busy}
              onChange={({ checked }) => { cookie.set(""); void props.act("platform.select", checked ? provider().id : ""); }} />
          </View>
          <If when={active()}>
            <View class="h-px bg-line" />
            <Text testID="platform-account" class="text-xs text-muted-foreground">{props.state.verified ? "已登录："+props.state.account : props.state.busy ? "正在验证账号…" : "未登录或尚未验证"}</Text>
            <If when={!props.state.verified} else={<View class="flex-row gap-2"><Action label="刷新登录与歌单" testID="refresh-login" icon="refresh" locked={props.state.busy} onPress={() => void props.act("platform.refresh")} /><Action label="退出登录" testID="logout" locked={props.state.busy} onPress={() => void props.act("platform.logout")} /></View>}>
              <Action label="生成登录二维码 / 刷新" testID="login-qr" icon="refresh" locked={props.state.busy} onPress={() => void props.act("platform.qr")} />
              <If when={props.state.qrStatus}><Text testID="qr-status" class="text-xs text-muted-foreground">{props.state.qrStatus}</Text><Action label="取消扫码" testID="cancel-qr" onPress={() => void props.act("platform.cancelQR")} /></If>
              <If when={props.state.qrImage}><View class="items-center gap-2"><Image testID="login-qr-image" src={props.state.qrImage} alt="登录二维码" class="size-[150px]" /><Text class="text-xs text-muted-foreground">请使用 {provider().name} App 扫码并在手机确认。</Text></View></If>
              <If when={provider().id === "netease-web"}>
                <Text class="text-xs text-muted-foreground">如果平台拒绝扫码，可使用自己的 MUSIC_U Cookie；不要发到聊天中。</Text>
                <Input testID="netease-cookie" accessibilityLabel="网易云 Cookie" masked value={cookie()} onChange={({ value }) => cookie.set(value)} placeholder="包含 MUSIC_U 的 Cookie" class="h-8 rounded border border-border bg-background px-2 text-sm text-foreground" />
                <Action label="验证 Cookie 登录" testID="cookie-login" disabled={!cookie().trim()} locked={props.state.busy} onPress={() => { const value = cookie(); cookie.set(""); void props.act("platform.cookie", value); }} />
              </If>
            </If>
            <Text class="text-[11px] text-faint">授权保存在系统钥匙串；切换平台或退出账号会停止同步。</Text>
          </If>
        </View>;
      }}</Each>
    </View>
    <If when={!props.state.platform}>
      <Text testID="plugin-none" class="text-xs text-muted-foreground">仅弹幕监听：连接直播间后收集点歌指令，不操作音乐平台。</Text>
    </If>
    <If when={!!props.state.platform}><Unconfirmed state={props.state} act={props.act} /></If>
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

export function SongMenu(props: PlaylistProps & { songID: string; onContextMenu: (point: { x: number; y: number }) => void }) {
  const song = () => [...props.state.songs, ...props.state.played].find((entry) => entry.id === props.songID);
  return <View testID={"menu-"+props.songID} accessibilityLabel="歌曲操作" class="min-w-0 flex-1 px-2"
    onContextMenu={(event) => props.onContextMenu({ x: event.pagePosition.x, y: event.pagePosition.y })}>
    <Text class="truncate text-[13px] font-medium text-foreground">{song()?.name}</Text>
    <If when={!!song()?.detail}><Text class="truncate text-[11px] text-faint">{song()?.detail}</Text></If>
  </View>;
}

export function SongMenuOverlay(props: PlaylistProps & { songID: string; point: { x: number; y: number }; copy: (value: string) => Promise<void>; close: () => void; openSearch: (id: string) => void }) {
  const song = () => [...props.state.songs, ...props.state.played].find((entry) => entry.id === props.songID);
  const queued = () => props.state.songs.some((entry) => entry.id === props.songID);
  const showArtist = !!song()?.artist;
  const showSearch = queued() && !!props.state.platform;
  const item = (label: string, testID: string, onPress: () => void, disabled = false) => <View role="menuitem" accessibilityLabel={label} testID={testID} disabled={disabled}
    class="h-8 justify-center rounded px-3 hover:bg-secondary" classList={{ "opacity-40": disabled }} onPress={onPress}>
    <Text class="truncate text-xs text-foreground">{label}</Text>
  </View>;
  const menuWidth = 220;
  const menuHeight = (4 + (showArtist ? 1 : 0) + (showSearch ? 2 : 0)) * 32 + (showSearch ? 9 : 0) + 8;
  const left = Math.max(8, Math.min(props.point.x + 2, windowSize().width - menuWidth - 8));
  const top = Math.max(8, Math.min(props.point.y + 2, windowSize().height - menuHeight - 8));
  return <View testID="song-menu-layer" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
    <View testID="song-menu-backdrop" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} onPress={props.close} />
    <View testID="song-menu" role="menu" accessibilityLabel="歌曲操作" class="gap-0.5 rounded-md border border-border bg-card p-1"
      style={{ position: "absolute", left, top, width: menuWidth, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
      {item("复制弹幕", "copy-raw-message", () => { void props.copy(song()?.raw || song()?.name || ""); props.close(); })}
      {item("复制歌名", "copy-song-name", () => { void props.copy(song()?.matched || song()?.name || ""); props.close(); }, !song()?.matched)}
      {item("删除", "delete-song-menu", () => { void props.act(queued() ? "board.remove" : "board.removePlayed", props.songID); props.close(); })}
      {item("黑名单这首歌", "blacklist-matched-song", () => { void props.act("board.blacklist", { kind: "song", name: song()?.matched || song()?.name, artist: song()?.artist }); props.close(); })}
      <If when={showArtist}>{item("黑名单该歌手", "blacklist-matched-artist", () => { void props.act("board.blacklist", { kind: "singer", name: song()?.artist }); props.close(); })}</If>
      <If when={showSearch}><View class="mx-2 my-1 h-px bg-line" /></If>
      <If when={showSearch}>{item("搜索其他版本…", "song-menu-search", () => props.openSearch(props.songID))}</If>
    </View>
  </View>;
}

export function SongSearchDialog(props: PlaylistProps & { songID: string; copy: (value: string) => Promise<void>; close: () => void }) {
  const song = () => [...props.state.songs, ...props.state.played].find((entry) => entry.id === props.songID);
  const queued = () => props.state.songs.some((entry) => entry.id === props.songID);
  const query = signal(song()?.name || "");
  return <Dialog open testID="song-search-dialog" accessibilityLabel="搜索其他版本" bare onOpenChange={({ open }) => { if (!open) props.close(); }} style={{ width: Math.min(540, windowSize().width - 32), height: Math.min(570, windowSize().height - 60) }}>
    <View class="h-12 shrink-0 flex-row items-center gap-2 border-b border-line px-4"><Text class="min-w-0 flex-1 text-sm font-semibold text-foreground">搜索其他版本：{song()?.name || "操作已完成"}</Text><IconAction label="关闭搜索" icon="close" testID="close-song-search" onPress={props.close} /></View>
    <Scroll class="min-h-0 flex-1 p-4"><View class="gap-3">
      <If when={queued() && !!props.state.platform}>
        <Text class="text-xs text-muted-foreground">行内「加入歌单」使用首个匹配；如需其他版本，可在这里搜索选择。</Text>
        <View class="flex-row gap-2"><Input testID="platform-query" accessibilityLabel="搜索歌曲" value={query()} onChange={({ value }) => query.set(value)} onSubmit={() => { if (!props.state.busy) void props.act("platform.search", query()); }} placeholder="歌曲名或歌手" class="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-sm text-foreground" /><IconAction label="搜索" icon="search" testID="platform-search" disabled={!query().trim()} locked={props.state.busy} onPress={() => void props.act("platform.search", query())} /></View>
        <Each of={props.state.results || []} key={(item) => item.key || item.hash || ""}>{(item) => <View class="flex-row items-center gap-2 border-b border-line py-2"><View class="min-w-0 flex-1 gap-1"><Text class="text-sm text-foreground">{item().name}</Text><Text class="text-xs text-muted-foreground">{item().artist}</Text></View><IconAction label="加入绑定歌单" icon="list-plus" testID={"add-result-"+(item().key || item().hash)} disabled={!props.bound || !!song()?.uncertain} locked={props.state.busy} onPress={() => void props.act("platform.add", { song: props.songID, name: props.name, id: props.state.target.id, key: item().key || item().hash })} /></View>}</Each>
      </If>
      <Unconfirmed state={props.state} act={props.act} />
    </View></Scroll>
  </Dialog>;
}
