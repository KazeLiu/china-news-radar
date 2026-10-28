import { BadRequestException, ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AdminRequest } from '../news/admin-access';
import { AdminAuthService } from './admin-auth.service';
import { hashPassword, verifyPassword } from './password';

const CONFIG_KEY = 'news-follow-access-v1';
const COOKIE = 'radar_follows';
interface FollowConfiguration { password: string; passwordHash: string; sessionHours: number }

@Injectable()
export class FollowAccessService {
  constructor(private readonly prisma: PrismaService, private readonly admin: AdminAuthService) {}
  private async settings(): Promise<FollowConfiguration> {
    const stored = await this.prisma.setting.findUnique({ where: { key: CONFIG_KEY } });
    return stored ? JSON.parse(stored.value) : { password: '', passwordHash: '', sessionHours: 24 };
  }
  private signature(payload: string, secret: string) { return createHmac('sha256', secret).update(`follows:${payload}`).digest('hex'); }
  private validSession(req: AdminRequest, config: FollowConfiguration) {
    const token = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!token || !/^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return false;
    const [expires, nonce, signature] = token.split('.');
    const remaining = Number(expires) - Date.now();
    return remaining > 0 && remaining <= config.sessionHours * 60 * 60 * 1000 && timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(this.signature(`${expires}.${nonce}`, config.passwordHash), 'hex'));
  }
  async status(req: AdminRequest) {
    const config = await this.settings();
    return { configured: !!config.passwordHash, authenticated: !!await this.admin.session(req, false) || !!config.passwordHash && this.validSession(req, config) };
  }
  async requireRead(req: AdminRequest) {
    if (!(await this.status(req)).authenticated) throw new UnauthorizedException({ code: 'follow_access_required', message: '请先输入我的关注访问密码' });
  }
  async configure(body: { password?: unknown; sessionHours?: unknown }) {
    if (typeof body?.password !== 'string' || body.password.length < 12 || body.password.length > 256 || !body.password.trim()) throw new BadRequestException('访问密码须为 12–256 个字符');
    if (typeof body.sessionHours !== 'number' || !Number.isInteger(body.sessionHours) || body.sessionHours < 1 || body.sessionHours > 720) throw new BadRequestException('解锁时长须为 1–720 小时的整数');
    const config: FollowConfiguration = { password: body.password, passwordHash: await hashPassword(body.password), sessionHours: body.sessionHours };
    const value = JSON.stringify(config);
    await this.prisma.setting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value }, update: { value } });
    return { configured: true, password: config.password, sessionHours: config.sessionHours };
  }
  async configuration() { const config = await this.settings(); return { configured: !!config.passwordHash, password: config.password, sessionHours: config.sessionHours }; }
  async unlock(req: AdminRequest, body: { password?: unknown }) {
    this.admin.checkOrigin(req);
    if (typeof body?.password !== 'string' || body.password.length > 256) throw new BadRequestException('访问密码格式无效');
    const address = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const key = createHash('sha256').update(`follows-address:${address}`).digest('hex');
    const now = new Date();
    const attempt = await this.prisma.adminLoginAttempt.findUnique({ where: { key } });
    if (attempt?.blockedUntil && attempt.blockedUntil > now) throw new HttpException('密码错误次数过多，请十五分钟后重试', 429);
    const config = await this.settings();
    if (!config.passwordHash) throw new ForbiddenException('管理员尚未设置我的关注访问密码');
    if (!await verifyPassword(body.password, config.passwordHash)) {
      await this.prisma.$transaction(async tx => {
        const old = await tx.adminLoginAttempt.findUnique({ where: { key } });
        const failures = old && old.updatedAt.getTime() > now.getTime() - 900_000 && (!old.blockedUntil || old.blockedUntil > now) ? old.failures + 1 : 1;
        const data = { failures, blockedUntil: failures >= 5 ? new Date(now.getTime() + 900_000) : null };
        await tx.adminLoginAttempt.upsert({ where: { key }, create: { key, ...data }, update: data });
      });
      throw new UnauthorizedException('访问密码不正确');
    }
    await this.prisma.adminLoginAttempt.deleteMany({ where: { key } });
    const expiresAt = new Date(now.getTime() + config.sessionHours * 60 * 60 * 1000);
    const payload = `${expiresAt.getTime()}.${randomBytes(16).toString('hex')}`;
    return { token: `${payload}.${this.signature(payload, config.passwordHash)}`, expiresAt };
  }
  cookie(value: string, expiresAt: Date) {
    const secure = (process.env.PUBLIC_SITE_URL || process.env.CLIENT_URL || '').startsWith('https://');
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${secure ? '; Secure' : ''}`;
  }
}
