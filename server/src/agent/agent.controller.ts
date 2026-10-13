import { Controller, Get, Query, Res, Header } from '@nestjs/common';
import { AgentService } from './agent.service';
import { PrismaService } from '../prisma/prisma.service';
import { contentScope, presentHotspot } from '../news/radar-content';
import { DigestService } from '../digest/digest.service';
import { CuratedPeriod } from '../curated/curated.service';

@Controller()
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly prisma: PrismaService,
    private readonly digestService: DigestService,
  ) {}

  // ===== REST API =====

  @Get('api/agent/curated')
  getCurated(
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
    @Query('period') period: CuratedPeriod = 'today',
    @Query('source') source?: string,
    @Query('category') category?: string,
    @Query('region') region?: string,
    @Query('search') search?: string,
  ) {
    return this.agentService.getCurated(Number(limit), Number(offset), { period, source, category, region, search });
  }

  @Get('api/agent/search')
  search(@Query('q') q = '', @Query('limit') limit = '20') {
    return this.agentService.search(q, Number(limit));
  }

  @Get('api/agent/stats')
  getStats() {
    return this.agentService.getStats();
  }

  @Get('api/agent/digest')
  async getDigest(@Query('date') date?: string) {
    const targetDate = date || this.getTodayBeijing();
    return this.digestService.getDigestByDate(targetDate);
  }

  // ===== RSS Feeds =====

  @Get('api/agent/rss/curated.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async getCuratedRss(@Res() res: any) {
    const items = await this.agentService.getCurated(50, 0);
    const xml = this.agentService.buildRssXml(
      'China Radar · 精选资讯',
      '全部通过涉华与展示规则筛选的报道，质量评分仅用于排序',
      items,
    );
    res.type('application/xml').send(xml);
  }

  @Get('api/agent/rss/all.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async getAllRss(@Res() res: any) {
    const items = await this.prisma.hotspot.findMany({
      where: contentScope({ isClusterMain: true }),
      include: { newsItem: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const xml = this.agentService.buildRssXml(
      'China Radar · 全部资讯',
      '海外涉华资讯与关键词监控',
      items.map(presentHotspot),
    );
    res.type('application/xml').send(xml);
  }

  @Get('api/agent/rss/digest.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async getDigestRss(@Res() res: any) {
    const digests = await this.digestService.getRecentDigests(7);
    const baseUrl = process.env.PUBLIC_SITE_URL || process.env.PUBLIC_URL || process.env.CLIENT_URL || 'http://localhost:3000';
    const items = digests.map((d) => ({
      title: `涉华日报 ${d.date}`,
      url: `${baseUrl}/digest/${d.date}`,
      summary: `${d.date} 的海外涉华精选日报`,
      publishedAt: d.createdAt,
      source: 'China Radar Daily',
    }));
    const xml = this.agentService.buildRssXml(
      'China Radar · AI 日报',
      '每日海外涉华精选资讯日报',
      items,
    );
    res.type('application/xml').send(xml);
  }

  // ===== Skill Descriptor =====

  @Get('aihot-skill')
  getSkill() {
    return {
      name: 'China Radar',
      version: '1.0',
      description: '海外涉华新闻查询：精选资讯、每日日报与关键词搜索',
      endpoints: [
        {
          path: '/api/agent/curated',
          method: 'GET',
          description: '获取通过内容筛选的涉华资讯，质量评分只用于排序',
          params: { limit: '条数（默认20，最多100）', offset: '偏移（默认0）', period: 'today 或 week（默认today）', source: '来源 ID（可选）', category: '主题（可选）', region: '地区（可选）', search: '标题与摘要搜索（可选）' },
        },
        {
          path: '/api/agent/digest',
          method: 'GET',
          description: '获取 AI 日报',
          params: { date: '日期 YYYY-MM-DD（默认今天）' },
        },
        {
          path: '/api/agent/search',
          method: 'GET',
          description: '按关键词搜索涉华资讯',
          params: { q: '搜索关键词', limit: '条数（默认20）' },
        },
        {
          path: '/api/agent/stats',
          method: 'GET',
          description: '获取系统统计数据',
        },
        {
          path: '/api/agent/rss/curated.xml',
          method: 'GET',
          description: '精选资讯 RSS Feed',
        },
        {
          path: '/api/agent/rss/all.xml',
          method: 'GET',
          description: '全部资讯 RSS Feed',
        },
        {
          path: '/api/agent/rss/digest.xml',
          method: 'GET',
          description: 'AI 日报 RSS Feed',
        },
      ],
    };
  }

  private getTodayBeijing(): string {
    const now = new Date();
    const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return beijing.toISOString().slice(0, 10);
  }
}
