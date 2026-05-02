import type { Config } from '../types';

interface Props {
  config: Config;
  running: boolean;
  onConfigChange: (patch: Partial<Config>) => void;
  onStart: () => void;
  onStop: () => void;
}

const inputCls =
  'py-1.5 px-2.5 border border-border-strong rounded bg-bg-base text-fg-base disabled:bg-bg-disabled disabled:text-fg-faint';

function Label({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 basis-0 flex-col gap-1">
      <span className="text-fg-muted text-xs">{label}</span>
      {children}
    </label>
  );
}

export function ConfigSection({ config, running, onConfigChange, onStart, onStop }: Props) {
  return (
    <section className="border-border-soft bg-bg-elev flex items-end gap-3 border-b px-5 py-3">
      <Label label="抖音直播间 ID">
        <input
          className={inputCls}
          type="text"
          value={config.room_id}
          disabled={running}
          onChange={(e) => onConfigChange({ room_id: e.target.value })}
          placeholder="例如 221321076494"
        />
      </Label>
      <Label label="点歌指令模板">
        <input
          className={inputCls}
          type="text"
          value={config.sing_prefix}
          disabled={running}
          onChange={(e) => onConfigChange({ sing_prefix: e.target.value })}
          placeholder="点歌[space][song]"
          title="Placeholders: [space]=whitespace, [song]=song name"
        />
      </Label>
      <Label label="最低粉丝团等级">
        <input
          className={inputCls}
          type="number"
          min={0}
          value={config.fans_level}
          disabled={running}
          onChange={(e) => onConfigChange({ fans_level: Number(e.target.value) || 0 })}
        />
      </Label>
      <Label label="点歌冷却 (秒)">
        <input
          className={inputCls}
          type="number"
          min={0}
          value={config.sing_cd}
          disabled={running}
          onChange={(e) => onConfigChange({ sing_cd: Math.max(0, Number(e.target.value) || 0) })}
        />
      </Label>
      {!running ? (
        <button
          className="bg-success hover:bg-success-hover shrink-0 cursor-pointer rounded border-none px-6 py-2 font-medium text-white"
          onClick={onStart}
        >
          开始
        </button>
      ) : (
        <button
          className="bg-danger hover:bg-danger-hover shrink-0 cursor-pointer rounded border-none px-6 py-2 font-medium text-white"
          onClick={onStop}
        >
          停止
        </button>
      )}
    </section>
  );
}
