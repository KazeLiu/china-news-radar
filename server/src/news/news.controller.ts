import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, UnauthorizedException, ForbiddenException, Req } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { NewsService } from './news.service';
import { requireAdmin, AdminRequest } from './admin-access';

export function validCollectorToken(header: string | undefined, token = process.env.COLLECTOR_TOKEN) {
  if (!token || token.length < 32 || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7)); const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
// Browsers must write from the configured reader origin. CLI and internal worker requests have no Origin.
function sameOrigin(req: { headers: Record<string, string | string[] | undefined> }) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = [process.env.CLIENT_URL || 'http://localhost:3000', process.env.PUBLIC_SITE_URL].filter(Boolean);
  if (!allowed.includes(String(origin))) throw new ForbiddenException('不允许跨站修改');
}
@Controller('api/news')
export class NewsController {
  constructor(private readonly news: NewsService) {}
  @Get('health') health() { return { ok: true, mode: 'news' }; }
  @Get('items') items(@Query() query: Parameters<NewsService['items']>[0]) { return this.news.items(query); }
  @Get('sources') sources() { return this.news.sources(); }
  @Get('status') status() { return this.news.status(); }
  @Post('scan') scan(@Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.scan(); }
  @Patch('items/:id/saved') save(@Param('id') id: string, @Body() body: { saved?: unknown }, @Req() req: Parameters<typeof sameOrigin>[0]) { sameOrigin(req); return this.news.save(id, body.saved); }
  @Patch('sources/:id') source(@Param('id') id: string, @Body() body: { enabled?: unknown }, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.enableSource(id, body.enabled); }
  @Get('admin/config') config(@Req() req: AdminRequest) { requireAdmin(req); return this.news.adminConfig(); }
  @Put('admin/ai') ai(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.configureAi(body); }
  @Post('admin/ai/test') testAi(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.testAi(body); }
  @Put('admin/sources') configureSource(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.configureSource(body); }
  @Delete('admin/sources/:id') deleteSource(@Param('id') id: string, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.deleteSource(id); }
  @Post('admin/sources/test') testSource(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.testSource(body); }
  @Put('admin/rules') rules(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.configureRules(body); }
  @Post('admin/rules/preview') preview(@Body() body: Parameters<NewsService['previewRules']>[0], @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.previewRules(body); }
  @Post('telegram') ingest(@Headers('authorization') auth: string | undefined, @Body() body: Parameters<NewsService['ingest']>[0]) {
    if (!validCollectorToken(auth)) throw new UnauthorizedException('采集令牌无效或未配置');
    return this.news.ingest(body);
  }
}
