import { List, mount, Scroll, signal, Text, View } from "nsgo";
import { Input } from "nsgo/base";
import { Tabs, IconButton } from "nsgo/ui";

type DemoSong = { id: string; song: string; user: string; time: string; source: string };

const sampleSongs: DemoSong[] = [
  { id: "1", song: "七里香", user: "晴天", time: "20:18:24", source: "弹幕" },
  { id: "2", song: "稻香", user: "小鹿", time: "20:18:41", source: "弹幕" },
  { id: "3", song: "晴天", user: "主播", time: "20:19:02", source: "手动" },
];

function Caption(props: { text: string }) {
  return <Text class="text-xs text-[#59616e]">{props.text}</Text>;
}

function Field(props: { label: string; value: string; placeholder?: string; testID: string }) {
  return (
    <View class="gap-1.5">
      <If when={props.label !== ""}><Caption text={props.label} /></If>
      <Input
        testID={props.testID}
        value={props.value}
        placeholder={props.placeholder}
        class="h-8 rounded-[4px] border border-input bg-background px-2.5 text-sm text-foreground"
        onChange={() => {}}
      />
    </View>
  );
}

function Sidebar() {
  return (
    <Scroll class="w-72 shrink-0 border-r border-border bg-card">
      <View class="gap-0">
        <View class="gap-3 p-4">
          <Text class="text-[13px] font-medium text-foreground">直播间配置</Text>
          <Field label="抖音直播间 ID" value="145997388006" testID="room" />
          <Field label="点歌指令模板" value="点歌[space][song]" testID="template" />
        </View>
        <View class="h-px bg-border" />
        <View class="gap-3 p-4">
          <Text class="text-[13px] font-medium text-foreground">点歌规则</Text>
          <View class="flex-row gap-3">
            <View class="flex-1"><Field label="最低粉丝团等级" value="0" testID="fan-level" /></View>
            <View class="flex-1"><Field label="点歌冷却 (秒)" value="0" testID="cooldown" /></View>
          </View>
          <Field label="重复点歌冷却 (秒)" value="1800" testID="duplicate-cooldown" />
          <Text class="text-[11px] leading-4 text-[#88919f]">同一首歌在冷却时间内不会重复加入歌单</Text>
          <Field label="单人单场点歌上限" value="3" testID="per-user-limit" />
          <Text class="text-[11px] leading-4 text-[#88919f]">每位观众本场最多自动点歌的首数</Text>
        </View>
        <View class="h-px bg-border" />
        <View class="gap-3 p-4">
          <Text class="text-[13px] font-medium text-foreground">手动点歌</Text>
          <Field label="" value="" placeholder="输入歌曲名称..." testID="manual-song" />
          <View class="self-start rounded-[4px] border border-border px-3 py-1.5">
            <Text class="text-xs text-foreground">添加</Text>
          </View>
        </View>
        <View class="p-4 pt-0">
          <Text class="text-[11px] text-[#88919f]">SUSUSongBoard NSGo Preview</Text>
        </View>
      </View>
    </Scroll>
  );
}

function QueueRow(props: { song: DemoSong; index: number }) {
  return (
    <View class="group flex-row items-center gap-3 border-t border-line px-3 py-2 first:border-t-0 hover:bg-secondary">
      <Text class="w-8 text-right font-mono text-xs text-[#88919f]">{String(props.index + 1).padStart(2, "0")}</Text>
      <Text class="w-28 truncate text-xs text-[#59616e]">{props.song.user}</Text>
      <View class="min-w-0 flex-1 gap-0.5">
        <Text class="truncate text-[13px] font-medium text-foreground">{props.song.song}</Text>
        <Text class="text-[11px] text-[#59616e]">{props.song.source}</Text>
      </View>
      <Text class="font-mono text-[11px] text-[#88919f]">{props.song.time}</Text>
      <View class="rounded px-2 py-1 opacity-60 hover:bg-secondary">
        <Text class="text-xs text-[#59616e]">⋯</Text>
      </View>
    </View>
  );
}

function QueuePanel() {
  return (
    <View class="min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <View class="flex-row items-center justify-between border-b border-border px-3 py-1.5">
        <Text class="text-xs font-medium text-[#59616e]">点歌列表 (3)</Text>
        <View class="rounded px-2 py-1 hover:bg-secondary"><Text class="text-xs text-[#59616e]">清空列表</Text></View>
      </View>
      <View class="flex-row items-center gap-3 border-b border-line bg-secondary px-3 py-1.5">
        <Text class="w-8 text-right text-[11px] text-[#88919f]">#</Text>
        <Text class="w-28 text-[11px] text-[#88919f]">用户</Text>
        <Text class="flex-1 text-[11px] text-[#88919f]">点歌</Text>
        <Text class="w-16 text-[11px] text-[#88919f]">时间</Text>
        <Text class="w-8 text-[11px] text-[#88919f]"></Text>
      </View>
      <List
        testID="songs-table"
        each={sampleSongs}
        keyExtractor={(song) => song.id}
        estimatedItemSize={50}
        class="min-h-0 flex-1"
      >
        {(song, index) => <QueueRow song={song()} index={index()} />}
      </List>
      <View class="mt-auto flex-row items-center gap-4 border-t border-border px-4 py-1.5">
        <Text class="text-xs text-[#59616e]">队列 <Text class="text-foreground">3</Text></Text>
        <Text class="text-xs text-[#59616e]">总数 <Text class="text-foreground">3</Text></Text>
        <View class="flex-1" />
        <View class="flex-row items-center gap-1.5"><View class="size-1.5 rounded-full bg-success" /><Caption text="已连接" /></View>
      </View>
    </View>
  );
}

function LogPanel() {
  const open = signal(false);
  return (
    <View class="shrink-0 border-t border-border bg-card">
      <View testID="log-toggle" onPress={() => open.set(!open())} class="flex-row items-center gap-2 bg-secondary px-3 py-1.5">
        <Text class="text-xs font-medium text-[#59616e]">日志</Text>
        <Text class="rounded bg-muted px-1.5 text-[10px] text-[#88919f]">4</Text>
        <View class="flex-1" />
        <Text class="text-xs text-[#59616e]">复制</Text>
        <Text class="text-xs text-[#59616e]">清空</Text>
        <Text class="ml-1 text-[#88919f]">{open() ? "⌃" : "⌄"}</Text>
      </View>
      <If when={open()}>
        <Scroll class="max-h-36 bg-background px-2 py-1">
          <View class="gap-1 py-1">
            <Text class="font-mono text-[11px] text-success">20:18:10  已连接抖音直播间</Text>
            <Text class="font-mono text-[11px] text-[#59616e]">20:18:24  晴天: 点歌 七里香</Text>
            <Text class="font-mono text-[11px] text-[#59616e]">20:18:41  小鹿: 点歌 稻香</Text>
            <Text class="font-mono text-[11px] text-[#59616e]">20:19:02  主播手动添加 晴天</Text>
          </View>
        </Scroll>
      </If>
    </View>
  );
}

function App() {
  const tab = signal("songs");
  const tabs = [
    { value: "songs", label: "点歌列表 (3)" },
    { value: "played", label: "已点歌单 (0)" },
    { value: "blacklist", label: "黑名单 (0)" },
  ];
  return (
    <View class="flex-1 flex-col overflow-hidden bg-background font-sans text-foreground">
      <View class="h-[52px] shrink-0 flex-row items-center gap-2 border-b border-line bg-card px-3">
        <Text class="text-sm font-semibold text-foreground">SUSUSongBoard</Text>
        <View class="flex-row items-center gap-[7px] rounded-[6px] border border-line bg-secondary px-2.5 py-1">
          <View class="size-[7px] rounded-full bg-success" />
          <Text class="text-[11px] text-[#59616e]">已连接</Text>
        </View>
        <View class="flex-1" />
        <IconButton icon="play" accessibilityLabel="开始监听" testID="start-listening" />
      </View>
      <View class="min-h-0 flex-1 flex-row">
        <Sidebar />
        <View class="min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
          <View class="shrink-0 flex-row items-center justify-between border-b border-border px-3 py-1">
            <Tabs
              testID="workbench-tabs"
              accessibilityLabel="歌曲列表"
              options={tabs}
              value={tab()}
              onChange={({ value }) => tab.set(value)}
              variant="underline"
              size="small"
            />
            <If when={tab() === "songs"}>
              <View class="rounded px-2 py-1 hover:bg-secondary"><Text class="text-xs text-[#59616e]">清空列表</Text></View>
            </If>
          </View>
          <If when={tab() === "songs"}><QueuePanel /></If>
          <If when={tab() === "played"}>
            <View class="flex-1 items-center justify-center"><Text class="text-xs text-[#88919f]">暂无已点歌曲</Text></View>
          </If>
          <If when={tab() === "blacklist"}>
            <View class="flex-1 items-center justify-center"><Text class="text-xs text-[#88919f]">黑名单功能尚未迁移</Text></View>
          </If>
          <LogPanel />
        </View>
      </View>
    </View>
  );
}

mount(App);
