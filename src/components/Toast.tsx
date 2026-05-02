import type { ToastState } from '../hooks/useToast';

interface Props {
  toast: ToastState;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: Props) {
  return (
    <div
      className={[
        'fixed bottom-6 left-1/2 z-[1000] -translate-x-1/2 cursor-pointer rounded-md px-5 py-2.5 text-[13px] whitespace-nowrap text-white hover:opacity-85',
        toast.kind === 'success' ? 'bg-success' : 'bg-danger',
      ].join(' ')}
      style={{
        boxShadow: 'var(--shadow-toast)',
        animation: 'toast-in 0.18s ease-out, toast-out 0.3s ease-in 1.3s forwards',
      }}
      onClick={onDismiss}
      title="Click to dismiss"
    >
      {toast.msg}
    </div>
  );
}
