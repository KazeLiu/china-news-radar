import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { contentScope, newsInclude, presentHotspot } from '../news/radar-content';

@Injectable()
export class AgentService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurated(limit = 20, offset = 0) {
    const items = await this.prisma.hotspot.findMany({
      where: contentScope({ isCurated: true, isClusterMain: true }),
      include: newsInclude(),
      orderBy: [{ qualityScore: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
    });
    return items.map(presentHotspot);
  }

  async search(q: string, limit = 20) {
    const keywords = q.split(/\s+/).filter((w) => w.length > 0).slice(0, 5);
    const conditions = keywords.map((kw) => ({
      OR: [{ title: { contains: kw } }, { summary: { contains: kw } }],
    }));
    const items = await this.prisma.hotspot.findMany({
      where: contentScope({ AND: conditions }),
      include: newsInclude(),
      orderBy: [{ qualityScore: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return items.map(presentHotspot);
  }

  async getStats() {
    const total = await this.prisma.hotspot.count({ where: contentScope() });
    const curated = await this.prisma.hotspot.count({ where: contentScope({ isCurated: true }) });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = await this.prisma.hotspot.count({ where: contentScope({ createdAt: { gte: today } }) });
    return { total, curated, today: todayCount, updatedAt: new Date().toISOString() };
  }

  /** Build RSS 2.0 XML for a list of hotspots */
  buildRssXml(title: string, description: string, items: Array<{
    title: string; url: string; summary?: string | null;
    publishedAt?: Date | null; source: string; originalPublisher?: string | null;
  }>): string {
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const itemsXml = items.map((item) => `
    <item>
      <title>${escape(item.title)}</title>
      <link>${escape(new URL(item.url, process.env.PUBLIC_SITE_URL || process.env.CLIENT_URL || 'http://localhost:3000').href)}</link>
      <description>${escape(item.summary || item.title)}</description>
      <pubDate>${(item.publishedAt || new Date()).toUTCString()}</pubDate>
      <source>${escape(item.originalPublisher || item.source)}</source>
    </item>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escape(title)}</title>
    <description>${escape(description)}</description>
    <link>${escape(process.env.PUBLIC_SITE_URL || process.env.CLIENT_URL || 'http://localhost:3000')}</link>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${itemsXml}
  </channel>
</rss>`;
  }
}
