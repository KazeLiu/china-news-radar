import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { AiTask, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { InvalidAnalysisResponse } from './ai-errors';
import { AiRuntimeService } from './ai-runtime.service';
import { COMPARISON_PROMPT, COMPARISON_VERSION, ComparisonAnalysis, ComparisonMaterial, parseComparison } from './news-comparison-analysis';
import { publicNewsScope } from './radar-content';
import { canonicalUrl, clipText, plainText } from './rules';

const KIND = 'comparison';
const maxReports = 6;
const publicComparisons = { published: true, articles: { some: {}, every: publicNewsScope() } } satisfies Prisma.NewsComparisonWhereInput;
const articleFields = {
  id: true, sourceId: true, title: true, sourceTitlePresent: true, summary: true, body: true, publishedAt: true,
  originalPublisher: true, originalUrl: true, url: true, sourceLinks: true, isManual: true,
} satisfies Prisma.NewsItemSelect;
type Article = Prisma.NewsItemGetPayload<{ select: typeof articleFields }>;
type Job = { id: string; title: string; ids: string[]; materialKey: string };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function materialFor(article: Article): ComparisonMaterial {
  const body = plainText(article.body);
  return { id: article.id, publisher: article.originalPublisher, publishedAt: article.publishedAt,
    title: article.sourceTitlePresent ? clipText(plainText(article.title), 350) : '',
    summary: clipText(plainText(article.summary), 650), body: clipText(body, 1300), bodyTruncated: body.length > 1300 };
}
function materialKey(materials: ComparisonMaterial[]) { return fingerprint([COMPARISON_VERSION, materials]); }

@Injectable()
export class NewsComparisonService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiRuntimeService) {}
  onModuleInit() { this.ai.register(KIND, (payload: Job, task) => this.generate(payload, task)); }

  private articles(ids: string[], db: Prisma.TransactionClient = this.prisma) {
    return db.newsItem.findMany({ where: publicNewsScope({ id: { in: ids } }), orderBy: { id: 'asc' }, select: articleFields });
  }

  async queue(body: unknown) {
    const value = body as { ids?: unknown; title?: unknown } | null;
    if (typeof value?.title !== 'string' || !value.title.trim() || value.title.length > 100) throw new BadRequestException('请填写不超过 100 字的事件名称');
    const title = value.title.trim();
    if (!Array.isArray(value.ids) || value.ids.length < 2 || value.ids.length > maxReports
      || value.ids.some(id => typeof id !== 'string' || !id || id.length > 100)
      || new Set(value.ids).size !== value.ids.length) throw new BadRequestException('请选择同一事件下 2–6 条不同的公开材料');
    const ids = (value.ids as string[]).sort();
    const articles = await this.articles(ids);
    if (articles.length !== ids.length) throw new ConflictException('部分材料已隐藏、删除或不再公开，请重新选择');
    const materials = articles.map(materialFor);
    if (materials.some(item => !item.title && !item.summary && !item.body)) throw new BadRequestException('部分材料没有可核对的文本');
    const id = fingerprint(ids);
    const key = materialKey(materials);
    const saved = await this.prisma.newsComparison.findUnique({ where: { id } });
    if (saved?.materialKey === key) {
      if (saved.title !== title || !saved.published) await this.prisma.newsComparison.update({ where: { id }, data: { title, published: true } });
      return { id, cached: true as const };
    }
    if (!await this.ai.isEnabled()) throw new BadRequestException('请先保存并启用 AI 配置');
    return this.ai.enqueue(KIND, { id, title, ids, materialKey: key }, { activeKey: `comparison:${id}` });
  }

  private async generate(job: Job, task: AiTask) {
    const currentMaterial = async (db: Prisma.TransactionClient) => {
      const rows = await this.articles(job.ids, db);
      const input = rows.map(materialFor);
      if (input.length !== job.ids.length || materialKey(input) !== job.materialKey) {
        throw new ConflictException('报道素材或公开状态已更新，请重新选择材料生成对照');
      }
      return { rows, input };
    };
    const { rows, input } = await currentMaterial(this.prisma);
    const output = await this.ai.performJson(COMPARISON_PROMPT, { articles: input }, 5200,
      async tx => { await currentMaterial(tx); }, rows.map(row => row.sourceId));
    let result: ComparisonAnalysis;
    try { result = parseComparison(output, input); }
    catch (error) {
      if (error instanceof InvalidAnalysisResponse) {
        await this.ai.noteProtocolError(error.detail);
        throw new InvalidAnalysisResponse(error.detail, this.ai.requestInfo()?.requestId);
      }
      throw error;
    }
    const data = JSON.stringify(result);
    await this.prisma.$transaction(async tx => {
      await currentMaterial(tx);
      const lease = await tx.aiTask.count({ where: { id: task.id, owner: task.owner, status: 'running', leaseUntil: { gt: new Date() } } });
      if (!lease) throw new ConflictException('新闻关联任务已失去租期，请重新提交');
      await tx.newsComparison.upsert({ where: { id: job.id },
        create: { id: job.id, title: job.title, materialKey: job.materialKey, data, articles: { connect: job.ids.map(id => ({ id })) } },
        update: { title: job.title, materialKey: job.materialKey, data, published: true } });
    });
    return { id: job.id };
  }

  adminList() {
    return this.prisma.newsComparison.findMany({ where: { published: true }, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true } });
  }

  async withdraw(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new BadRequestException('新闻关联链接无效');
    await this.prisma.$transaction(async tx => {
      if (await tx.aiTask.findUnique({ where: { activeKey: `comparison:${id}` }, select: { id: true } }))
        throw new ConflictException('对照正在生成，请等待任务结束后撤下');
      const changed = await tx.newsComparison.updateMany({ where: { id }, data: { published: false } });
      if (!changed.count) throw new NotFoundException('对照已不存在，请刷新列表');
    });
    return { id };
  }

  async read(id?: string, articleId?: string) {
    if ((id !== undefined && (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) ||
      (articleId !== undefined && (typeof articleId !== 'string' || !articleId || articleId.length > 100))) throw new BadRequestException('新闻关联链接无效');
    const events = await this.prisma.newsComparison.findMany({ where: publicComparisons,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 40,
      select: { id: true, title: true, updatedAt: true, _count: { select: { articles: true } } } });
    const entry = await this.prisma.newsComparison.findFirst({ where: { ...publicComparisons,
      ...(id ? { id } : articleId ? { articles: { ...publicComparisons.articles, some: { id: articleId } } } : { id: events[0]?.id ?? '' }) },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], include: { articles: { where: publicNewsScope(), orderBy: { id: 'asc' }, select: articleFields } } });
    if (!entry) return { events, status: 'missing' as const, comparison: null };
    const materials = entry.articles.map(materialFor);
    if (materialKey(materials) !== entry.materialKey) return { events, status: 'stale' as const, comparison: null };
    const comparison = JSON.parse(entry.data) as ComparisonAnalysis;
    const articles = entry.articles.map((article, index) => {
      const material = materials[index];
      const knownLinks = [...new Set((JSON.parse(article.sourceLinks) as string[]).map(canonicalUrl).filter((url): url is string => url !== null))];
      const originalUrl = article.originalUrl ? canonicalUrl(article.originalUrl) : null;
      const url = article.isManual && !originalUrl ? `/articles/${article.id}` : originalUrl ?? canonicalUrl(article.url);
      return { id: article.id, publisher: article.originalPublisher ?? '管理员录入', title: article.sourceTitlePresent ? article.title : null,
        publishedAt: article.publishedAt, url, hasBody: !!material.body, hasSummary: !!material.summary, bodyTruncated: material.bodyTruncated,
        knownLinks, originalUrl };
    });
    const recordedLinks = articles.flatMap((from, index) => articles.flatMap((to, targetIndex) => {
      if (index === targetIndex || !to.originalUrl) return [];
      if (from.originalUrl === to.originalUrl) return index < targetIndex ? [{ from: from.id, to: to.id, shared: true }] : [];
      if (!from.knownLinks.includes(to.originalUrl) || comparison.citations.some(edge => edge.from === from.id && edge.to === to.id)) return [];
      return [{ from: from.id, to: to.id, shared: false }];
    }));
    return { events, status: 'ready' as const, comparison: { id: entry.id, title: entry.title, updatedAt: entry.updatedAt,
      articles: articles.map(({ knownLinks, originalUrl, ...article }) => ({ ...article, sourceLinks: knownLinks.filter(url => url !== originalUrl).slice(0, 5) })), ...comparison, recordedLinks } };
  }
}
