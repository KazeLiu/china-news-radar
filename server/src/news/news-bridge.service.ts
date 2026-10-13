import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HotspotGateway } from '../gateway/hotspot.gateway';
import { computeQualityScore } from '../services/scoring.service';
import { CURATED_THRESHOLD, SourceTier } from '../rss-feeds/feeds.config';
import { parseAnalysis, AnalysisResult } from './analysis';
import { presentHotspot, publicNewsScope } from './radar-content';
import { ORIGINAL_PUBLISHERS } from './sources';
import { EmailService } from '../services/email.service';

export function publisherTier(publisher: string | null): SourceTier {
  if (['美国财政部', '美国商务部', '欧盟委员会'].includes(publisher || '')) return 'T1';
  return ORIGINAL_PUBLISHERS.some(source => source.name === publisher && source.name !== 'Truth Social 原帖') ? 'T1.5' : 'T2';
}

@Injectable()
export class NewsBridgeService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly gateway?: HotspotGateway, @Optional() private readonly email?: EmailService) {}

  async sync(tx: Prisma.TransactionClient, id: string, notifyEligible = false) {
    const item = await tx.newsItem.findUniqueOrThrow({ where: { id } });
    const cache = item.analysisKey ? await tx.newsAnalysis.findUnique({ where: { key: item.analysisKey } }) : null;
    let score: AnalysisResult['scoring'];
    if (cache?.status === 'done' && cache.resultJson) {
      try { score = parseAnalysis(cache.resultJson).scoring; } catch { /* Invalid caches are handled by NewsService. */ }
    }
    const tier = publisherTier(item.originalPublisher);
    const qualityScore = score ? computeQualityScore({ relevToAi: score.relevance, ...score }, tier) : null;
    const data = { newsItemId: id, title: item.displayTitle ?? item.titleZh ?? item.title, content: item.displaySummary ?? item.summaryZh ?? item.summary,
      url: item.url, source: `news_${item.sourceId}`, sourceId: item.sourceId, summary: item.displaySummary ?? item.summaryZh ?? item.summary,
      media: item.hiddenImages ? null : JSON.stringify((JSON.parse(item.images) as string[]).map(url => ({ type: 'photo', url }))),
      publishedAt: item.publishedAt, createdAt: item.firstSeenAt, category: item.topic, region: 'international',
      sourceTier: tier, qualityScore, relevance: score ? score.relevance * 10 : 0, relevanceReason: item.aiReason,
      importance: score?.importance || 'low', tags: JSON.stringify(score?.tags || []), clusterKey: item.eventKey,
      isCurated: qualityScore !== null && qualityScore >= CURATED_THRESHOLD[tier] && item.aiRelation === 'related', authorName: item.author };
    const previous = await tx.hotspot.findUnique({ where: { newsItemId: id }, select: { clusterKey: true } });
    const hotspot = await tx.hotspot.upsert({ where: { newsItemId: id }, create: { id: `news:${id}`, notifyEligible, ...data }, update: data });
    await this.matchItem(tx, item);
    for (const clusterKey of new Set([item.eventKey, previous?.clusterKey].filter((key): key is string => !!key))) {
      const mains = await tx.hotspot.findMany({ where: { clusterKey, newsItem: { is: publicNewsScope() } },
        orderBy: [{ qualityScore: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], select: { id: true } });
      await tx.hotspot.updateMany({ where: { clusterKey, newsItemId: { not: null } }, data: { isClusterMain: false } });
      if (mains[0]) await tx.hotspot.update({ where: { id: mains[0].id }, data: { isClusterMain: true } });
    }
    return hotspot;
  }

  private async matchItem(tx: Prisma.TransactionClient, item: { id: string; title: string; summary: string; titleZh: string | null; summaryZh: string | null }) {
    const keywords = await tx.keyword.findMany({ where: { isActive: true }, include: { newsProfile: true } });
    const text = `${item.title} ${item.summary} ${item.titleZh || ''} ${item.summaryZh || ''}`.normalize('NFKC').toLowerCase();
    await tx.newsKeywordMatch.deleteMany({ where: { newsItemId: item.id } });
    for (const keyword of keywords) {
      let aliases: string[] = [];
      try { aliases = JSON.parse(keyword.newsProfile?.data || '{}').aliases || []; } catch { /* Keep the literal keyword. */ }
      if ([keyword.text, ...aliases].some(alias => alias && text.includes(alias.normalize('NFKC').toLowerCase())))
        await tx.newsKeywordMatch.create({ data: { newsItemId: item.id, keywordId: keyword.id } });
    }
  }

  async rebuild() {
    const keywords = await this.prisma.keyword.findMany();
    for (const keyword of keywords) await this.prisma.entityCard.upsert({ where: { keywordId: keyword.id }, create: { keywordId: keyword.id, name: keyword.text }, update: {} });
    let cursor: string | undefined;
    do {
      const items = await this.prisma.newsItem.findMany({ orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      for (const item of items) await this.prisma.$transaction(tx => this.sync(tx, item.id));
      if (items.length < 100) break;
      cursor = items[items.length - 1].id;
    } while (true);
  }

  async announce(id: string) {
    const hotspot = await this.prisma.hotspot.findUnique({ where: { newsItemId: id }, include: { newsItem: { include: { keywordMatches: { include: { keyword: true } } } } } });
    if (!hotspot?.notifyEligible || !hotspot.newsItem?.visible || hotspot.newsItem.hiddenArticle || hotspot.newsItem.publicationStatus !== 'published'
      || (!hotspot.newsItem.originalPublisher && !hotspot.newsItem.isManual) || !hotspot.isClusterMain) return;
    // The unique notification id prevents edits, backfills and restarts from replaying an alert.
    const notificationId = `news:${id}`;
    try {
      await this.prisma.notification.create({ data: { id: notificationId, type: 'hotspot', title: '发现涉华报道', content: hotspot.title, hotspotId: hotspot.id } });
    } catch (error) { if ((error as { code?: string }).code === 'P2002') return; throw error; }
    await this.prisma.hotspot.update({ where: { id: hotspot.id }, data: { notifyEligible: false } });
    const rooms = hotspot.newsItem.keywordMatches.map(match => `keyword:${match.keyword.text}`);
    if (rooms.length) this.gateway?.server?.to(rooms).emit('hotspot:new', presentHotspot(hotspot));
    this.gateway?.server?.emit('notification', { type: 'hotspot', title: '发现涉华报道', content: hotspot.title, hotspotId: hotspot.id, importance: hotspot.importance });
    if (rooms.length && ['high', 'urgent'].includes(hotspot.importance) && process.env.SMTP_HOST && process.env.NOTIFY_EMAIL) await this.email?.sendHotspotEmail(hotspot);
  }
  scanStatus(isScanning: boolean) { this.gateway?.server?.emit('scan:status', { isScanning }); }
}
