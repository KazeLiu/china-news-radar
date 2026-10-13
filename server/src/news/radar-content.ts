import { Prisma, NewsItem } from '@prisma/client';
import { distributionFor } from './transports';

export const newsMode = () => process.env.RADAR_MODE !== 'legacy';
export function publicNewsScope(where: Prisma.NewsItemWhereInput = {}): Prisma.NewsItemWhereInput {
  return { AND: [where, { visible: true, hiddenArticle: false, publicationStatus: 'published', OR: [{ originalPublisher: { not: null } }, { isManual: true }] }] };
}
export function presentNews<T extends Omit<NewsItem, 'body'>>(item: T) {
  return { ...item, titleZh: item.displayTitle ?? item.titleZh, summaryZh: item.displaySummary ?? item.summaryZh,
    images: item.hiddenImages ? '[]' : item.images, originalPublisher: item.originalPublisher || (item.isManual ? '管理员录入' : null),
    url: item.isManual && !item.originalUrl ? `/articles/${item.id}` : item.originalUrl || item.url };
}
export function contentScope(where: Prisma.HotspotWhereInput = {}): Prisma.HotspotWhereInput {
  return { AND: [where, newsMode()
    ? { newsItem: { is: publicNewsScope() } }
    : { newsItemId: null }] };
}
export const newsInclude = () => newsMode() ? { newsItem: true } as const : {};
export function presentHotspot<T extends { media?: string | null; newsItem?: NewsItem | null; qualityScore?: number | null }>(item: T) {
  const { newsItem: news, ...base } = item;
  const media = (() => { if (news?.hiddenImages) return null; try { return item.media ? JSON.parse(item.media) : null; } catch { return null; } })();
  return { ...base, media, ...(news ? { newsItemId: news.id, originalTitle: news.title, originalSummary: news.summary,
    originalPublisher: news.originalPublisher || (news.isManual ? '管理员录入' : null), originalUrl: news.originalUrl, url: news.isManual && !news.originalUrl ? `/articles/${news.id}` : news.originalUrl || news.url,
    firstSeenAt: news.firstSeenAt, updatedAt: news.updatedAt, saved: news.saved, aiStatus: news.aiStatus, decisionBy: news.decisionBy,
    scoringStatus: item.qualityScore != null ? 'scored' : news.aiStatus === 'done' ? 'unscored' : 'rules',
    aiTopics: news.aiTopics, sourceId: news.sourceId, distribution: news.url.includes('news.google.com') ? 'Google News 索引' : news.sourceId.startsWith('tg-') ? 'Telegram 转发' : distributionFor(news.acquisitionKind) } : {}) };
}
