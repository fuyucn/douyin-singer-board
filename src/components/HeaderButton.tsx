import type { ReactNode } from 'react';

interface Props {
  onClick: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

const BASE =
  'text-fg-muted hover:bg-bg-soft hover:border-border-strong hover:text-fg-base inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-transparent p-0 leading-none';

export function HeaderButton({ onClick, title, children, className = '' }: Props) {
  return (
    <button className={`${BASE} ${className}`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}
