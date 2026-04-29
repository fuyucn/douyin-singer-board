import { useCallback, useEffect, useState } from 'react';
import type { DanmuInfo } from '../types';

export function useContextMenu() {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; song: DanmuInfo } | null>(null);

  const open = useCallback((e: React.MouseEvent, song: DanmuInfo) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, song });
  }, []);

  const close = useCallback(() => setCtxMenu(null), []);

  useEffect(() => {
    if (!ctxMenu) return;
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ctxMenu, close]);

  return { ctxMenu, open, close };
}
