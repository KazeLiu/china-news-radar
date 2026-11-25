import Link from 'next/link';
import { Network } from 'lucide-react';
import type { Metadata } from 'next';
import { EntityTrendsView } from '@/components/news/entities/EntityTrendsView';
import { fetchEntityTrendsSSR } from '@/lib/server-api';
import { cn } from '@/lib/utils';
import type { EntityPeriod } from '@/types/entity-trends';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '高频关注 · China Radar' };

const PERIODS = [
  { key: 'day', label: '今日', historical: '当天' },
  { key: 'week', label: '本周', historical: '当周' },
  { key: 'month', label: '本月', historical: '当月' },
] as const;

export default async function HighFrequencyPage({ searchParams }: { searchParams: Promise<{ period?: string | string[]; article?: string | string[] }> }) {
  const query = await searchParams;
  const period: EntityPeriod = query.period === 'week' || query.period === 'month' ? query.period : 'day';
  const article = typeof query.article === 'string' && query.article.length <= 100 ? query.article : undefined;
  const trends = await fetchEntityTrendsSSR(period, article);
  const anchor = trends?.article?.id;

  return <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-7 lg:py-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><Network className="size-5 text-[var(--accent-blue)]" aria-hidden="true" />高频关注</h1>
      <nav aria-label="统计周期" className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-1 text-sm">
        {PERIODS.map(item => {
          const params = new URLSearchParams({ period: item.key });
          if (anchor) params.set('article', anchor);
          return <Link key={item.key} href={`/high-frequency?${params}`} prefetch={false} aria-current={period === item.key ? 'page' : undefined}
            className={cn('rounded-lg px-3 py-2 transition-colors', period === item.key ? 'bg-[var(--bg-elevated)] font-semibold text-[var(--accent-blue)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}>
            {anchor ? item.historical : item.label}
          </Link>;
        })}
      </nav>
    </div>
    {trends ? <>
      <div className="mb-5 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
        <span className="tabular-nums">{trends.firstDay}{trends.lastDay !== trends.firstDay && ` 至 ${trends.lastDay}`} · 北京时间</span>
        <span className="tabular-nums" title="已提取实体证据的报道数 / 本期公开报道数，重复原文合计一次">覆盖 {trends.coverage.analyzed}/{trends.coverage.total} 篇报道</span>
        {(anchor || period !== 'day') && <Link href="/high-frequency" prefetch={false} className="text-[var(--accent-blue)] hover:underline">回到今日</Link>}
      </div>
      <EntityTrendsView key={`${period}:${article ?? ''}`} trends={trends} />
    </> : <p className="mt-6 border-y border-[var(--border-subtle)] py-8 text-sm text-[var(--text-secondary)]">当前运行模式未提供高频关注。</p>}
    <div className="mt-6 flex gap-4 text-sm text-[var(--text-secondary)]">
      <Link href="/keywords" prefetch={false} className="hover:text-[var(--accent-blue)] hover:underline">自定义关注</Link>
      <Link href="/news-comparison" prefetch={false} className="hover:text-[var(--accent-blue)] hover:underline">历史报道对照</Link>
    </div>
  </div>;
}
