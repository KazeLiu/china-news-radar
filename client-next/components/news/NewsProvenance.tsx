'use client';

import { useId, useState } from 'react';
import { Info } from 'lucide-react';
import { getSourceLabel } from '@/lib/sourceMeta';
import type { Hotspot } from '@/types';

export function NewsProvenance({ item }: { item: Hotspot }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const time = (value?: string) => value
    ? <time dateTime={value}>{new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time>
    : '未提供';

  return (
    <div className="relative shrink-0" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
      <button type="button" aria-label="出处与时间" aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={() => setOpen(true)}
        className="relative flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] after:absolute after:-inset-2 hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]">
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && <div id={id} role="tooltip" className="absolute right-0 top-full z-30 w-max max-w-[calc(100vw-4rem)] rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3 text-xs leading-relaxed text-[var(--text-secondary)] shadow-lg">
        <p className="mb-1 font-medium text-[var(--text-primary)]">{[item.originalPublisher || getSourceLabel(item.source), item.distribution].filter(Boolean).join(' · ')}</p>
        <p>发布：{time(item.publishedAt)}</p>
        <p>首次发现：{time(item.firstSeenAt || item.createdAt)}</p>
        <p>内容更新：{time(item.updatedAt)}</p>
        <p className="text-[var(--text-muted)]">北京时间</p>
        {item.distribution?.includes('Google') && !item.originalUrl && <p className="mt-1">链接为 Google News 索引跳转入口。</p>}
      </div>}
    </div>
  );
}
