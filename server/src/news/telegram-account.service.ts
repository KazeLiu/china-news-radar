import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ACCOUNT_KEY = 'news-telegram-account-v1';
const STATUS_KEY = 'news-telegram-status-v1';
type Account = { apiId?: string; apiHash?: string; revision?: string };
type CollectorStatus = { session: 'authorized' | 'unauthorized' | 'missing' | 'disconnected'; running: boolean; checkedAt: string; revision: string; credentialsConfigured: boolean; channels: { sourceId: string; channel: string; subscribed: boolean }[] };

@Injectable()
export class TelegramAccountService {
  constructor(private readonly prisma: PrismaService) {}
  async credentials() {
    const row = await this.prisma.setting.findUnique({ where: { key: ACCOUNT_KEY } });
    const saved: Account = row ? JSON.parse(row.value) : {};
    return { apiId: saved.apiId || process.env.TG_API_ID || '', apiHash: saved.apiHash || process.env.TG_API_HASH || '', revision: saved.revision || 'environment' };
  }
  async status() {
    const credentials = await this.credentials();
    const row = await this.prisma.setting.findUnique({ where: { key: STATUS_KEY } });
    const report: CollectorStatus | null = row ? JSON.parse(row.value) : null;
    const online = !!report && Date.now() - Date.parse(report.checkedAt) < 150_000;
    const current = report?.revision === credentials.revision;
    return { apiIdConfigured: !!credentials.apiId, apiHashConfigured: !!credentials.apiHash,
      collectorCredentialsConfigured: online && current && !!report?.credentialsConfigured,
      collectorOnline: online && !!report?.running, session: online && current ? report!.session : 'unknown',
      checkedAt: report?.checkedAt || null, channels: online && current ? report!.channels : [] };
  }
  async save(body: { apiId?: unknown; apiHash?: unknown }) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['apiId', 'apiHash'].includes(key)) ||
      (body.apiId !== undefined && typeof body.apiId !== 'string') || (body.apiHash !== undefined && typeof body.apiHash !== 'string')) {
      throw new BadRequestException('Telegram API 凭据格式无效');
    }
    const apiId = (body.apiId as string | undefined)?.trim(); const apiHash = (body.apiHash as string | undefined)?.trim();
    if (apiId && (!/^[1-9]\d{0,9}$/.test(apiId) || Number(apiId) > 2147483647)) throw new BadRequestException('TG_API_ID 必须是有效的正整数');
    if (apiHash && !/^[a-f\d]{32}$/i.test(apiHash)) throw new BadRequestException('TG_API_HASH 必须是 32 位十六进制字符');
    if (apiId || apiHash) await this.prisma.$transaction(async tx => {
      const row = await tx.setting.findUnique({ where: { key: ACCOUNT_KEY } });
      const previous: Account = row ? JSON.parse(row.value) : {};
      const value = JSON.stringify({ ...previous, ...(apiId ? { apiId } : {}), ...(apiHash ? { apiHash } : {}), revision: new Date().toISOString() });
      await tx.setting.upsert({ where: { key: ACCOUNT_KEY }, create: { key: ACCOUNT_KEY, value }, update: { value } });
    });
    return this.status();
  }
  async report(body: CollectorStatus) {
    if (!body || !['authorized', 'unauthorized', 'missing', 'disconnected'].includes(body.session) || typeof body.revision !== 'string' || body.revision.length > 80 ||
      typeof body.running !== 'boolean' || typeof body.credentialsConfigured !== 'boolean' || !Array.isArray(body.channels) || body.channels.length > 100 || body.channels.some(row =>
        !row || typeof row.sourceId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(row.sourceId) || typeof row.channel !== 'string' || !/^[a-z][a-z\d_]{3,99}$/i.test(row.channel) || typeof row.subscribed !== 'boolean')) {
      throw new BadRequestException('采集器状态格式无效');
    }
    const value = JSON.stringify({ session: body.session, running: body.running, revision: body.revision, credentialsConfigured: body.credentialsConfigured,
      checkedAt: new Date().toISOString(), channels: body.channels.map(({ sourceId, channel, subscribed }) => ({ sourceId, channel, subscribed })) });
    await this.prisma.setting.upsert({ where: { key: STATUS_KEY }, create: { key: STATUS_KEY, value }, update: { value } });
    return { ok: true };
  }
}
