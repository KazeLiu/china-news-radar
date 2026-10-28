import { CanActivate, Controller, ExecutionContext, Get, Global, Header, Injectable, Module, Post, Body, Req, Res } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAuthService } from './admin-auth.service';
import { AdminRequest } from '../news/admin-access';
import { FollowAccessService } from './follow-access.service';
import { FollowAccessController } from './follow-access.controller';

@Injectable()
class AdminGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService, private readonly follows: FollowAccessService) {}
  async canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AdminRequest & { path: string; method: string }>();
    const path = req.path.toLowerCase();
    // Collector routes authenticate their own token and reject browser-originated requests.
    if (!path.startsWith('/api/') || path === '/api/news/telegram' || path.startsWith('/api/news/telegram/') || path.startsWith('/api/news/admin/auth/')) return true;
    if (['/api/follows/access', '/api/follows/unlock', '/api/follows/logout'].includes(path)) return true;
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const followRead = ['/api/keywords', '/api/entities'].some(prefix => path === prefix || path.startsWith(`${prefix}/`));
    if (!mutation && followRead) {
      context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
      await this.follows.requireRead(req);
      return true;
    }
    const privateRead = path.includes('/admin/') || path.startsWith('/api/settings');
    if (mutation || privateRead) {
      context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
      if (mutation) this.auth.checkOrigin(req);
      const session = await this.auth.session(req);
      req.adminAuthenticated = true;
      req.adminSessionId = session!.tokenHash;
    }
    return true;
  }
}
@Controller('api/news/admin/auth')
class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}
  @Get('session') @Header('Cache-Control', 'no-store') status(@Req() req: AdminRequest) { return this.auth.status(req); }
  @Post('login') @Header('Cache-Control', 'no-store') async login(@Req() req: AdminRequest, @Body() body: { username?: unknown; password?: unknown }, @Res({ passthrough: true }) res: { setHeader(name: string, value: string): void }) {
    const session = await this.auth.login(req, body);
    res.setHeader('Set-Cookie', this.auth.cookie(session.token, session.expiresAt));
    return { authenticated: true, username: session.username, expiresAt: session.expiresAt };
  }
  @Post('logout') @Header('Cache-Control', 'no-store') async logout(@Req() req: AdminRequest, @Res({ passthrough: true }) res: { setHeader(name: string, value: string): void }) {
    await this.auth.logout(req);
    res.setHeader('Set-Cookie', this.auth.cookie('', new Date(0)));
    return { authenticated: false };
  }
}
@Global()
@Module({ imports: [PrismaModule], controllers: [AdminAuthController, FollowAccessController], providers: [AdminAuthService, FollowAccessService, { provide: APP_GUARD, useClass: AdminGuard }], exports: [AdminAuthService] })
export class AdminAuthModule {}
