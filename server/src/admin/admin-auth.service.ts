import { BadRequestException, ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AdminRequest } from '../news/admin-access';
import { verifyPassword } from './password';

export const SESSION_COOKIE = 'radar_admin';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
@Injectable()
export class AdminAuthService {
  constructor(private readonly prisma: PrismaService) {}
  checkOrigin(req: AdminRequest) {
    const allowed = [process.env.CLIENT_URL || 'http://localhost:3000', process.env.PUBLIC_SITE_URL].filter(Boolean);
    if (!req.headers.origin || !allowed.includes(String(req.headers.origin))) throw new ForbiddenException({ code: 'origin_rejected', message: '请求来源不允许，请从配置的站点地址进入后台' });
  }
  async session(req: AdminRequest, required = true) {
    const cookie = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) {
      if (required) throw new UnauthorizedException({ code: 'login_required', message: '请先登录管理员账号' });
      return null;
    }
    const tokenHash = hash(cookie);
    const session = await this.prisma.adminSession.findUnique({ where: { tokenHash } });
    if (!session || session.expiresAt <= new Date()) {
      if (session) await this.prisma.adminSession.deleteMany({ where: { tokenHash } });
      if (required) throw new UnauthorizedException({ code: 'session_expired', message: '管理员会话已过期，请重新登录' });
      return null;
    }
    return session;
  }
  async status(req: AdminRequest) {
    const account = await this.prisma.adminAccount.findUnique({ where: { id: 'admin' } });
    const session = await this.session(req, false);
    return { initialized: !!account, authenticated: !!session, username: session ? account?.username : undefined, expiresAt: session?.expiresAt };
  }
  async login(req: AdminRequest, body: { username?: unknown; password?: unknown }) {
    this.checkOrigin(req);
    if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.username.length > 80 || body.password.length > 256) throw new BadRequestException('账号或密码格式无效');
    const username = body.username.trim();
    const address = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const keys = [hash(`account:${username}`), hash(`address:${address}`)];
    const now = new Date();
    const attempts = await this.prisma.adminLoginAttempt.findMany({ where: { key: { in: keys } } });
    if (attempts.some(a => a.blockedUntil && a.blockedUntil > now)) throw new HttpException('登录失败次数过多，请十五分钟后重试', 429);
    const account = await this.prisma.adminAccount.findUnique({ where: { id: 'admin' } });
    if (!account) throw new ForbiddenException({ code: 'setup_required', message: '管理员尚未初始化，请在服务器运行 pnpm --filter ai-hot-radar-server admin:init' });
    const validPassword = await verifyPassword(body.password, account.passwordHash);
    if (account.username !== username || !validPassword) {
      await this.prisma.$transaction(async tx => {
        for (const key of keys) {
          const old = await tx.adminLoginAttempt.findUnique({ where: { key } });
          const failures = old && old.updatedAt.getTime() > now.getTime() - 900_000 && (!old.blockedUntil || old.blockedUntil > now) ? old.failures + 1 : 1;
          const data = { failures, blockedUntil: failures >= 5 ? new Date(now.getTime() + 900_000) : null };
          await tx.adminLoginAttempt.upsert({ where: { key }, create: { key, ...data }, update: data });
        }
      });
      throw new UnauthorizedException('账号或密码不正确');
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    await this.prisma.$transaction([
      this.prisma.adminLoginAttempt.deleteMany({ where: { key: { in: keys } } }),
      this.prisma.adminSession.deleteMany({ where: { expiresAt: { lte: now } } }),
      this.prisma.adminSession.create({ data: { tokenHash: hash(token), expiresAt } }),
    ]);
    return { token, expiresAt, username: account.username };
  }
  async logout(req: AdminRequest) {
    this.checkOrigin(req);
    const session = await this.session(req, false);
    if (session) await this.prisma.adminSession.deleteMany({ where: { tokenHash: session.tokenHash } });
  }
  cookie(value: string, expires: Date) {
    const secure = (process.env.PUBLIC_SITE_URL || process.env.CLIENT_URL || '').startsWith('https://');
    return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Expires=${expires.toUTCString()}${secure ? '; Secure' : ''}`;
  }
}
