import { Body, Controller, Delete, Get, Header, Headers, Param, Patch, Post, Put, Query, UnauthorizedException, ForbiddenException, Req, UseInterceptors } from '@nestjs/common';
import { validCollectorToken, requireCollector } from './collector-access';
export { validCollectorToken } from './collector-access';
import { NewsService } from './news.service';
import { requireAdmin, AdminRequest } from './admin-access';
import { NewsAuditInterceptor } from './news-audit.interceptor';
import { NewsTrashService } from './news-trash.service';

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
  constructor(private readonly news: NewsService, private readonly trash: NewsTrashService) {}
  @Get('health') health() { return { ok: true, mode: 'news' }; }
  @Get('items') items(@Query() query: Parameters<NewsService['items']>[0]) { return this.news.items(query); }
  @Get('items/:id') article(@Param('id') id: string) { return this.news.article(id); }
  @Get('admin/items') adminItems(@Query() query: Parameters<NewsService['adminItems']>[0]) { return this.news.adminItems(query); }
  @Get('admin/items/:id') adminItem(@Param('id') id: string) { return this.news.adminItemsById(id); }
  @Post('admin/items') createManual(@Body() body: unknown) { return this.news.saveManual(body); }
  @Post('admin/items/import') importManual(@Body() body: unknown) { return this.news.importManual(body); }
  @Post('admin/items/batch') batch(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.trash.batch(body); }
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
  @Get('admin/network/private') @Header('Cache-Control', 'no-store') networkPrivate(@Req() req: AdminRequest) { requireAdmin(req); return this.news.adminNetworkPrivate(); }
  @Put('admin/network') network(@Body() body: unknown) { return this.news.configureNetwork(body); }
  @Put('admin/browser') browser(@Body() body: unknown) { return this.news.configureBrowser(body); }
  @Put('admin/ai') ai(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.configureAi(body); }
  @Post('admin/ai/test') testAi(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.testAi(body); }
  @Post('admin/ai/models') @Header('Cache-Control', 'no-store') aiModels(@Body() body: Parameters<NewsService['aiModels']>[0], @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.aiModels(body); }
  @Post('admin/ai/history') history(@Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.startHistory(); }
  @Put('admin/sources') configureSource(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.configureSource(body); }
  @Get('admin/sources/export') @Header('Cache-Control', 'no-store') exportSources(@Req() req: AdminRequest) { requireAdmin(req); return this.news.exportSources(); }
  @Post('admin/sources/import/preview') @Header('Cache-Control', 'no-store') previewSourceImport(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.previewSourceImport(body); }
  @Post('admin/sources/import') @Header('Cache-Control', 'no-store') importSources(@Body() body: Parameters<NewsService['importSources']>[0], @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.importSources(body); }
  @Get('admin/sources/:id/private') @Header('Cache-Control', 'no-store') privateSource(@Param('id') id: string, @Req() req: AdminRequest) { requireAdmin(req); return this.news.privateSource(id); }
  @Delete('admin/sources/:id') deleteSource(@Param('id') id: string, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.deleteSource(id); }
  @Post('admin/sources/test') testSource(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.testSource(body); }
  @Post('admin/sources/:id/collect') collectSource(@Param('id') id: string, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.collectSource(id); }
  @Post('admin/sources/page') @Header('Cache-Control', 'no-store') previewPage(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.previewWebPage(body, req.adminSessionId!); }
  @Post('admin/sources/rules/test') @Header('Cache-Control', 'no-store') testWebRules(@Body() body: Parameters<NewsService['testWebRules']>[0], @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.testWebRules(body, req.adminSessionId!); }
  @Post('admin/sources/rules/assist') assistRules(@Body() body: unknown, @Req() req: AdminRequest) { return this.news.generateParserRules(body, req.adminSessionId!); }
  @Post('admin/sources/rules/preview') previewParserRules(@Body() body: Parameters<NewsService['previewParserRules']>[0], @Req() req: AdminRequest) { return this.news.previewParserRules(body, req.adminSessionId!); }
  @Post('admin/sources/rules/apply') applyRules(@Body() body: Parameters<NewsService['applyParserRules']>[0], @Req() req: AdminRequest) { return this.news.applyParserRules(body, req.adminSessionId!); }
  @Post('admin/sources/:id/rules/restore') restoreRules(@Param('id') id: string) { return this.news.restoreParserRules(id); }
  @Put('admin/rules') rules(@Body() body: unknown, @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.configureRules(body); }
  @Post('admin/rules/preview') preview(@Body() body: Parameters<NewsService['previewRules']>[0], @Req() req: AdminRequest) { sameOrigin(req); requireAdmin(req); return this.news.previewRules(body); }
  @Post('telegram') ingest(@Headers('authorization') auth: string | undefined, @Body() body: Parameters<NewsService['ingest']>[0]) {
    if (!validCollectorToken(auth)) throw new UnauthorizedException('采集令牌无效或未配置');
    return this.news.ingest(body);
  }
  @Get('telegram/sources') @Header('Cache-Control', 'no-store') telegramSources(@Req() req: AdminRequest) {
    requireCollector(req.headers);
    return this.news.telegramSources();
  }
}
