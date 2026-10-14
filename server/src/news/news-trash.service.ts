import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NewsBridgeService } from './news-bridge.service';
import { NewsLogsService } from './news-logs.service';
import { analysisKey } from './analysis';
import { canonicalUrl } from './rules';
import { publicNewsScope } from './radar-content';

export async function isDeletedNews(db: Prisma.TransactionClient, url: string, originalUrl?: string | null) {
  const urls = [...new Set([url, originalUrl].filter((value): value is string => !!value).flatMap(value => [value, canonicalUrl(value) || value]))];
  return !!(await db.newsDeletedUrl.findFirst({ where: { url: { in: urls } }, select: { url: true } })
    || await db.newsItem.findFirst({ where: { deletedAt: { not: null }, OR: [{ url: { in: urls } }, { originalUrl: { in: urls } }] }, select: { id: true } }));
}

const actions = ['hideArticle', 'showArticle', 'hideImages', 'showImages', 'delete', 'restore'] as const;
type BatchAction = typeof actions[number];
@Injectable()
export class NewsTrashService implements OnModuleInit {
  private cleaning = false;
  constructor(private readonly prisma: PrismaService, private readonly bridge: NewsBridgeService, private readonly logs: NewsLogsService) {}
  async onModuleInit() { await this.cleanup(); }

  async batch(body: unknown) {
    const value = body as { ids?: unknown; action?: unknown } | null;
    if (!value || !Array.isArray(value.ids) || !value.ids.length || value.ids.length > 100 || value.ids.some(id => typeof id !== 'string' || !id || id.length > 100)
      || !actions.includes(value.action as BatchAction)) throw new BadRequestException('请选择 1–100 条新闻并指定有效操作');
    const ids = [...new Set(value.ids as string[])]; const action = value.action as BatchAction;
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      const items = await tx.newsItem.findMany({ where: { id: { in: ids } } });
      if (items.length !== ids.length || items.some(item => action === 'restore' ? !item.deletedAt : !!item.deletedAt)) throw new ConflictException('部分新闻已删除、恢复或清理，请刷新列表后重试');
      for (const item of items) {
        const data: Prisma.NewsItemUpdateManyMutationInput = { updatedAt: item.updatedAt };
        if (action === 'delete') data.deletedAt = now;
        else if (action === 'restore') data.deletedAt = null;
        else if (action === 'hideArticle' || action === 'showArticle') data.hiddenArticle = action === 'hideArticle';
        else data.hiddenImages = action === 'hideImages';
        await tx.newsItem.update({ where: { id: item.id }, data });
        await this.bridge.sync(tx, item.id);
        await tx.hotspot.updateMany({ where: { newsItemId: item.id }, data: { notifyEligible: false } });
      }
    }, { timeout: 30000 });
    return { count: ids.length, action, retentionDays: 60 };
  }

  @Cron('0 30 * * * *', { timeZone: 'Asia/Shanghai' })
  async cleanup() {
    if (this.cleaning) return;
    this.cleaning = true;
    const startedAt = new Date(); const cutoff = new Date(startedAt.getTime() - 60 * 86400000);
    let purged = 0; let cursor: string | undefined;
    try {
      while (true) {
        const candidates = await this.prisma.newsItem.findMany({ where: { deletedAt: { lte: cutoff }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 50, select: { id: true } });
        for (const candidate of candidates) purged += await this.prisma.$transaction(async tx => {
          const item = await tx.newsItem.findFirst({ where: { id: candidate.id, deletedAt: { lte: cutoff } } });
          if (!item) return 0;
          const keys = [...new Set([item.analysisKey, analysisKey(item), analysisKey(item, 2), analysisKey(item, 1)].filter((key): key is string => !!key))];
          // Let an already-running request finish before removing its last stored material.
          const queued = await tx.newsAnalysis.findMany({ where: { key: { in: keys }, queuedTaskId: { not: null } }, select: { queuedTaskId: true } });
          if (queued.length && await tx.aiTask.count({ where: { id: { in: queued.map(cache => cache.queuedTaskId!) }, status: 'running', leaseUntil: { gt: new Date() } } })) return 0;
          for (const url of new Set([item.url, item.originalUrl].filter((value): value is string => !!value).flatMap(value => [value, canonicalUrl(value) || value])))
            await tx.newsDeletedUrl.upsert({ where: { url }, create: { url }, update: {} });
          await tx.notification.deleteMany({ where: { OR: [{ id: `news:${item.id}` }, { hotspotId: `news:${item.id}` }] } });
          await tx.newsItem.delete({ where: { id: item.id } });
          const shared = await tx.newsItem.count({ where: { OR: [{ analysisKey: { in: keys } }, { contentHash: item.contentHash }, { title: item.title, summary: item.summary }] } });
          if (!shared) await tx.newsAnalysis.deleteMany({ where: { key: { in: keys } } });
          const digests = await tx.newsDigest.findMany({ where: { data: { contains: item.id } } });
          for (const digest of digests) {
            const data = JSON.parse(digest.data);
            data.highlights = (data.highlights || []).filter((entry: { newsItemId?: string }) => entry.newsItemId !== item.id);
            data.sections = (data.sections || []).map((section: { items: Array<{ newsItemId?: string }> }) => ({ ...section, items: section.items.filter(entry => entry.newsItemId !== item.id) }));
            data.summary = '';
            data.itemCount = new Set([...data.highlights, ...data.sections.flatMap((section: { items: Array<{ newsItemId?: string }> }) => section.items)].map(entry => entry.newsItemId)).size;
            await tx.newsDigest.update({ where: { date: digest.date }, data: { data: JSON.stringify(data) } });
          }
          if (item.eventKey) {
            const main = await tx.hotspot.findFirst({ where: { clusterKey: item.eventKey, newsItem: { is: publicNewsScope() } }, orderBy: [{ qualityScore: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], select: { id: true } });
            if (main) await tx.hotspot.update({ where: { id: main.id }, data: { isClusterMain: true } });
          }
          return 1;
        }, { timeout: 30000 });
        if (candidates.length < 50) break;
        cursor = candidates[candidates.length - 1].id;
      }
      if (purged) await this.logs.record({ kind: 'admin', route: 'news/trash/purge', startedAt, elapsedMs: Date.now() - startedAt.getTime(), status: 'success', detailsJson: JSON.stringify({ purged, retentionDays: 60 }) });
    } finally { this.cleaning = false; }
  }
}
