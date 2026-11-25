import Link from 'next/link';
import type { Metadata } from 'next';
import { fetchNewsComparisonsSSR } from '@/lib/server-api';
import { NewsComparisonView } from '@/components/news/comparison/NewsComparisonView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '新闻关联 · China Radar' };

export default async function NewsComparisonPage({ searchParams }: { searchParams: Promise<{ event?: string | string[]; article?: string | string[] }> }) {
  const query = await searchParams;
  const event = typeof query.event === 'string' && /^[a-f0-9]{64}$/.test(query.event) ? query.event : undefined;
  const article = typeof query.article === 'string' && query.article.length <= 100 ? query.article : undefined;
  const { events, status, comparison } = await fetchNewsComparisonsSSR(event, article);
  const active = comparison?.id ?? event;

  return <div className="mx-auto max-w-[96rem] px-4 py-6 sm:px-7 lg:py-8">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">新闻关联</h1>
      {!!events.length && <form action="/news-comparison" className="flex min-w-0 items-center gap-2">
        <select aria-label="选择事件" name="event" defaultValue={events.some(item => item.id === active) ? active : ''} required className="min-h-11 min-w-0 max-w-[64vw] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm sm:max-w-sm">
          <option value="" disabled>选择已整理事件</option>
          {events.map(item => <option key={item.id} value={item.id}>{item.title}（{item._count.articles} 份）</option>)}
        </select>
        <button type="submit" className="min-h-11 shrink-0 rounded-lg border border-[var(--input-border)] px-3 text-sm hover:bg-[var(--bg-hover)]">打开</button>
      </form>}
    </div>
    {comparison ? <NewsComparisonView key={comparison.id} comparison={comparison} initialArticle={article} />
      : <div className="border-y border-[var(--border-subtle)] py-10">
        <h2 className="text-lg font-semibold">{status === 'stale' ? '报道素材已更新' : article ? '这篇报道暂无可用对照' : '暂无可查看的新闻对照'}</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{status === 'stale' ? '管理员重新生成后，才会展示基于新素材的对照。' : events.length ? '可以从上方选择其他已整理事件。' : '管理员整理同一事件的多份材料后，关系图和原文摘录会显示在这里。'}</p>
        <Link href="/curated" className="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--accent-blue)] hover:underline">返回精选</Link>
      </div>}
  </div>;
}
