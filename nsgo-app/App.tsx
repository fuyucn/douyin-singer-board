import { cleanup, Clipboard, colorScheme, host, Image, List, mount, Scroll, setColorScheme, signal, Text, token, View, windowSize } from "nsgo";
import { Input, Tooltip } from "nsgo/base";
import { Dialog, Icon, Toasts, type ToastsRef } from "nsgo/ui";
import logo from "./assets/logo.png";
import { Platforms, PlaylistControls, SongMenuOverlay, SongSearchDialog } from "./Platforms";
import { Action, IconAction } from "./Controls";
import { BlacklistPanel, LogPanel, SessionFooter, type BlacklistEntry } from "./WorkbenchPanels";

export type Rules = { room: string; template: string; fans: number; cooldown: number; repeat: number; limit: number };
export type Song = { id: string; name: string; user: string; time: string; detail: string; uncertain: boolean; raw: string; artist: string; matched: string; match: string; canAdd: boolean; quota: string };
export type State = {
  version: string; updatesEnabled: boolean; showLogs: boolean; playlistName: string;
  rules: Rules; songs: Song[]; played: Song[]; total: number;
  blacklist: BlacklistEntry[]; connection: string; running: boolean;
  frames: number; logs: string[]; notice: string; noticeID: number; platform: string; account: string;
  verified: boolean; busy: boolean; addingSong: string; auto: boolean; qrImage: string; qrStatus: string;
  target: { id: number; name: string; account: string };
  playlists: { listid: number; name: string; count: number }[];
  results: { name: string; artist: string; key: string; hash?: string }[];
  unconfirmed: { key: string; name: string }[];
};

function Field(props: { label: string; value: string; testID: string; onChange: (value: string) => void; disabled?: boolean; hint?: string }) {
  return (
    <View class="min-w-0 flex-1 gap-1.5">
      <View class="flex-row items-center gap-1"><Text class="text-xs text-muted-foreground">{props.label}</Text>
        <If when={!!props.hint}><Tooltip testID={props.testID + "-help"} placement="right" popupClass="max-w-[280px] rounded-[6px] bg-foreground px-2 py-1"
          trigger={<View focusable accessibilityLabel="占位符说明"><Icon name="help" size={13} color={token("faint")} /></View>}><Text class="text-xs text-background">{props.hint}</Text></Tooltip></If>
      </View>
      <Input testID={props.testID} accessibilityLabel={props.label} value={props.value} disabled={props.disabled}
        onChange={({ value }) => props.onChange(value)} class="h-8 rounded-[4px] border border-border bg-background px-2 text-sm text-foreground" />
    </View>
  );
}

function App() {
  const state = signal<State>({ version: "", updatesEnabled: false, showLogs: false, playlistName: "", rules: { room: "", template: "点歌[space][song]", fans: 0, cooldown: 0, repeat: 1800, limit: 3 },
    songs: [], played: [], total: 0, blacklist: [], connection: "未连接", running: false, frames: 0, logs: [], notice: "", noticeID: 0, platform: "", account: "",
    verified: false, busy: false, addingSong: "", auto: false, qrImage: "", qrStatus: "", target: { id: 0, name: "", account: "" }, playlists: [], results: [], unconfirmed: [] });
  const draftRules = signal(state().rules);
  const playlistDrafts = signal<Record<string, string>>({});
  const playlistName = () => playlistDrafts()[state().platform] ?? "";
  const boundPlaylist = () => state().target.id > 0 && state().target.name === playlistName().trim();
  const setPlaylistName = (name: string) => playlistDrafts.update((drafts) => ({ ...drafts, [state().platform]: name }));
  const ready = signal(false);
  const toasts = signal<ToastsRef | null>(null);
  const notify = (title: string, type: "plain" | "success" | "error" = "plain") => {
    void toasts()?.show({ title, type, duration: type === "error" ? 6000 : 3200 });
  };
  let lastNoticeID = 0;
  const receive = (value: State) => {
    if (value.platform && playlistDrafts()[value.platform] === undefined) {
      playlistDrafts.update((drafts) => ({ ...drafts, [value.platform]: value.playlistName }));
    }
    if (!ready()) { draftRules.set(value.rules); ready.set(true); }
    state.set(value);
    if (value.noticeID > lastNoticeID && value.notice) {
      lastNoticeID = value.noticeID;
      notify(value.notice);
    }
  };
  const unsubscribe = host.on<State>("board.changed", receive);
  cleanup(unsubscribe);
  host.call<State>("board.snapshot").then((value) => { if (!ready()) receive(value); }).catch(() => notify("初始化失败，请重新打开应用", "error"));
  const act = async (name: string, data: unknown = null) => {
    try { await host.call(name, data); }
    catch { notify("操作失败，请重试", "error"); }
  };
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  cleanup(() => clearTimeout(saveTimer));
  const patchRule = (key: keyof Rules, value: string | number) => {
    const next = { ...draftRules(), [key]: value };
    draftRules.set(next);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void act("board.autosave", next), 400);
  };
  const tab = signal("songs");
  const settings = signal(false);
  const settingsTab = signal("general");
  const songMenu = signal("");
  const menuPoint = signal({ x: 0, y: 0 });
  const songSearch = signal("");
  const themeMode = signal("system");
  const openSettings = (section: string) => { settingsTab.set(section); settings.set(true); };
  const resetConfirm = signal(false);
  const closeSettings = () => { resetConfirm.set(false); void act("platform.cancelQR"); settings.set(false); };
  const configOpen = signal(false);
  const manual = signal("");
  const search = signal("");
  const confirm = signal("");
  const narrow = () => windowSize().width < 720;
  const visibleSongs = () => tab() === "played" ? state().played.filter((song) => (song.name+song.user).toLowerCase().includes(search().toLowerCase())) : state().songs;
  const copy = async (text: string) => { try { await Clipboard.writeText(text); notify("已复制"); } catch { notify("复制失败", "error"); } };
  const copyDiagnostics = async () => {
    const s = state();
    const lines = [
      `SUSUSongBoard 诊断 v${s.version}`,
      `直播间: ${s.rules.room || "—"}  连接: ${s.connection}  运行: ${s.running ? "是" : "否"}`,
      `平台: ${s.platform || "未启用"}  ${s.verified ? "已登录" : "未登录"}${s.account ? " / " + s.account : ""}`,
      `歌单: ${s.target.name || "—"} (ID ${s.target.id || 0})  自动同步: ${s.auto ? "开" : "关"}`,
      `规则: 粉丝=${s.rules.fans} 冷却=${s.rules.cooldown}s 重复=${s.rules.repeat}s 上限=${s.rules.limit} 模板=${s.rules.template}`,
      `队列/已点/日志: ${s.songs.length}/${s.played.length}/${s.logs.length}`,
      "--- 日志 ---",
      ...s.logs
    ];
    await copy(lines.join("\n"));
  };
  const addManual = () => { if (manual().trim()) { void act("board.manual", manual()); manual.set(""); } };
  const platformName = () => state().platform === "kugou-web" ? "酷狗" : state().platform === "netease-web" ? "网易云" : "平台";
  const addHint = (song: Song) => {
    if (song.uncertain) return "请先在歌单中核对上次加入结果";
    if (state().addingSong === song.id) return "正在加入歌单…";
    if (state().busy) return "正在处理歌单操作…";
    if (!song.match || song.match === "pending" || song.match === "retry") return "正在" + platformName() + "查找…";
    if (song.match === "not_found") return platformName() + "未找到这首歌";
    if (song.match === "error") return platformName() + "搜索失败，可手动搜索";
    if (!boundPlaylist()) return "请先选择与输入名称一致的歌单，或开启自动同步";
    if (!song.canAdd) return song.detail.startsWith("黑名单") ? song.detail : "请先在歌单中核对上次加入结果";
    return "加入歌单：" + song.matched;
  };
  const playingHistory = () => tab() === "played";
  return (
    <View testID="workbench" class="min-h-0 flex-1 overflow-hidden bg-background">
      <View testID="app-header" class="h-[52px] shrink-0 flex-row items-center gap-3 border-b border-line bg-card px-4">
        <Image src={logo} alt="SUSUSongBoard" class="size-10 shrink-0 rounded-[4px]" />
        <If when={!narrow()}><Text class="text-sm font-semibold text-foreground">SUSUSongBoard</Text></If>
        <View class="flex-row items-center gap-[7px] rounded-[6px] border border-line bg-secondary px-2.5 py-1">
          <View class="size-[7px] rounded-full" classList={{ "bg-success": state().connection === "已连接", "bg-[#fbbf24]": state().running && state().connection !== "已连接", "border border-border": !state().running }} />
          <Text testID="connection" class="text-[11px] text-muted-foreground">{state().connection}</Text>
        </View>
        <View class="flex-1" />
        <View class="flex-row items-center gap-1">
          <IconAction label={colorScheme() === "dark" ? "切换亮色" : "切换暗色"} icon={colorScheme() === "dark" ? "sun" : "moon"} testID="theme-toggle" onPress={() => { const next = colorScheme() === "dark" ? "light" : "dark"; themeMode.set(next); setColorScheme(next); }} />
          <IconAction label="设置" icon="settings" testID="settings" onPress={() => openSettings("general")} />
          <View class="ml-2"><IconAction label={state().running ? "停止" : "开始"} icon={state().running ? "stop" : "play"} appearance={state().running ? "stop" : "start"} testID={state().running ? "stop" : "connect"}
            onPress={() => void act(state().running ? "board.stop" : "board.connect", draftRules().room)} disabled={!ready()} /></View>
        </View>
      </View>
      <If when={narrow()}><View class="shrink-0 bg-card p-2"><Action label={configOpen() ? "收起配置" : "配置"} onPress={() => configOpen.set(!configOpen())} /></View></If>
      <View class="min-h-0 flex-1" classList={{ "flex-row": !narrow() }}>
        <If when={!narrow() || configOpen()}>
          <Scroll testID="room-sidebar" class="shrink-0 border-r border-line bg-card" style={{ width: narrow() ? "100%" : 288, maxHeight: narrow() ? 280 : "100%" }}>
            <View class="gap-3 border-b border-line p-4">
              <Text class="text-[13px] font-medium text-foreground">直播间配置</Text>
              <Field label="抖音直播间 ID" testID="room" value={draftRules().room} onChange={(value) => patchRule("room", value)} disabled={state().running} />
              <Field label="点歌指令模板" testID="sing-prefix" value={draftRules().template} onChange={(value) => patchRule("template", value)} disabled={state().running}
                hint={"[song] 或 [歌曲]：歌曲名\n[space] 或 [空格]：空格\n点歌[space][song] → 点歌 七里香"} />
            </View>
            <View class="gap-3 border-b border-line p-4">
              <Text class="text-[13px] font-medium text-foreground">点歌规则</Text>
              <View class="flex-row gap-3">
                <Field label="最低粉丝团等级" testID="fans-level" value={String(draftRules().fans)} onChange={(value) => patchRule("fans", Number(value))} />
                <Field label="点歌冷却 (秒)" testID="sing-cooldown" value={String(draftRules().cooldown)} onChange={(value) => patchRule("cooldown", Number(value))} />
              </View>
              <Field label="重复点歌冷却 (秒)" testID="repeat-cooldown" value={String(draftRules().repeat)} onChange={(value) => patchRule("repeat", Number(value))} />
              <Field label="单人单场点歌上限" testID="max-songs" value={String(draftRules().limit)} onChange={(value) => patchRule("limit", Number(value))} />
              <Text class="text-[11px] text-faint">按本场成功加入歌单的记录计算，0 表示不限制。</Text>
            </View>
            <If when={state().platform && state().verified}><PlaylistControls state={state()} act={act} notify={notify} name={playlistName()} bound={boundPlaylist()} setName={setPlaylistName} /></If>
            <If when={state().platform && !state().verified}><View class="gap-2 border-b border-line p-4"><Text class="text-xs text-muted-foreground">请在设置 → 插件中登录{platformName()}。</Text></View></If>
            <If when={!!state().platform} else={<View class="gap-2 p-4"><Text class="text-[13px] font-medium text-foreground">仅弹幕监听</Text><Text class="text-xs text-muted-foreground">连接直播间后收集点歌指令；在设置 → 插件里启用平台后显示歌单、匹配与手动点歌。</Text></View>}>
            <View class="gap-3 p-4">
              <Text class="text-[13px] font-medium text-foreground">手动点歌</Text>
              <View class="flex-row gap-2">
                <Input testID="manual-song" accessibilityLabel="手动点歌" placeholder="输入歌曲名称..." value={manual()} onChange={({ value }) => manual.set(value)} onSubmit={addManual}
                  class="h-8 min-w-0 flex-1 rounded-[4px] border border-border bg-background px-2 text-sm text-foreground" />
                <Action label="添加" testID="manual-add" onPress={addManual} />
              </View>
            </View>
            </If>
            <View class="px-4 pb-4 pt-1"><Text class="text-[11px] text-faint">SUSUSongBoard v{state().version}</Text></View>
          </Scroll>
        </If>
        <View class="min-h-0 min-w-0 flex-1 bg-card">
            <View testID="workbench-tabs" role="tablist" class="shrink-0 flex-row items-center gap-1 border-b border-line px-3 py-1">
              <Each of={[{ key: "songs", label: "点歌列表", count: state().songs.length }, { key: "played", label: "已点歌单", count: state().played.length }, { key: "blacklist", label: "黑名单", count: (state().blacklist || []).length }]} key={(item) => item.key}>
                {(item) => <View role="tab" testID={"tab-"+item().key} selected={tab() === item().key} onPress={() => { tab.set(item().key); confirm.set(""); songMenu.set(""); }}
                  class="h-9 flex-row items-center justify-center border-b-2 border-transparent px-3" classList={{ "border-foreground": tab() === item().key }}>
                  <Text class="text-sm font-medium" classList={{ "text-foreground": tab() === item().key, "text-muted-foreground": tab() !== item().key }}>{item().label} ({item().count})</Text>
                </View>}
              </Each>
              <If when={tab() !== "blacklist" && (playingHistory() ? state().played.length > 0 : state().songs.length > 0)}>
                <View class="flex-1" />
                <IconAction label={confirm() === tab() ? "确认清空" : "清空列表"} icon="trash" testID={tab() === "songs" ? "clear-queue" : "clear-played"} danger={confirm() === tab()}
                  onPress={() => { if (confirm() === tab()) { void act(tab() === "songs" ? "board.clearQueue" : "board.clearPlayed"); confirm.set(""); songMenu.set(""); } else confirm.set(tab()); }} />
              </If>
            </View>
            <If when={tab() === "blacklist"} else={<>
              <If when={playingHistory() && state().played.length > 0}>
                <View class="flex-row items-center gap-2 border-b border-line px-3 py-1.5">
                  <Icon name="search" size={14} color={token("faint")} />
                  <Input testID="played-query" accessibilityLabel="搜索已点歌曲" placeholder="搜索歌曲名或用户…" value={search()} onChange={({ value }) => search.set(value)} class="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs text-foreground" />
                  <If when={!!search()}><IconAction compact label="清除搜索" icon="close" onPress={() => search.set("")} /></If>
                </View>
              </If>
              <If when={visibleSongs().length > 0}>
                <View class="h-8 shrink-0 flex-row items-center border-b border-line bg-secondary">
                  <View class="w-10 items-end pr-3"><Text class="text-xs font-medium text-muted-foreground">#</Text></View>
                  <If when={!narrow() && playingHistory()}><Text class="w-20 px-2 text-xs font-medium text-muted-foreground">时间</Text></If>
                  <If when={!narrow()}><Text class="px-2 text-xs font-medium text-muted-foreground" style={{ width: playingHistory() ? 110 : 120 }}>用户</Text></If>
                  <Text class="flex-1 px-2 text-xs font-medium text-muted-foreground">点歌</Text>
                  <If when={!narrow() && !playingHistory()}><Text class="w-[72px] px-2 text-xs font-medium text-muted-foreground">时间</Text></If>
                  <View style={{ width: playingHistory() ? 48 : 110 }} />
                </View>
              </If>
              <List testID={playingHistory() ? "played-queue" : "song-queue"} each={visibleSongs()} keyExtractor={(song) => song.id} estimatedItemSize={48} class="min-h-0 flex-1"
                empty={<View class="items-center gap-1 px-6 py-16"><Text class="text-sm font-medium text-muted-foreground">{playingHistory() ? (search() ? "没有匹配的歌曲" : "暂无已点歌曲") : state().running ? "等待点歌..." : "当前点歌列表为空"}</Text><If when={!playingHistory()}><Text class="text-xs text-faint">{state().running ? "正在监听直播间弹幕" : "观众点歌后会显示在这里"}</Text></If></View>}>
                {(song, index) => <View testID={"song-"+song().id} class="h-12 flex-row items-center border-b border-line hover:bg-secondary">
                  <View class="w-10 items-end pr-3"><Text class="text-xs text-faint">{index()+1}</Text></View>
                  <If when={!narrow() && playingHistory()}><Text class="w-20 px-2 text-xs text-faint">{song().time}</Text></If>
                  <If when={!narrow()}><View class="flex-row items-center gap-1 px-2" style={{ width: playingHistory() ? 110 : 120 }}><Text class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{song().user || "?"}</Text><If when={song().quota}><Tooltip testID={"quota-"+song().id+"-help"} placement="top" popupClass="max-w-[280px] rounded-[6px] bg-foreground px-2 py-1" trigger={<View focusable accessibilityLabel="本场已成功加入歌单数量"><Text class="rounded bg-secondary px-1 text-[10px] text-faint">{song().quota}</Text></View>}><Text class="text-xs text-background">本场已成功加入歌单 {song().quota}</Text></Tooltip></If></View></If>
                  <View testID={"menu-"+song().id} accessibilityLabel="歌曲操作" class="min-w-0 flex-1 px-2"
                    onContextMenu={(event) => { menuPoint.set({ x: event.pagePosition.x, y: event.pagePosition.y }); songMenu.set(song().id); }}>
                    <Text class="truncate text-[13px] font-medium text-foreground">{song().name}</Text>
                    <If when={song().detail}><Text class="truncate text-[11px] text-faint">{song().detail}</Text></If>
                  </View>
                  <If when={!narrow() && !playingHistory()}><Text class="w-[72px] px-2 text-xs text-faint">{song().time}</Text></If>
                  <View class="shrink-0 flex-row items-center justify-end gap-1 px-2" style={{ width: playingHistory() ? 48 : 110 }}>
                    <If when={!playingHistory() && state().verified}><IconAction compact label="加入歌单" hint={addHint(song())}
                      icon={state().addingSong === song().id || !song().match || song().match === "pending" || song().match === "retry" ? "loader" : "list-plus"}
                      testID={"add-"+song().id} disabled={!song().canAdd || !boundPlaylist()} locked={state().busy}
                      onPress={() => void act("platform.add", { song: song().id, name: playlistName(), id: state().target.id })} /></If>
                    <IconAction compact label="复制歌名" icon="copy" testID={"copy-"+song().id} onPress={() => void copy(song().name)} />
                    <If when={!playingHistory()}><IconAction compact label="移除歌曲" hint="删除" icon="trash" testID={"remove-"+song().id} onPress={() => void act("board.remove", song().id)} /></If>
                  </View>
                </View>}
              </List>
            </>}>
              <BlacklistPanel entries={state().blacklist || []} narrow={narrow()} onAdd={(entry) => void act("board.blacklist", entry)}
                onRemove={(entry) => void act("board.blacklist", { kind: entry.kind, name: entry.name, remove: true })} />
            </If>
          <If when={state().showLogs && (state().logs || []).length > 0}>
            <LogPanel lines={state().logs || []} onCopy={() => void copyDiagnostics()} onClear={() => void act("board.clearLogs")} />
          </If>
        </View>
      </View>
      <SessionFooter queued={state().songs.length} played={state().played.length} running={state().running} connected={state().connection === "已连接"}
        platform={state().platform ? platformName() : ""} verified={state().verified} narrow={narrow()} />
      <Dialog open={settings()} testID="settings-dialog" accessibilityLabel="设置" bare onOpenChange={({ open }) => { if (!open) closeSettings(); }} style={{ width: Math.min(560, windowSize().width - 32), height: Math.min(620, windowSize().height - 64) }}>
        <View class="h-12 shrink-0 flex-row items-center justify-between border-b border-line bg-card px-4"><Text class="text-base font-semibold text-foreground">设置</Text><IconAction label="关闭设置" icon="close" testID="close-settings" onPress={closeSettings} /></View>
        <View role="tablist" class="shrink-0 flex-row border-b border-line bg-card px-4">
          <Each of={[{ key: "general", label: "常规" }, { key: "plugin", label: "插件" }, { key: "about", label: "关于" }]} key={(item) => item.key}>
            {(item) => <View role="tab" selected={settingsTab() === item().key} testID={"settings-"+item().key} onPress={() => { resetConfirm.set(false); settingsTab.set(item().key); }} class="h-9 justify-center border-b-2 border-transparent px-3" classList={{ "border-foreground": settingsTab() === item().key }}><Text class="text-xs text-foreground">{item().label}</Text></View>}
          </Each>
        </View>
        <If when={settingsTab() === "plugin"}><Platforms state={state()} act={act} /></If>
        <If when={settingsTab() === "general"}><Scroll class="min-h-0 flex-1 bg-card p-4"><View class="gap-4">
          <Text class="text-[13px] font-semibold text-foreground">外观</Text>
          <View class="flex-row gap-2"><Each of={[{ key: "system", label: "跟随系统" }, { key: "light", label: "亮色" }, { key: "dark", label: "暗色" }]} key={(mode) => mode.key}>{(mode) => <Action label={(themeMode() === mode().key ? "✓ " : "")+mode().label} onPress={() => { themeMode.set(mode().key); setColorScheme(mode().key as "light" | "dark" | "system"); }} />}</Each></View>
          <View class="h-px bg-line" /><View class="flex-row items-center gap-3"><Text class="flex-1 text-sm text-foreground">显示日志面板</Text><Action label={state().showLogs ? "已显示" : "已隐藏"} testID="settings-show-logs" onPress={() => void act("board.showLogs", !state().showLogs)} /></View>
          <Text class="text-xs text-muted-foreground">直播间 ID：{draftRules().room || "—"}</Text><Text class="text-xs text-muted-foreground">版本：v{state().version}</Text>
          <Action label="前往插件设置" testID="go-plugin" onPress={() => settingsTab.set("plugin")} />
          <View class="h-px bg-line" />
          <View class="gap-2">
            <Text class="text-[13px] font-semibold text-foreground">本次会话</Text>
            <If when={resetConfirm()} else={<View class="items-start"><Action label="重置会话" testID="reset-session" locked={state().busy} onPress={() => resetConfirm.set(true)} /></View>}>
              <Text class="text-xs text-muted-foreground">停止监听和自动同步，并清空本次点歌列表、已点歌单和日志。账号、平台歌单和黑名单不受影响。</Text>
              <View class="flex-row gap-2"><Action label="取消" testID="cancel-reset-session" onPress={() => resetConfirm.set(false)} />
                <Action label="确认重置" testID="confirm-reset-session" locked={state().busy} danger onPress={() => { resetConfirm.set(false); void act("board.reset"); }} />
              </View>
            </If>
          </View>
        </View></Scroll></If>
        <If when={settingsTab() === "about"}><View class="flex-1 gap-3 bg-card p-4"><View class="flex-row items-center gap-3"><Image src={logo} class="size-10 rounded" /><View class="gap-1"><Text class="text-sm font-semibold text-foreground">SUSUSongBoard</Text><Text testID="app-version" class="text-xs text-faint">v{state().version}</Text></View></View><View class="h-px bg-line" /><Text class="text-xs text-muted-foreground">抖音直播间点歌看板，收集弹幕点歌，支持同步到酷狗音乐或网易云音乐歌单。</Text>
          <If when={state().updatesEnabled} else={<Text testID="updates-unavailable" class="text-xs text-faint">此版本不支持自动升级，请手动安装新版。</Text>}>
            <View class="flex-row items-center gap-2"><Action label="检查更新" testID="check-update" icon="refresh" onPress={() => void act("board.checkUpdate")} /><Text class="flex-1 text-xs text-faint">安装更新会重启应用，本次点歌列表和日志不会保留。</Text></View>
          </If>
        </View></If>
      </Dialog>
      <If when={!!songMenu()}><SongMenuOverlay state={state()} act={act} name={playlistName()} bound={boundPlaylist()} songID={songMenu()} point={menuPoint()} copy={copy}
        close={() => songMenu.set("")} openSearch={(id) => { songMenu.set(""); songSearch.set(id); }} /></If>
      <If when={!!songSearch()}><SongSearchDialog state={state()} songID={songSearch()} act={act} name={playlistName()} bound={boundPlaylist()} copy={copy} close={() => songSearch.set("")} /></If>
      <Toasts ref={toasts.set} testID="notification-toasts" placement="bottomEnd" closeAccessibilityLabel="关闭通知" />
    </View>
  );
}

mount(App);
