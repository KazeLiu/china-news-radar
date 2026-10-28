import { BadRequestException, Body, Controller, Get, Header, Post, Req, Res } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { AdminRequest, requireAdmin, requireAdminMutation } from './admin-access';
import { requireCollector } from './collector-access';
import { ConfigMigrationService } from './config-migration.service';
import { MIGRATION_LIMIT } from './config-migration-format';
import { TelegramControlService } from './telegram-control.service';

async function binaryBody(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/octet-stream') throw new BadRequestException('请上传二进制迁移文件');
  if (Number(req.headers['content-length']) > MIGRATION_LIMIT) throw new BadRequestException('迁移文件不能超过 32 MiB');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length;
    if (size > MIGRATION_LIMIT) throw new BadRequestException('迁移文件不能超过 32 MiB');
    chunks.push(buffer);
  }
  if (!size) throw new BadRequestException('迁移文件为空');
  return Buffer.concat(chunks);
}
// Secrets and session material must never enter the ordinary admin audit interceptor.
@Controller('api/news')
export class ConfigMigrationController {
  constructor(private readonly migration: ConfigMigrationService, private readonly control: TelegramControlService) {}
  private owner(req: AdminRequest) { requireAdminMutation(req); return req.adminSessionId!; }
  @Get('admin/migration/status') @Header('Cache-Control', 'no-store') status(@Req() req: AdminRequest) { requireAdmin(req); return this.migration.status(); }
  @Post('admin/migration/export') @Header('Cache-Control', 'no-store') async export(@Req() req: AdminRequest, @Body() body: { password?: unknown }, @Res() res: { setHeader(name: string, value: string): void; send(value: Buffer): void }) {
    this.owner(req);
    const file = await this.migration.export(body?.password);
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="china-radar-${new Date().toISOString().slice(0, 10)}.radar"`);
    res.send(file);
  }
  @Post('admin/migration/upload') @Header('Cache-Control', 'no-store') async upload(@Req() req: IncomingMessage & AdminRequest) {
    const owner = this.owner(req); return this.migration.upload(owner, await binaryBody(req));
  }
  @Post('admin/migration/preview') @Header('Cache-Control', 'no-store') preview(@Req() req: AdminRequest, @Body() body: { id?: unknown; password?: unknown }) {
    return this.migration.inspect(this.owner(req), body?.id, body?.password);
  }
  @Post('admin/migration/import') @Header('Cache-Control', 'no-store') import(@Req() req: AdminRequest, @Body() body: Parameters<ConfigMigrationService['import']>[1]) {
    return this.migration.import(this.owner(req), body);
  }
  @Post('telegram/migration/control') @Header('Cache-Control', 'no-store') poll(@Req() req: AdminRequest, @Body() body: Parameters<TelegramControlService['migrationPoll']>[0]) {
    requireCollector(req.headers); return this.control.migrationPoll(body);
  }
  @Post('telegram/migration/report') @Header('Cache-Control', 'no-store') async report(@Req() req: IncomingMessage & AdminRequest) {
    requireCollector(req.headers);
    let body: Parameters<TelegramControlService['migrationReport']>[0];
    const bytes = await binaryBody(req);
    try { body = JSON.parse(bytes.toString('utf8')); } catch { throw new BadRequestException('采集器迁移结果格式无效'); } finally { bytes.fill(0); }
    return this.control.migrationReport(body);
  }
  @Post('telegram/migration/recovery') @Header('Cache-Control', 'no-store') recovery(@Req() req: AdminRequest, @Body() body: { id?: unknown }) {
    requireCollector(req.headers); return this.migration.recovery(body?.id);
  }
  @Post('telegram/migration/complete') @Header('Cache-Control', 'no-store') complete(@Req() req: AdminRequest, @Body() body: { id?: unknown }) {
    requireCollector(req.headers); return this.migration.complete(body?.id);
  }
}
