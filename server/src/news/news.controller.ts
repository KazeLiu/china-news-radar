import { Body, Controller, Delete, Get, Header, Headers, Param, Patch, Post, Put, Query, UnauthorizedException, ForbiddenException, Req, UseInterceptors } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { NewsService } from './news.service';
import { requireAdmin, AdminRequest } from './admin-access';
import { NewsAuditInterceptor } from './news-audit.interceptor';

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
@UseInterceptors(NewsAuditInterceptor)
export class NewsController {
  constructor(private readonly news: NewsService) {}
  @Get('health') health() { return { ok: true, mode: 'news' }; }
  @Get('items') items(@Query() query: Parameters<NewsService['items']>[0]) { return this.news.items(query); }
  @Get('items/:id') article(@Param('id') id: string) { return this.news.article(id); }
  @Get('admin/items') adminItems(@Query() query: Parameters<NewsService['adminItems']>[0]) { return this.news.adminItems(query); }
  @Get('admin/items/:id') adminItem(@Param('id') id: string) { return this.news.adminItemsById(id); }
  @Post('admin/items') createManual(@Body() body: unknown) { return this.news.saveManual(body); }
  @Post('admin/items/import') importManual(@Body() body: unknown) { return this.news.importManual(body); }
  @Put('admin/items/:id') editManual(@Param('id') id: string, @Body() body: unknown) { return this.news.saveManual(body, id); }
  @Patch('admin/items/:id/display') display(@Param('id') id: string, @Body() body: unknown) { return this.news.displayState(id, body); }
  @Post('admin/items/:id/analyze') analyzeManual(@Param('id') id: string) { return this.news.analyzeManual(id); }
  @Post('admin/items/:id/publish') publishManual(@Param('id') id: string) { return this.news.publishManual(id); }
  @Get('sources') sources() { return this.news.sources(); }
  @Get('status') status() { return this.news.status(); }
  @Post('scan') scan(@Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.scan(); }
  @Patch('items/:id/saved') save(@Param('id') id: string, @Body() body: { saved?: unknown }, @Req() req: Parameters<typeof sameOrigin>[0]) { sameOrigin(req); return this.news.save(id, body.saved); }
  @Patch('sources/:id') source(@Param('id') id: string, @Body() body: { enabled?: unknown }, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.enableSource(id, body.enabled); }
  @Get('admin/config') config(@Req() req: AdminRequest) { requireAdmin(req); return this.news.adminConfig(); }
  @Get('admin/ai/key') @Header('Cache-Control', 'no-store') aiKey(@Req() req: AdminRequest) { requireAdmin(req); return this.news.adminAiKey(); }
  @Put('admin/ai') ai(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.configureAi(body); }
  @Post('admin/ai/test') testAi(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.testAi(body); }
  @Post('admin/ai/history') history(@Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.startHistory(); }
  @Put('admin/sources') configureSource(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.configureSource(body); }
  @Get('admin/sources/:id/private') @Header('Cache-Control', 'no-store') privateSource(@Param('id') id: string, @Req() req: AdminRequest) { requireAdmin(req); return this.news.privateSource(id); }
  @Delete('admin/sources/:id') deleteSource(@Param('id') id: string, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.deleteSource(id); }
  @Post('admin/sources/test') testSource(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.testSource(body); }
  @Post('admin/sources/rules/assist') assistRules(@Body() body: unknown) { return this.news.generateParserRules(body); }
  @Post('admin/sources/rules/apply') applyRules(@Body() body: Parameters<NewsService['applyParserRules']>[0]) { return this.news.applyParserRules(body); }
  @Post('admin/sources/:id/rules/restore') restoreRules(@Param('id') id: string) { return this.news.restoreParserRules(id); }
  @Put('admin/rules') rules(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.configureRules(body); }
  @Post('admin/rules/preview') preview(@Body() body: Parameters<NewsService['previewRules']>[0], @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.previewRules(body); }
  @Post('telegram') ingest(@Headers('authorization') auth: string | undefined, @Body() body: Parameters<NewsService['ingest']>[0]) {
    if (!validCollectorToken(auth)) throw new UnauthorizedException('采集令牌无效或未配置');
    return this.news.ingest(body);
  }
  @Get('telegram/sources') @Header('Cache-Control', 'no-store') telegramSources(@Headers('authorization') auth: string | undefined) {
    if (!validCollectorToken(auth)) throw new UnauthorizedException('采集令牌无效或未配置');
    return this.news.telegramSources();
  }
}
