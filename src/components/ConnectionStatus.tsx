import { useAppStore } from '../store';

export function ConnectionStatus() {
  const connected = useAppStore((s) => s.status.connected);
  const message = useAppStore((s) => s.status.message);

  return (
    <span className={`status ${connected ? 'on' : 'off'}`}>
      {connected ? '●' : '○'} {message}
    </span>
  );
}
