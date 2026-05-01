import { CircleIcon, DotFilledIcon } from '@radix-ui/react-icons';
import { useAppStore } from '../store';

export function ConnectionStatus() {
  const connected = useAppStore((s) => s.status.connected);
  const message = useAppStore((s) => s.status.message);

  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-medium ${connected ? 'text-success' : 'text-fg-faint'}`}
    >
      {connected ? <DotFilledIcon /> : <CircleIcon />}
      {message}
    </span>
  );
}
