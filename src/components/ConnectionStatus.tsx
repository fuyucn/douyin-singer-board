import { useAppStore } from '../store';

export function ConnectionStatus() {
  const connected = useAppStore((s) => s.status.connected);
  const running = useAppStore((s) => s.running);
  const connecting = running && !connected;

  let dotClass: string;
  let label: string;

  if (connecting) {
    dotClass = 'bg-amber-400';
    label = '连接中';
  } else if (connected) {
    dotClass = 'bg-success';
    label = '已连接';
  } else {
    dotClass = 'border border-[var(--border-strong)] bg-transparent';
    label = '未连接';
  }

  return (
    <span
      className="text-fg-muted inline-flex shrink-0 items-center gap-[7px] rounded-[6px] border border-[var(--border-soft)] bg-[var(--bg-soft)] px-[10px] py-[4px] text-[11px] whitespace-nowrap"
    >
      <span className={`size-[7px] shrink-0 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}
