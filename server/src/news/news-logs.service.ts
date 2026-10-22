import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CollectionCounts { discovered: number; added: number; updated: number; duplicates: number; filtered: number }
@Injectable()
export class NewsLogsService implements OnModuleInit {
  private readonly logger = new Logger(NewsLogsService.name);
  private recordingError = false;
  constructor(private readonly prisma: PrismaService) {}
  async onModuleInit() {
    await this.prisma.setting.upsert({ where: { key: 'news-log-started-at' }, create: { key: 'news-log-started-at', value: new Date().toISOString() }, update: {} });
    await this.cleanup();
  }
  @Cron('0 15 3 * * *', { timeZone: 'Asia/Shanghai' })
  async cleanup() {
    const before = new Date(Date.now() - 7 * 86400000);
    await this.prisma.$transaction(async tx => {
      await tx.newsOperationLog.deleteMany({ where: { startedAt: { lt: before } } });
      await tx.aiRequest.deleteMany({ where: { startedAt: { lt: before }, status: { not: 'running' } } });
      const linked = await tx.newsAnalysis.findMany({ where: { queuedTaskId: { not: null } }, select: { queuedTaskId: true } });
      await tx.aiTask.deleteMany({ where: { status: { in: ['done', 'failed'] }, finishedAt: { lt: before }, requests: { none: {} },
        id: { notIn: linked.map(cache => cache.queuedTaskId!) }, OR: [{ status: 'done' }, { failureHandled: true }, { kind: { notIn: ['news', 'profile'] } }] } });
    });
  }
  async record(data: Prisma.NewsOperationLogCreateInput) {
    try { await this.prisma.newsOperationLog.create({ data }); this.recordingError = false; }
    catch { this.recordingError = true; this.logger.warn('操作日志保存失败；业务数据与操作结果未改变，请检查数据库'); }
  }
  async read(query: { date?: string; source?: string; kind?: string; status?: string; offset?: string }) {
    const date = query.date || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const midnight = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== date) throw new BadRequestException('日志日期无效');
    if (query.kind && !['collection', 'preview', 'admin', 'ai', 'task', 'analysis'].includes(query.kind)) throw new BadRequestException('日志类型无效');
    if (query.status && !['success', 'failed', 'empty', 'filtered', 'running', 'invalid-response', 'queued', 'retrying', 'cached', 'rules'].includes(query.status)) throw new BadRequestException('日志状态无效');
    const from = new Date(`${date}T00:00:00+08:00`); const until = new Date(from.getTime() + 86400000);
    const offset = Math.max(0, Math.min(100000, Math.floor(Number(query.offset) || 0)));
    const time = { gte: from, lt: until };
    const operations: Prisma.NewsOperationLogWhereInput = { startedAt: time, ...(query.source ? { sourceId: query.source } : {}) };
    const requests: Prisma.AiRequestWhereInput = { startedAt: time, ...(query.source ? { sourceIds: { contains: JSON.stringify(query.source) } } : {}) };
    const [totals, ai, operationCount, requestCount, timeline, requestRows, began] = await Promise.all([
      this.prisma.newsOperationLog.groupBy({ by: ['kind', 'status'], where: operations, _count: true, _sum: { discovered: true, added: true, updated: true, duplicates: true, filtered: true } }),
      this.prisma.aiRequest.groupBy({ by: ['status'], where: requests, _count: true, _sum: { analyzedCount: true, translatedCount: true } }),
      query.kind === 'ai' ? 0 : this.prisma.newsOperationLog.count({ where: { ...operations, ...(query.kind ? { kind: query.kind } : {}), ...(query.status ? { status: query.status } : {}) } }),
      query.kind && query.kind !== 'ai' ? 0 : this.prisma.aiRequest.count({ where: { ...requests, ...(query.status ? { status: query.status } : {}) } }),
      query.kind === 'ai' ? [] : this.prisma.newsOperationLog.findMany({ where: { ...operations, ...(query.kind ? { kind: query.kind } : {}), ...(query.status ? { status: query.status } : {}) }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: offset + 50 }),
      query.kind && query.kind !== 'ai' ? [] : this.prisma.aiRequest.findMany({ where: { ...requests, ...(query.status ? { status: query.status } : {}) }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: offset + 50, select: { id: true, taskId: true, kind: true, model: true, sourceIds: true, attempt: true, status: true, startedAt: true, elapsedMs: true, analyzedCount: true, translatedCount: true, requestId: true, errorJson: true } }),
      this.prisma.setting.findUnique({ where: { key: 'news-log-started-at' } }),
    ]);
    const rows = [...timeline.map(({ detailsJson, ...row }) => ({ ...row, details: detailsJson ? JSON.parse(detailsJson) : null })), ...requestRows.map(({ errorJson, sourceIds, kind, ...row }) => ({ ...row, kind: 'ai', route: `ai/${kind}`, sourceIds: JSON.parse(sourceIds), error: errorJson ? JSON.parse(errorJson) : null }))]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id.localeCompare(a.id)).slice(offset, offset + 50);
    const retries = await this.prisma.aiRequest.count({ where: { ...requests, attempt: { gt: 1 } } });
    const total = operationCount + requestCount;
    return { date, timeZone: 'Asia/Shanghai', quotaTimeZone: 'UTC', retentionDays: 7, recordingStartedAt: began?.value, recordingError: this.recordingError, summary: { operations: totals, ai, retries },
      items: rows, total, nextOffset: offset + rows.length < total ? offset + rows.length : null };
  }
}
