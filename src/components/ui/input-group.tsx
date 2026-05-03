import * as React from 'react';
import { cn } from '@/lib/utils';

function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        'border-input focus-within:border-ring focus-within:ring-ring/50 flex items-stretch rounded-lg border bg-transparent transition-colors focus-within:ring-3',
        className,
      )}
      {...props}
    />
  );
}

export { InputGroup };
