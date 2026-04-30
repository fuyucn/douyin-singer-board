import { useAppStore } from '../store';

export function ConnectionStatus() {
  const connected = useAppStore((s) => s.status.connected);
  const message = useAppStore((s) => s.status.message);

  return (
    <span className={`text-sm font-medium ${connected ? 'text-success' : 'text-fg-faint'}`}>
      {connected ? '●' : '○'} {message}
    </span>
  );
}
