import { Toaster as Sonner, type ToasterProps } from 'sonner';
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react';

const Toaster = ({ ...props }: ToasterProps) => {
  // Read theme from data-theme attribute instead of next-themes
  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark';

  return (
    <Sonner
      theme={isDark ? 'dark' : 'light'}
      className="toaster group"
      closeButton
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          '--width': 'auto',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Shrink toast to fit content (close button gets ~32px reserved space)
          toast: 'cn-toast !w-fit !min-w-[200px] !max-w-[420px] !pr-10',
          // Move close button to right side, vertically centered (default is top-left)
          closeButton:
            '!left-auto !right-2 !top-1/2 !bottom-auto !translate-x-0 !-translate-y-1/2',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
