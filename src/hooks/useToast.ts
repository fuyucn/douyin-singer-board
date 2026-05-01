import { useCallback, useState } from 'react';

export type ToastKind = 'success' | 'error';
export interface ToastState {
  msg: string;
  kind: ToastKind;
}

const TOAST_DURATION = 1600;

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((msg: string, kind: ToastKind = 'success') => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), TOAST_DURATION);
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  return { toast, showToast, dismissToast };
}
