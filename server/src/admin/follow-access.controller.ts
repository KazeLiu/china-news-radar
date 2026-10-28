import { Body, Controller, Get, Header, Post, Put, Req, Res } from '@nestjs/common';
import { AdminRequest, requireAdmin } from '../news/admin-access';
import { AdminAuthService } from './admin-auth.service';
import { FollowAccessService } from './follow-access.service';

type CookieResponse = { setHeader(name: string, value: string): void };
@Controller('api')
export class FollowAccessController {
  constructor(private readonly access: FollowAccessService, private readonly admin: AdminAuthService) {}
  @Get('follows/access') @Header('Cache-Control', 'no-store') status(@Req() req: AdminRequest) { return this.access.status(req); }
  @Post('follows/unlock') @Header('Cache-Control', 'no-store') async unlock(@Req() req: AdminRequest, @Body() body: { password?: unknown }, @Res({ passthrough: true }) res: CookieResponse) {
    const session = await this.access.unlock(req, body);
    res.setHeader('Set-Cookie', this.access.cookie(session.token, session.expiresAt));
    return { authenticated: true };
  }
  @Post('follows/logout') @Header('Cache-Control', 'no-store') logout(@Req() req: AdminRequest, @Res({ passthrough: true }) res: CookieResponse) {
    this.admin.checkOrigin(req);
    res.setHeader('Set-Cookie', this.access.cookie('', new Date(0)));
    return { authenticated: false };
  }
  @Get('news/admin/follows/access') @Header('Cache-Control', 'no-store') configuration(@Req() req: AdminRequest) { requireAdmin(req); return this.access.configuration(); }
  @Put('news/admin/follows/access') @Header('Cache-Control', 'no-store') configure(@Req() req: AdminRequest, @Body() body: { password?: unknown; sessionHours?: unknown }) { requireAdmin(req); return this.access.configure(body); }
}
