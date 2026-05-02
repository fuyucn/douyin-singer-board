import { useAppStore } from '../store';

export function ConnectionStatus() {
  const connected = useAppStore((s) => s.status.connected);
  const message = useAppStore((s) => s.status.message);

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${connected ? 'text-success' : 'text-fg-faint'}`}
    >
      <div
        className={`${connected ? 'bg-success border-success border' : 'border-border-strong border bg-transparent'} size-3 rounded-full`}
      ></div>
      {message}
    </span>
  );
}
