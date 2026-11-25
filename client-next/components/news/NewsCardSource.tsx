import { getSourceIcon, getSourceLabel } from '@/lib/sourceMeta';
import type { Hotspot } from '@/types';

const address = /^(?:https?:\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[:/?#]|$))/i;

export function NewsCardSource({ item }: { item: Hotspot }) {
  const publisher = item.originalPublisher;
  const publisherName = publisher && !address.test(publisher) ? publisher : undefined;
  const name = item.newsItemId
    ? item.sourceName || publisherName || (item.sourceId === 'manual' ? '管理员录入' : '来源未命名')
    : publisher || getSourceLabel(item.source);

  return <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
    {getSourceIcon(item.source, 'size-3.5 shrink-0')}
    <span className="truncate" title={name}>{name}</span>
    {item.sourceRegionLabel && <span title={item.sourceRegionLabel} className="max-w-28 shrink-0 truncate rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] sm:max-w-40">{item.sourceRegionLabel}</span>}
  </span>;
}
