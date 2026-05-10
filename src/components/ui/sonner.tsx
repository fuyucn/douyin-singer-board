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
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
          // Move close button to top-right (default is top-left in sonner)
          closeButton:
            '!left-auto !right-1 !top-1 !bottom-auto !translate-x-0 !translate-y-0',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
