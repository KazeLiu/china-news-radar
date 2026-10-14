import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

export function validCollectorToken(header: string | undefined, token = process.env.COLLECTOR_TOKEN) {
  if (!token || token.length < 32 || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7)); const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function requireCollector(headers: Record<string, string | string[] | undefined>) {
  if (headers.origin || headers.cookie || Object.keys(headers).some(key => key.startsWith('sec-fetch-'))) {
    throw new ForbiddenException('此接口仅供服务端采集器使用');
  }
  if (!validCollectorToken(typeof headers.authorization === 'string' ? headers.authorization : undefined)) {
    throw new UnauthorizedException('采集令牌无效或未配置');
  }
}
