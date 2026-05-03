import * as React from 'react';
import { cn } from '@/lib/utils';

function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        'flex items-stretch rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-3',
        className,
      )}
      {...props}
    />
  );
}

export { InputGroup };
