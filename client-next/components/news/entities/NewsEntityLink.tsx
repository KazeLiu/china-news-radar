import Link from 'next/link';
import { LocateFixed, Network } from 'lucide-react';

export function NewsEntityLink({ articleId, iconOnly = false }: { articleId: string; iconOnly?: boolean }) {
  return <Link href={`/high-frequency?article=${encodeURIComponent(articleId)}`} prefetch={false}
    aria-label={iconOnly ? '查看关联' : undefined}
    title={iconOnly ? '查看这篇报道的实体关联' : undefined}
    className={iconOnly
      ? 'relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] after:absolute after:-inset-2 hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]'
      : 'inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap text-sm text-[var(--accent-blue)] hover:underline'}>
    {iconOnly ? <LocateFixed size={16} aria-hidden="true" /> : <><Network size={15} aria-hidden="true" /> 查看关联</>}
  </Link>;
}
