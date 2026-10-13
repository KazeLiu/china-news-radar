import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiRuntimeService } from './ai-runtime.service';
import { NewsBridgeService } from './news-bridge.service';
import { contentScope, presentHotspot } from './radar-content';
import { NEWS_TOPICS } from './analysis';

export const TOPIC_LABELS: Record<string, string> = { policy: '政策', economy: '经济', diplomacy: '外交', technology: '科技', security: '安全', society: '社会' };
function string(value: unknown, max = 1200): string {
  if (typeof value !== 'string' || value.length > max) throw new BadRequestException('模型生成内容的类型或长度无效，已有结果已保留');
  return value;
}
function names(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) throw new BadRequestException('模型生成的关系列表无效，已有结果已保留');
  return [...new Set(value.map(name => string(name, 120)))];
}

@Injectable()
export class NewsEditorialService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiRuntimeService, private readonly bridge: NewsBridgeService) {}

  async getDigest(date: string) {
    const record = await this.prisma.newsDigest.findUnique({ where: { date } });
    if (!record) return null;
    const data = JSON.parse(record.data);
    const ids = [...(data.highlights || []), ...(data.sections || []).flatMap((section: any) => section.items)].map((item: any) => item.newsItemId);
    const allowed = new Set((await this.prisma.newsItem.findMany({ where: { id: { in: ids }, visible: true, originalPublisher: { not: null } }, select: { id: true } })).map(item => item.id));
    const keep = (item: any) => allowed.has(item.newsItemId);
    return { ...record, data: { ...data, summary: ids.some((id: string) => !allowed.has(id)) ? '' : data.summary,
      highlights: (data.highlights || []).filter(keep), sections: (data.sections || []).map((section: any) => ({ ...section, items: section.items.filter(keep) })) } };
  }
  async recentDigests(days = 62) {
    const records = await this.prisma.newsDigest.findMany({ orderBy: { date: 'desc' }, take: days });
    return Promise.all(records.map(async record => ({ date: record.date, summary: (await this.getDigest(record.date))?.data.summary || '', createdAt: record.createdAt })));
  }

  async generateDigest(date: string, force = true) {
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new BadRequestException('日报日期无效');
    return this.ai.withLease(`digest:${date}`, async () => {
      const existing = await this.getDigest(date);
      if (existing && !force) return;
      const day = new Date(`${date}T00:00:00+08:00`); day.setUTCDate(day.getUTCDate() - 1);
      const end = new Date(day.getTime() + 86_400_000);
      const window = { OR: [{ publishedAt: { gte: day, lt: end } }, { publishedAt: null, createdAt: { gte: day, lt: end } }] };
      let raw = await this.prisma.hotspot.findMany({ where: contentScope({ ...window, isClusterMain: true, isCurated: true }), include: { newsItem: true }, orderBy: { qualityScore: 'desc' }, take: 60 });
      if (raw.length < 5) raw = await this.prisma.hotspot.findMany({ where: contentScope({ ...window, isClusterMain: true }), include: { newsItem: true }, orderBy: [{ qualityScore: 'desc' }, { publishedAt: 'desc' }], take: 60 });
      const items = raw.map(presentHotspot);
      const linked = (item: typeof items[number], summary = item.summary || '') => ({ newsItemId: item.newsItemId, title: item.title, summary, source: item.originalPublisher || item.source, url: item.url });
      let data = { version: 2, summary: items.length ? `前一日共有 ${items.length} 条海外涉华报道。` : '',
        highlights: items.slice(0, 5).map(item => ({ ...linked(item), whyImportant: '', affects: [] as string[] })),
        sections: NEWS_TOPICS.map(key => ({ key, title: TOPIC_LABELS[key], items: items.filter(item => item.category === key).map(item => linked(item)) })),
        domestic: [], international: [], modelIntel: [], products: [], community: [], papers: [],
        generatedAt: new Date().toISOString(), itemCount: items.length, generationStatus: 'rules' };
      const config = await this.ai.config();
      if (items.length && config.enabled && config.apiKey) {
        const result = await this.ai.requestJson(`你是涉华新闻编辑。生成前一日简体中文日报，保留归属与不确定性。
返回 JSON：{"summary":"一段概述","highlights":[{"newsId":"提供的id","summary":"摘要","whyImportant":"依据原文解释影响","affects":["受影响对象"]}],"sections":[{"key":"policy|economy|diplomacy|technology|security|society","items":[{"newsId":"提供的id","summary":"摘要"}]}]}。
重点最多5条，每个主题最多10条；只能引用提供的 newsId，不生成链接。没有依据的内容返回空数组。`,
          { date, items: items.map(item => ({ id: item.id, title: item.title.slice(0, 600), summary: (item.summary || '').slice(0, 1600), topic: item.category })) });
        const resolve = (value: any) => {
          const item = items.find(item => item.id === value?.newsId);
          if (!item) throw new BadRequestException('模型引用了不在日报素材中的报道，已有结果已保留');
          return linked(item, string(value.summary));
        };
        if (!Array.isArray(result.highlights) || result.highlights.length > 5 || !Array.isArray(result.sections) || result.sections.length > 6) throw new BadRequestException('日报模型输出结构无效，已有结果已保留');
        const sections = result.sections as any[];
        if (sections.some(section => !NEWS_TOPICS.includes(section.key) || !Array.isArray(section.items) || section.items.length > 10)
          || new Set(sections.map(section => section.key)).size !== sections.length) throw new BadRequestException('日报主题列表无效，已有结果已保留');
        data = { ...data, summary: string(result.summary, 2400), generationStatus: 'ai',
          highlights: (result.highlights as any[]).map(value => ({ ...resolve(value), whyImportant: string(value.whyImportant), affects: names(value.affects) })),
          sections: NEWS_TOPICS.map(key => ({ key, title: TOPIC_LABELS[key], items: (sections.find(section => section.key === key)?.items || []).map(resolve) })) };
      } else if (existing) return;
      await this.prisma.newsDigest.upsert({ where: { date }, create: { date, data: JSON.stringify(data) }, update: { data: JSON.stringify(data) } });
    });
  }

  async profile(keywordId: string) {
    return this.ai.withLease(`profile:${keywordId}`, async () => {
      const keyword = await this.prisma.keyword.findUniqueOrThrow({ where: { id: keywordId } });
      const existing = await this.prisma.newsEntityProfile.findUnique({ where: { keywordId } });
      const config = await this.ai.config();
      let data = { version: 2, type: 'topic', summary: `${keyword.text} 的关注档案。`, aliases: [] as string[],
        relatedCountries: [] as string[], relatedOrganizations: [] as string[], relatedCompanies: [] as string[], relatedPeople: [] as string[],
        relatedModels: [], relatedProducts: [], competesWith: [], tags: [] as string[], generationStatus: 'rules' };
      if (config.enabled && config.apiKey) {
        const news = await this.prisma.hotspot.findMany({ where: contentScope({ OR: [{ title: { contains: keyword.text } }, { content: { contains: keyword.text } }, { newsItem: { is: { OR: [{ title: { contains: keyword.text } }, { summary: { contains: keyword.text } }] } } }] }), take: 8, orderBy: { createdAt: 'desc' } });
        const result = await this.ai.requestJson(`为关注词创建涉华档案，返回 JSON：{"type":"country|organization|company|person|topic","summary":"简体中文简介","aliases":[],"relatedCountries":[],"relatedOrganizations":[],"relatedCompanies":[],"relatedPeople":[],"tags":[]}。
简介与关联必须有给定报道支持；没有材料时只解释关注词，不臆测关联。每个列表最多8项；别名仅提供明确的中英文称呼。`,
          { keyword: keyword.text, reports: news.map(item => ({ title: item.title.slice(0, 600), summary: item.content.slice(0, 1600) })) });
        if (!['country', 'organization', 'company', 'person', 'topic'].includes(String(result.type))) throw new BadRequestException('关注档案的实体类型无效，已有结果已保留');
        data = { ...data, type: String(result.type), summary: string(result.summary), generationStatus: 'ai',
          aliases: names(result.aliases), relatedCountries: names(result.relatedCountries), relatedOrganizations: names(result.relatedOrganizations),
          relatedCompanies: names(result.relatedCompanies), relatedPeople: names(result.relatedPeople), tags: names(result.tags) };
      } else if (existing && JSON.parse(existing.data).generationStatus !== 'pending') return;
      await this.prisma.newsEntityProfile.upsert({ where: { keywordId }, create: { keywordId, data: JSON.stringify(data) }, update: { data: JSON.stringify(data), generatedAt: new Date() } });
      await this.bridge.rebuild();
    });
  }
}
