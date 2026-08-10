// localStorage-backed toggle for "show logs panel" UI preference. Default OFF.
import { useEffect, useState } from 'react';

const KEY = 'sususongboard:showLogs';

function readInitial(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(KEY) === '1';
}

export function useShowLogs(): [boolean, (v: boolean) => void] {
  const [show, setShow] = useState(readInitial);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setShow(e.newValue === '1');
    };
    // Custom event so updates from same window propagate too
    const onCustom = () => setShow(readInitial());
    window.addEventListener('storage', onStorage);
    window.addEventListener('sususongboard:show-logs-changed', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sususongboard:show-logs-changed', onCustom);
    };
  }, []);

  const set = (v: boolean) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY, v ? '1' : '0');
    }
    setShow(v);
    window.dispatchEvent(new CustomEvent('sususongboard:show-logs-changed'));
  };

  return [show, set];
}
