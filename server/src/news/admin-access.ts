import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
export interface AdminRequest { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string }; adminAuthenticated?: boolean; adminSessionId?: string }
export function requireAdmin(req: AdminRequest) {
  if (!req.adminAuthenticated) throw new UnauthorizedException('请先登录管理员账号');
}
export function requireAdminMutation(req: AdminRequest) {
  const allowed = [process.env.CLIENT_URL || 'http://localhost:3000', process.env.PUBLIC_SITE_URL].filter(Boolean);
  if (!req.headers.origin || !allowed.includes(String(req.headers.origin))) throw new ForbiddenException('请求来源不允许');
  requireAdmin(req);
}
