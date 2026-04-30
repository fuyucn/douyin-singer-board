import { useRef } from 'react';

export function AppLogo() {
  const clicks = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onClick = () => {
    clicks.current += 1;
    if (timer.current) clearTimeout(timer.current);
    if (clicks.current >= 8) {
      clicks.current = 0;
      new Audio('/secret.m4a').play().catch(() => {});
    } else {
      timer.current = setTimeout(() => { clicks.current = 0; }, 2000);
    }
  };

  return (
    <img src="/logo.png" className="header-logo" alt="" draggable={false} onClick={onClick} />
  );
}
