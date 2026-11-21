import { List, Scroll, signal, Text, token, View } from "nsgo";
import { Input } from "nsgo/base";
import { Icon } from "nsgo/ui";
import { Action, IconAction } from "./Controls";

export type BlacklistEntry = { kind: "song" | "singer"; name: string; artist?: string; addedAt?: string };

export function BlacklistPanel(props: { entries: BlacklistEntry[]; narrow: boolean; onAdd: (entry: BlacklistEntry) => void; onRemove: (entry: BlacklistEntry) => void }) {
  const kind = signal<BlacklistEntry["kind"]>("song");
  const name = signal("");
  const add = () => {
    const value = name().trim();
    if (!value) return;
    props.onAdd({ kind: kind(), name: value });
    name.set("");
  };
  return <View testID="blacklist-panel" class="min-h-0 flex-1">
    <View class="shrink-0 flex-row items-center gap-2 border-b border-line px-3 py-2">
      <View class="flex-row gap-1" role="tablist" accessibilityLabel="黑名单类型">
        <Each of={[{ key: "song" as const, label: "歌曲" }, { key: "singer" as const, label: "歌手" }]} key={(item) => item.key}>{(item) =>
          <View testID={"blacklist-type-"+item().key} role="tab" selected={kind() === item().key} onPress={() => kind.set(item().key)}
            class="h-8 justify-center rounded-[6px] px-2" classList={{ "bg-accent": kind() === item().key, "border border-border hover:bg-secondary": kind() !== item().key }}>
            <Text class="text-[11px]" classList={{ "text-accent-text": kind() === item().key, "text-foreground": kind() !== item().key }}>{item().label}</Text>
          </View>
        }</Each>
      </View>
      <Input testID="blacklist-name" accessibilityLabel="黑名单名称" value={name()} onChange={({ value }) => name.set(value)} onSubmit={add}
        placeholder={kind() === "song" ? "输入歌曲名…" : "输入歌手名…"} class="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2.5 text-sm text-foreground" />
      <IconAction label="加入黑名单" icon="plus" testID="blacklist-add" disabled={!name().trim()} onPress={add} />
    </View>
    <If when={props.entries.length > 0}>
      <View testID="blacklist-columns" class="h-8 shrink-0 flex-row items-center border-b border-line bg-secondary px-4">
        <Text class="w-12 text-xs font-medium text-muted-foreground">类型</Text>
        <Text class="min-w-0 flex-1 text-xs font-medium text-muted-foreground">歌曲名</Text>
        <Text class="text-xs font-medium text-muted-foreground" style={{ width: props.narrow ? 84 : 112 }}>歌手</Text>
        <If when={!props.narrow}><Text class="w-24 text-right text-xs font-medium text-muted-foreground">添加时间</Text></If>
        <View class="w-10" />
      </View>
    </If>
    <List each={props.entries} keyExtractor={(entry) => entry.kind+":"+entry.name} estimatedItemSize={40} class="min-h-0 flex-1"
      empty={<View class="items-center gap-2 px-4 py-16"><Text class="text-sm text-faint">黑名单为空</Text><Text class="text-xs text-faint">右键点歌列表可添加歌曲／歌手</Text></View>}>
      {(entry) => <View class="h-10 flex-row items-center border-b border-line px-4 hover:bg-secondary">
        <View class="w-12 flex-row"><View class="rounded bg-secondary px-1.5 py-0.5"><Text class="text-[11px] font-medium text-muted-foreground">{entry().kind === "song" ? "歌曲" : "歌手"}</Text></View></View>
        <Text class="min-w-0 flex-1 truncate text-sm text-foreground">{entry().kind === "singer" ? "全部歌曲" : entry().name}</Text>
        <Text class="truncate text-xs text-muted-foreground" style={{ width: props.narrow ? 84 : 112 }}>{entry().kind === "singer" ? entry().name : entry().artist || "—"}</Text>
        <If when={!props.narrow}><Text class="w-24 text-right text-xs text-faint">{entry().addedAt || "—"}</Text></If>
        <View class="w-10 items-end"><IconAction compact danger label="移出黑名单" icon="close" onPress={() => props.onRemove(entry())} /></View>
      </View>}
    </List>
  </View>;
}

export function LogPanel(props: { lines: string[]; onCopy: () => void; onClear: () => void }) {
  const open = signal(false);
  const toggle = () => open.set(!open());
  const levelOf = (line: string) => {
    const rest = line.slice(8).trimStart();
    const split = rest.indexOf("  ");
    return split < 0 ? "INFO" : rest.slice(0, split);
  };
  const messageOf = (line: string) => {
    const rest = line.slice(8).trimStart();
    const split = rest.indexOf("  ");
    return split < 0 ? rest : rest.slice(split).trimStart();
  };
  return <View testID="log-panel" class="shrink-0 border-t border-line bg-card">
    <View class="flex-row items-center gap-1 bg-secondary px-3 py-1">
      <View role="button" accessibilityLabel={open() ? "收起日志" : "展开日志"} onPress={toggle} class="min-w-0 flex-1 flex-row items-center gap-2 py-1">
        <Text class="text-xs font-medium text-muted-foreground">日志</Text>
        <View class="rounded bg-muted px-1.5"><Text testID="log-count" class="font-mono text-[10px] text-faint">{props.lines.length}</Text></View>
      </View>
      <Action subtle label="复制诊断" icon="copy" testID="log-copy" onPress={props.onCopy} />
      <Action subtle label="清空" icon="trash" testID="clear-logs" danger onPress={props.onClear} />
      <IconAction compact label={open() ? "收起日志" : "展开日志"} icon={open() ? "up" : "down"} testID="log-toggle" onPress={toggle} />
    </View>
    <If when={open()}><Scroll testID="messages" class="max-h-[220px] bg-background">
      <Each of={props.lines}>{(line) => <View class="flex-row items-baseline border-b border-line px-3 py-1 hover:bg-secondary">
        <Text class="w-[52px] shrink-0 text-right font-mono text-[10px] text-faint">{line().slice(0, 8)}</Text>
        <Text class="w-[42px] shrink-0 pl-2 font-mono text-[10px]" classList={{
          "text-faint": levelOf(line()) === "DEBUG",
          "text-muted-foreground": levelOf(line()) === "INFO",
          "font-semibold text-foreground": levelOf(line()) === "WARN",
          "font-semibold text-destructive": levelOf(line()) === "ERROR"
        }}>{levelOf(line())}</Text>
        <Text class="min-w-0 flex-1 pl-2 text-[11px] text-muted-foreground">{messageOf(line())}</Text>
      </View>}</Each>
    </Scroll></If>
  </View>;
}

function Readiness(props: { label: string; ready: boolean; testID: string }) {
  return <View testID={props.testID} class="flex-row items-center gap-1.5">
    <If when={props.ready} else={<View class="size-2 shrink-0 rounded-full bg-faint" />}><Icon name="check" size={12} color={token("success")} /></If>
    <Text class="text-[11px]" classList={{ "text-success": props.ready, "text-faint": !props.ready }}>{props.label}</Text>
  </View>;
}

export function SessionFooter(props: { queued: number; played: number; running: boolean; connected: boolean; platform: string; verified: boolean; narrow: boolean }) {
  return <View testID="status-footer" class="min-h-8 shrink-0 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-1.5" style={{ paddingLeft: props.narrow ? 12 : 20, paddingRight: props.narrow ? 12 : 20 }}>
    <If when={props.running || props.queued + props.played > 0}>
      <View class="flex-row items-center gap-4">
        <Text testID="queue-count" class="text-xs text-muted-foreground">队列 {props.queued}</Text>
        <Text class="text-xs text-muted-foreground">已点 {props.played}</Text>
        <Text testID="session-total" class="text-xs text-muted-foreground">总数 {props.queued + props.played}</Text>
      </View>
    </If>
    <View class="ml-auto flex-row items-center gap-4">
      <Readiness label={props.narrow ? "抖音直播间" : "连接抖音直播间"} ready={props.connected} testID="live-readiness" />
      <Readiness label={!props.platform ? "未启用平台插件" : props.platform + (props.verified ? "已登录" : "未登录")} ready={props.verified} testID="platform-readiness" />
    </View>
  </View>;
}
