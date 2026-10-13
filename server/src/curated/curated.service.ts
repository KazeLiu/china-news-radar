import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { contentScope, newsInclude, newsMode, presentHotspot } from '../news/radar-content';

export type CuratedPeriod = 'today' | 'week';

export interface CuratedFilter {
  period?: CuratedPeriod;
  limit?: number;
  offset?: number;
  /** 'model' | 'product' | 'industry' | 'research' | 'community' | 'tips' */
  category?: string;
  /** 'domestic' | 'international' */
  region?: string;
  /** Free-text search across title / summary / content */
  search?: string;
  source?: string;
}

@Injectable()
export class CuratedService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurated(filter: CuratedFilter = {}) {
    const { period = 'today', limit = 20, offset = 0, category, region, search, source } = filter;
    if (!['today', 'week'].includes(period) || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new BadRequestException('精选日期或分页参数无效');
    const now = new Date();
    // Beijing time offset = UTC+8
    const beijingNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const today = beijingNow.toISOString().slice(0, 10);

    let dateFrom: Date;
    if (period === 'today') {
      // Today in Beijing time: from 00:00 UTC+8 = previous day 16:00 UTC
      dateFrom = new Date(`${today}T00:00:00+08:00`);
    } else {
      // Past 7 days
      dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    const where: any = {
      ...(newsMode() ? {} : { isCurated: true }),
      isClusterMain: true,
      // Filter by actual publish time, not DB ingestion time. An old article
      // scraped today by Bing would otherwise leak into "今日精选" — its createdAt
      // is today but publishedAt was days/weeks ago. Fall back to createdAt only
      // for items that genuinely have no publishedAt (rare).
      OR: [
        { publishedAt: { gte: dateFrom } },
        { AND: [{ publishedAt: null }, { createdAt: { gte: dateFrom } }] },
      ],
    };
    if (category) {
      if (newsMode()) where.AND = [{ newsItem: { is: { OR: [{ topic: category }, { aiTopics: { contains: JSON.stringify(category) } }] } } }];
      else where.category = category;
    }
    if (region) where.region = region;
    if (source) where.AND = [...(where.AND || []), newsMode() ? { newsItem: { is: { sourceId: source } } } : { source }];
    if (search?.trim()) {
      // Search adds a second OR — combine into AND so both date and text constraints apply.
      const dateOr = where.OR;
      delete where.OR;
      where.AND = [
        ...(where.AND || []),
        { OR: dateOr },
        {
          OR: [
            { title:   { contains: search.trim() } },
            { summary: { contains: search.trim() } },
            { content: { contains: search.trim() } },
            ...(newsMode() ? [{ newsItem: { is: { OR: [{ title: { contains: search.trim() } }, { summary: { contains: search.trim() } }] } } }] : []),
          ],
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.hotspot.findMany({
        where: contentScope(where),
        orderBy: newsMode() ? [
          { qualityScore: 'desc' },
          { publishedAt: 'desc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ] : [{ publishedAt: 'desc' }, { createdAt: 'desc' }, { qualityScore: 'desc' }],
        take: limit,
        skip: offset,
        include: { keyword: true, ...newsInclude() },
      }),
      this.prisma.hotspot.count({ where: contentScope(where) }),
    ]);

    return {
      period,
      total,
      limit,
      offset,
      items: items.map(presentHotspot),
    };
  }
}
