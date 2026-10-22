import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchArticleSSR } from '@/lib/server-api';
import { ArticleText } from '@/components/news/ArticleText';
import { NewsSourceLinks } from '@/components/news/NewsSourceLinks';

export const dynamic = 'force-dynamic';
export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const item = await fetchArticleSSR(id);
  if (!item) notFound();
  const images = JSON.parse(item.images) as string[];
  return <main className="max-w-3xl mx-auto px-6 py-10 text-[var(--text-primary)]">
    <Link href="/curated" className="text-[var(--accent-blue)] inline-flex min-h-11 items-center mb-6">返回精选资讯</Link>
    <article><p className="text-sm text-[var(--text-muted)] mb-4">{item.originalPublisher || '管理员录入'}{item.isManual && item.originalPublisher !== '管理员录入' ? ' · 管理员录入' : ''} · {new Date(item.publishedAt || item.firstSeenAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）</p>
      <ArticleText title={item.titleZh || item.title} originalTitle={item.sourceTitlePresent ? item.title : ''} titleGenerated={item.titleGenerated} summary={item.summaryZh ?? item.summary} originalSummary={item.summary} displaySummary={item.displaySummary} />
      <div className="leading-loose whitespace-pre-wrap break-words">{item.body || '本站未保存完整正文。'}</div>
      <NewsSourceLinks links={item.sourceLinks} />
      {images.length > 0 && <ul className="mt-8 space-y-3">{images.map((url, index) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-blue)] underline">查看报道图片 {index + 1}</a></li>)}</ul>}
      {item.originalUrl && <a href={item.originalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center mt-8 text-[var(--accent-blue)] underline">阅读媒体原文</a>}
    </article>
  </main>;
}
