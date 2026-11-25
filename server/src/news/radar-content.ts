import { Prisma, NewsItem } from '@prisma/client';
import { readCachedChinaEvaluation } from './analysis';
import type { NewsSourceConfig } from './sources';
import { distributionFor } from './transports';

export const newsMode = () => process.env.RADAR_MODE !== 'legacy';
export function publicNewsScope(where: Prisma.NewsItemWhereInput = {}): Prisma.NewsItemWhereInput {
  return { AND: [where, { visible: true, hiddenArticle: false, deletedAt: null, publicationStatus: 'published', OR: [{ originalPublisher: { not: null } }, { isManual: true }] }] };
}
export function presentNews<T extends Omit<NewsItem, 'body'>>(item: T) {
  return { ...item, titleZh: item.displayTitle ?? item.aiGeneratedTitle ?? item.titleZh, summaryZh: item.displaySummary ?? item.summaryZh,
    sourceLinks: JSON.parse(item.sourceLinks),
    images: item.hiddenImages ? '[]' : item.images, originalPublisher: item.originalPublisher || (item.isManual ? '管理员录入' : null),
    url: item.isManual && !item.originalPublisher ? `/articles/${item.id}` : item.originalUrl || item.url };
}
export function contentScope(where: Prisma.HotspotWhereInput = {}): Prisma.HotspotWhereInput {
  return { AND: [where, newsMode()
    ? { newsItem: { is: publicNewsScope() } }
    : { newsItemId: null }] };
}
export const newsInclude = () => newsMode() ? { newsItem: { omit: { body: true } } } as const : {};
type HotspotSource = { media?: string | null; newsItem?: Omit<NewsItem, 'body'> | null; qualityScore?: number | null };
export function presentHotspot<T extends HotspotSource>(item: T) {
  const { newsItem: news, ...base } = item;
  const media = (() => { if (news?.hiddenImages) return null; try { return item.media ? JSON.parse(item.media) : null; } catch { return null; } })();
  return { ...base, media, ...(news ? { newsItemId: news.id, originalTitle: news.sourceTitlePresent ? news.title : '', sourceTitlePresent: news.sourceTitlePresent, titleGenerated: news.titleGenerated, originalSummary: news.summary, displaySummary: news.displaySummary,
    sourceLinks: JSON.parse(news.sourceLinks),
    originalPublisher: news.originalPublisher || (news.isManual ? '管理员录入' : null), originalUrl: news.originalUrl, url: news.isManual && !news.originalPublisher ? `/articles/${news.id}` : news.originalUrl || news.url,
    firstSeenAt: news.firstSeenAt, updatedAt: news.updatedAt, saved: news.saved, aiStatus: news.aiStatus, decisionBy: news.decisionBy,
    scoringStatus: item.qualityScore != null ? 'scored' : news.aiStatus === 'done' ? 'unscored' : 'rules',
    aiTopics: news.aiTopics, sourceId: news.sourceId, distribution: news.url.includes('news.google.com') ? 'Google News 索引' : news.sourceId.startsWith('tg-') ? 'Telegram 转发' : distributionFor(news.acquisitionKind) } : {}) };
}

export async function presentHotspotCards<T extends HotspotSource>(db: Pick<Prisma.TransactionClient, 'newsAnalysis'>, items: T[],
  sourceLabels?: ReadonlyMap<string, Pick<NewsSourceConfig, 'name' | 'regionLabel'>>) {
  const keys = [...new Set(items.flatMap(({ newsItem }) => newsItem?.aiStatus === 'done' && newsItem.analysisKey ? [newsItem.analysisKey] : []))];
  const evaluations = new Map<string, NonNullable<ReturnType<typeof readCachedChinaEvaluation>>>();
  if (keys.length) {
    const cached = await db.newsAnalysis.findMany({ where: { key: { in: keys }, status: 'done' }, select: { key: true, resultJson: true, inputJson: true } });
    for (const { key, resultJson, inputJson } of cached) {
      if (!resultJson) continue;
      try {
        const result = readCachedChinaEvaluation(resultJson, inputJson);
        if (result) evaluations.set(key, result);
      } catch { /* A damaged optional result must not hide the valid news card. */ }
    }
  }
  return items.map(item => {
    const news = item.newsItem;
    const source = news && sourceLabels?.get(news.sourceId);
    const result = news?.aiStatus === 'done' && news.analysisKey ? evaluations.get(news.analysisKey) : undefined;
    // Untitled articles can reuse titled caches for classification, but not for evaluation.
    return { ...presentHotspot(item),
      ...(source ? { sourceName: source.name, sourceRegionLabel: source.regionLabel || undefined } : {}),
      ...(result && result.sourceTitlePresent === news?.sourceTitlePresent ? { chinaEvaluation: result.evaluation } : {}) };
  });
}
