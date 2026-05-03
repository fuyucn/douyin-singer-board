import { useAppStore } from '../store';

export function ConnectionStatus() {
  const connected = useAppStore((s) => s.status.connected);
  const running = useAppStore((s) => s.running);
  const connecting = running && !connected;

  let dotClass: string;
  let textClass: string;
  let label: string;

  if (connecting) {
    dotClass = 'bg-amber-400 border-amber-400 border animate-pulse';
    textClass = 'text-amber-500';
    label = '连接中';
  } else if (connected) {
    dotClass = 'bg-success border-success border';
    textClass = 'text-success';
    label = '已连接';
  } else {
    dotClass = 'border-border-strong border bg-transparent';
    textClass = 'text-fg-faint';
    label = '未连接';
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap ${textClass}`}
    >
      <div className={`${dotClass} size-2.5 rounded-full`} />
      {label}
    </span>
  );
}
