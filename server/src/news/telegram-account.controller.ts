import { Body, Controller, Get, Header, Post, Put, Req, UseInterceptors } from '@nestjs/common';
import { TelegramAccountService } from './telegram-account.service';
import { requireCollector } from './collector-access';
import { NewsAuditInterceptor } from './news-audit.interceptor';

@Controller('api/news')
@UseInterceptors(NewsAuditInterceptor)
export class TelegramAccountController {
  constructor(private readonly account: TelegramAccountService) {}
  @Get('admin/telegram') @Header('Cache-Control', 'no-store') status() { return this.account.status(); }
  @Put('admin/telegram') @Header('Cache-Control', 'no-store') save(@Body() body: Parameters<TelegramAccountService['save']>[0]) { return this.account.save(body); }
  @Get('telegram/credentials') @Header('Cache-Control', 'no-store') credentials(@Req() req: { headers: Record<string, string | string[] | undefined> }) {
    requireCollector(req.headers); return this.account.credentials();
  }
  @Post('telegram/status') @Header('Cache-Control', 'no-store') report(@Req() req: { headers: Record<string, string | string[] | undefined> }, @Body() body: Parameters<TelegramAccountService['report']>[0]) {
    requireCollector(req.headers); return this.account.report(body);
  }
}
