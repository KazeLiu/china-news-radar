import { Prisma, NewsItem } from '@prisma/client';

export const newsMode = () => process.env.RADAR_MODE !== 'legacy';
export function contentScope(where: Prisma.HotspotWhereInput = {}): Prisma.HotspotWhereInput {
  return { AND: [where, newsMode()
    ? { newsItem: { is: { visible: true, originalPublisher: { not: null } } } }
    : { newsItemId: null }] };
}
export const newsInclude = () => newsMode() ? { newsItem: true } as const : {};
export function presentHotspot<T extends { media?: string | null; newsItem?: NewsItem | null; qualityScore?: number | null }>(item: T) {
  const { newsItem: news, ...base } = item;
  const media = (() => { try { return item.media ? JSON.parse(item.media) : null; } catch { return null; } })();
  return { ...base, media, ...(news ? { newsItemId: news.id, originalTitle: news.title, originalSummary: news.summary,
    originalPublisher: news.originalPublisher, originalUrl: news.originalUrl, url: news.originalUrl || news.url,
    firstSeenAt: news.firstSeenAt, updatedAt: news.updatedAt, saved: news.saved, aiStatus: news.aiStatus, decisionBy: news.decisionBy,
    scoringStatus: item.qualityScore != null ? 'scored' : news.aiStatus === 'done' ? 'unscored' : 'rules',
    aiTopics: news.aiTopics, sourceId: news.sourceId, distribution: news.url.includes('news.google.com') ? 'Google News 索引' : news.sourceId.startsWith('tg-') ? 'Telegram 转发' : 'RSS' } : {}) };
}
