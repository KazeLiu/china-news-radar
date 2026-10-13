import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

export interface AdminRequest { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }
const localIp = (value: string) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value.trim());
const localHost = (value: string) => {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value.includes('://') ? value : `http://${value}`).hostname); }
  catch { return false; }
};
export function requireAdmin(req: AdminRequest) {
  const token = process.env.ADMIN_TOKEN;
  if (token) {
    if (token.length < 32) throw new ForbiddenException('ADMIN_TOKEN 至少需要 32 个字符');
    const supplied = Buffer.from(String(req.headers['x-admin-token'] || String(req.headers.authorization || '').replace(/^Bearer /, ''))); const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new UnauthorizedException('请输入管理员令牌');
    return;
  }
  // Local development only. Proxy headers must also describe a local visitor/site.
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').filter(Boolean);
  const hosts = ['host', 'x-forwarded-host', 'origin'].map(h => req.headers[h]).filter(Boolean);
  if (!req.socket?.remoteAddress || !localIp(req.socket.remoteAddress) || forwarded.some(ip => !localIp(ip)) || !hosts.length || hosts.some(h => !localHost(String(h)))) {
    throw new ForbiddenException('后台默认仅允许本机访问；服务器需配置 ADMIN_TOKEN');
  }
}
