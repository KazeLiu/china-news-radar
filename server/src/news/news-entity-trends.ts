import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { readCachedEntityEvidence } from './analysis';
import { entityKey, type EntityEvidence, type EntityExcerpt, type EntityMention } from './news-entity-evidence';
import { publicNewsScope } from './radar-content';
import { canonicalUrl } from './rules';

const BEIJING_OFFSET = 8 * 60 * 60 * 1000;
const TOP_COUNT = 10;
const SAMPLE_COUNT = 8;
const newsFields = {
  id: true, title: true, displayTitle: true, aiGeneratedTitle: true, titleZh: true,
  originalPublisher: true, originalUrl: true, url: true, publishedAt: true, firstSeenAt: true,
  aiStatus: true, analysisKey: true, sourceTitlePresent: true,
} as const;

type Report = { id: string; title: string; publisher: string; date: Date; originalUrl: string | null };
type Sample = { report: Report; excerpts: EntityExcerpt[]; statements?: (EntityExcerpt & { from: string; to: string; label: string })[] };
type Count = { count: number; samples: Sample[] };
type Node = Count & { id: string; name: string; kind: EntityMention['kind'] };
type Edge = Count & { id: string; from: string; to: string; explicitCount: number };

function windowFor(date: Date, period: 'day' | 'week' | 'month') {
  const start = new Date(date.getTime() + BEIJING_OFFSET);
  start.setUTCHours(0, 0, 0, 0);
  if (period === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (period === 'month') start.setUTCDate(1);
  const end = new Date(start);
  if (period === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + (period === 'week' ? 7 : 1));
  return {
    firstDay: start.toISOString().slice(0, 10), lastDay: new Date(end.getTime() - 1).toISOString().slice(0, 10),
    range: { gte: new Date(start.getTime() - BEIJING_OFFSET), lt: new Date(end.getTime() - BEIJING_OFFSET) },
  };
}

function addSample(count: Count, sample: Sample, anchorId?: string) {
  count.count++;
  const priority = (sample: Sample) => sample.report.id === anchorId ? 2 : sample.statements?.length ? 1 : 0;
  const index = count.samples.findIndex(previous => priority(previous) < priority(sample));
  if (index !== -1) count.samples.splice(index, 0, sample);
  else if (count.samples.length < SAMPLE_COUNT) count.samples.push(sample);
  if (count.samples.length > SAMPLE_COUNT) count.samples.pop();
}

@Controller('api/news/entity-trends')
export class NewsEntityTrendsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query('period') requestedPeriod: unknown, @Query('article') requestedArticle: unknown) {
    const period = requestedPeriod === 'week' || requestedPeriod === 'month' ? requestedPeriod : 'day';
    const articleId = typeof requestedArticle === 'string' && requestedArticle.length <= 100 ? requestedArticle : undefined;
    const anchor = articleId ? await this.prisma.newsItem.findFirst({ where: publicNewsScope({ id: articleId }), select: { publishedAt: true, firstSeenAt: true } }) : null;
    const { range, firstDay, lastDay } = windowFor(anchor?.publishedAt ?? anchor?.firstSeenAt ?? new Date(), period);
    const rows = await this.prisma.newsItem.findMany({
      where: publicNewsScope({ OR: [{ publishedAt: range }, { publishedAt: null, firstSeenAt: range }] }),
      select: newsFields,
    });
    const dateOf = (row: typeof rows[number]) => row.publishedAt ?? row.firstSeenAt;
    rows.sort((a, b) => dateOf(b).getTime() - dateOf(a).getTime() || a.id.localeCompare(b.id));

    const keys = [...new Set(rows.flatMap(row => row.aiStatus === 'done' && row.analysisKey ? [row.analysisKey] : []))];
    const results = new Map<string, NonNullable<ReturnType<typeof readCachedEntityEvidence>>>();
    for (let offset = 0; offset < keys.length; offset += 400) {
      const caches = await this.prisma.newsAnalysis.findMany({
        where: { key: { in: keys.slice(offset, offset + 400) }, status: 'done' },
        select: { key: true, inputJson: true, resultJson: true },
      });
      for (const cache of caches) {
        if (!cache.resultJson) continue;
        try {
          const result = readCachedEntityEvidence(cache.resultJson, cache.inputJson);
          if (result) results.set(cache.key, result);
        } catch { /* Malformed cached evidence does not count towards coverage. */ }
      }
    }

    const bySourceUrl = new Map<string, { report: Report; evidence?: EntityEvidence }>();
    let article: (Report & { analyzed: boolean; mentions: EntityMention[] }) | null = null;
    for (const row of rows) {
      const originalKey = row.originalUrl ? canonicalUrl(row.originalUrl) : null;
      const key = originalKey ?? canonicalUrl(row.url) ?? row.id;
      const result = row.aiStatus === 'done' && row.analysisKey ? results.get(row.analysisKey) : undefined;
      const evidence = result && result.sourceTitlePresent === row.sourceTitlePresent ? result.evidence : undefined;
      const report = { id: row.id, title: row.displayTitle ?? row.aiGeneratedTitle ?? row.titleZh ?? row.title,
        publisher: row.originalPublisher || '管理员录入', date: dateOf(row), originalUrl: originalKey ? row.originalUrl : null };
      if (row.id === articleId) article = { ...report, analyzed: !!evidence, mentions: evidence?.mentions ?? [] };
      const previous = bySourceUrl.get(key);
      if (!previous || (evidence && evidence.mentions.length > (previous.evidence?.mentions.length ?? -1))) {
        bySourceUrl.set(key, { report, evidence });
      }
    }

    const nodesById = new Map<string, Node>();
    let analyzed = 0;
    for (const { report, evidence } of bySourceUrl.values()) {
      if (!evidence) continue;
      analyzed++;
      for (const mention of evidence.mentions) {
        const { name, kind, field, excerpt } = mention;
        const id = entityKey(mention);
        const node = nodesById.get(id) ?? { id, name, kind, count: 0, samples: [] };
        addSample(node, { report, excerpts: [{ field, excerpt }] }, articleId);
        nodesById.set(id, node);
      }
    }
    const nodes = [...nodesById.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)).slice(0, TOP_COUNT);
    const rankedIds = new Set(nodes.map(node => node.id));
    const edgesById = new Map<string, Edge>();
    for (const { report, evidence } of bySourceUrl.values()) {
      if (!evidence) continue;
      const ids = evidence.mentions.map(entityKey);
      const ranked = ids.flatMap((id, index) => rankedIds.has(id) ? [index] : []);
      for (const [position, left] of ranked.entries()) for (const right of ranked.slice(position + 1)) {
        const [from, to] = [ids[left], ids[right]].sort();
        const id = JSON.stringify([from, to]);
        const edge = edgesById.get(id) ?? { id, from, to, count: 0, explicitCount: 0, samples: [] };
        const statements = evidence.relations.flatMap(relation =>
          (relation.from === left && relation.to === right) || (relation.from === right && relation.to === left)
            ? [{ field: relation.field, excerpt: relation.excerpt, label: relation.label, from: ids[relation.from], to: ids[relation.to] }] : []);
        const excerpts = [left, right].map(index => {
          const { field, excerpt } = evidence.mentions[index];
          return { field, excerpt };
        });
        if (excerpts[0].field === excerpts[1].field && excerpts[0].excerpt === excerpts[1].excerpt) excerpts.pop();
        if (statements.length) edge.explicitCount++;
        addSample(edge, { report, excerpts, ...(statements.length ? { statements } : {}) }, articleId);
        edgesById.set(id, edge);
      }
    }
    return { period, firstDay, lastDay, articleRequested: !!articleId,
      article: article && { ...article, mentions: article.mentions.map(mention => ({ ...mention, id: entityKey(mention) })) },
      coverage: { analyzed, total: bySourceUrl.size }, nodes, edges: [...edgesById.values()].sort((a, b) => b.count - a.count) };
  }
}
