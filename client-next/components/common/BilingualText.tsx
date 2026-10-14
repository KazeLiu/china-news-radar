import type { ReactNode } from 'react';
import type { TextPair } from '@/lib/newsText';
import { cn } from '@/lib/utils';

export function BilingualText({ text, lineClassName, prefix, children }: { text: TextPair; lineClassName?: string; prefix?: ReactNode; children?: ReactNode }) {
  return <>
    <span dir="auto" className={lineClassName || 'block'}>{prefix}{text.primary}{children}</span>
    {text.secondary && <span dir="auto" className={cn(lineClassName || 'block', 'mt-1.5 font-normal text-[var(--text-secondary)]')}>{text.secondary}</span>}
  </>;
}
