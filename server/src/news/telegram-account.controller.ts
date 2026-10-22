import { BadRequestException, Body, Controller, Get, Header, Post, Put, Req, ServiceUnavailableException, UseInterceptors } from '@nestjs/common';
import { TelegramAccountService } from './telegram-account.service';
import { TelegramControlService } from './telegram-control.service';
import { requireCollector } from './collector-access';
import { NewsAuditInterceptor } from './news-audit.interceptor';
import { TelegramLocalService } from './telegram-local.service';
import { AdminRequest, requireAdminMutation } from './admin-access';

@Controller('api/news')
@UseInterceptors(NewsAuditInterceptor)
export class TelegramAccountController {
  constructor(private readonly account: TelegramAccountService, private readonly local: TelegramLocalService, private readonly control: TelegramControlService) {}
  private owner(req: AdminRequest) { requireAdminMutation(req); return req.adminSessionId!; }
  @Get('admin/telegram') @Header('Cache-Control', 'no-store') async status(@Req() req: AdminRequest) {
    return { ...await this.account.status(), control: this.control.status(req.adminSessionId), local: this.local.status() };
  }
  @Put('admin/telegram') @Header('Cache-Control', 'no-store') async save(@Req() req: AdminRequest, @Body() body: Parameters<TelegramAccountService['save']>[0]) {
    this.owner(req);
    const previous = await this.account.credentials();
    await this.account.save(body);
    if ((await this.account.credentials()).revision !== previous.revision) this.control.cancel();
    return this.status(req);
  }
  @Post('admin/telegram/service/start') @Header('Cache-Control', 'no-store') service(@Req() req: AdminRequest) {
    this.owner(req); this.local.start(); return this.status(req);
  }
  @Post('admin/telegram/auth/start') @Header('Cache-Control', 'no-store') async start(@Req() req: AdminRequest) {
    await this.control.start(this.owner(req)); return this.status(req);
  }
  @Post('admin/telegram/auth/input') @Header('Cache-Control', 'no-store') input(@Req() req: AdminRequest, @Body() body: Parameters<TelegramControlService['submit']>[1]) {
    this.control.submit(this.owner(req), body); return this.status(req);
  }
  @Post('admin/telegram/auth/cancel') @Header('Cache-Control', 'no-store') cancel(@Req() req: AdminRequest) {
    this.control.cancel(this.owner(req)); return this.status(req);
  }
  @Post('admin/telegram/collection') @Header('Cache-Control', 'no-store') async collection(@Req() req: AdminRequest, @Body() body: { enabled?: unknown }) {
    this.owner(req);
    if (typeof body?.enabled !== 'boolean') throw new BadRequestException('采集开关无效');
    this.control.cancel(); this.control.clearFinishedAuthorization(); await this.account.setEnabled(body.enabled); this.control.restartCollection(); return this.status(req);
  }
  @Get('telegram/credentials') @Header('Cache-Control', 'no-store') credentials(@Req() req: AdminRequest) {
    requireCollector(req.headers); return this.account.credentials();
  }
  @Post('telegram/control') @Header('Cache-Control', 'no-store') poll(@Req() req: AdminRequest, @Body() body: Parameters<TelegramControlService['poll']>[0]) {
    requireCollector(req.headers); return this.control.poll(body);
  }
  @Post('telegram/auth/report') @Header('Cache-Control', 'no-store') async progress(@Req() req: AdminRequest, @Body() body: Parameters<TelegramControlService['report']>[0]) {
    requireCollector(req.headers);
    const result = this.control.report(body);
    if (body.phase === 'authorized') {
      try { await this.account.setEnabled(true); }
      catch { this.control.completionFailed(body.id); throw new ServiceUnavailableException('无法保存 Telegram 采集开关'); }
      this.control.restartCollection();
    }
    return result;
  }
  @Post('telegram/status') @Header('Cache-Control', 'no-store') report(@Req() req: AdminRequest, @Body() body: Parameters<TelegramAccountService['report']>[0]) {
    requireCollector(req.headers); return this.account.report(body);
  }
}
