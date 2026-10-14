import { CanActivate, Controller, ExecutionContext, Get, Global, Header, Injectable, Module, Post, Body, Req, Res } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAuthService } from './admin-auth.service';
import { AdminRequest } from '../news/admin-access';

@Injectable()
class AdminGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}
  async canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AdminRequest & { path: string; method: string }>();
    if (!req.path.startsWith('/api/') || req.path === '/api/news/telegram' || req.path === '/api/news/telegram/status' || req.path.startsWith('/api/news/admin/auth/')) return true;
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const privateRead = req.path.includes('/admin/') || req.path.startsWith('/api/settings');
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
@Module({ imports: [PrismaModule], controllers: [AdminAuthController], providers: [AdminAuthService, { provide: APP_GUARD, useClass: AdminGuard }], exports: [AdminAuthService] })
export class AdminAuthModule {}
