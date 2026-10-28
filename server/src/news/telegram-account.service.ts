import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { sourceNetwork } from './source-network';

const ACCOUNT_KEY = 'news-telegram-account-v1';
const STATUS_KEY = 'news-telegram-status-v1';
type Account = { apiId?: string; apiHash?: string; phone?: string; enabled?: boolean; revision?: string };
const SESSIONS = ['authorized', 'unauthorized', 'missing', 'disconnected', 'authorizing', 'connecting'] as const;
const PHASES = ['credentials', 'connecting', 'phone', 'code', 'password', 'authorized', 'matching', 'listening', 'stopped', 'failed', 'idle'] as const;
type CollectorStatus = { session: typeof SESSIONS[number]; running: boolean; checkedAt: string; revision: string; credentialsConfigured: boolean; proxyEnabled?: boolean; channels: { sourceId: string; channel: string; subscribed: boolean }[]; phase?: typeof PHASES[number]; error?: { code: string; message: string } };

@Injectable()
export class TelegramAccountService {
  constructor(private readonly prisma: PrismaService) {}
  migrationPending() { return this.prisma.setting.findUnique({ where: { key: 'news-migration-pending' } }); }
  async credentials() {
    const row = await this.prisma.setting.findUnique({ where: { key: ACCOUNT_KEY } });
    const saved: Account = row ? JSON.parse(row.value) : {};
    const network = sourceNetwork();
    return { apiId: saved.apiId || process.env.TG_API_ID || '', apiHash: saved.apiHash || process.env.TG_API_HASH || '', revision: saved.revision || 'environment',
      phone: saved.phone || '', enabled: saved.enabled ?? true,
      proxyUrl: network.mode === 'proxy' && network.telegramUseProxy ? network.proxyUrl : '' };
  }
  async status() {
    const credentials = await this.credentials();
    const row = await this.prisma.setting.findUnique({ where: { key: STATUS_KEY } });
    const report: CollectorStatus | null = row ? JSON.parse(row.value) : null;
    const online = !!report && Date.now() - Date.parse(report.checkedAt) < 150_000;
    const current = report?.revision === credentials.revision;
    const sourceResults = report?.channels.length ? await this.prisma.newsSource.findMany({
      where: { id: { in: report.channels.map(channel => channel.sourceId) } }, select: { id: true, lastSuccessAt: true, error: true },
    }) : [];
    return { apiIdConfigured: !!credentials.apiId, apiHashConfigured: !!credentials.apiHash, phone: credentials.phone, enabled: credentials.enabled,
      serverEnabled: process.env.TELEGRAM_ENABLED === 'true', collectorTokenConfigured: (process.env.COLLECTOR_TOKEN?.length || 0) >= 32,
      collectorCredentialsConfigured: online && current && !!report?.credentialsConfigured,
      collectorOnline: online && current && !!report?.running, session: current ? report!.session : 'unknown', reportFresh: online && current,
      phase: current ? report!.phase || null : null, lastError: current ? report!.error || null : null,
      sourceResults,
      proxyEnabled: !!credentials.proxyUrl, reportedProxyEnabled: online && current && typeof report?.proxyEnabled === 'boolean' ? report.proxyEnabled : null,
      checkedAt: report?.checkedAt || null, channels: online && current ? report!.channels : [] };
  }
  async save(body: { apiId?: unknown; apiHash?: unknown; phone?: unknown }) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['apiId', 'apiHash', 'phone'].includes(key)) ||
      (body.apiId !== undefined && typeof body.apiId !== 'string') || (body.apiHash !== undefined && typeof body.apiHash !== 'string') || (body.phone !== undefined && typeof body.phone !== 'string')) {
      throw new BadRequestException('Telegram API 凭据格式无效');
    }
    const apiId = (body.apiId as string | undefined)?.trim(); const apiHash = (body.apiHash as string | undefined)?.trim();
    const phone = (body.phone as string | undefined)?.replace(/[\s()-]/g, '');
    if (phone !== undefined && !/^\+[1-9]\d{1,14}$/.test(phone)) throw new BadRequestException('请填写注册 Telegram 的完整手机号，格式为 +国家区号和号码。');
    if (apiId && (!/^[1-9]\d{0,9}$/.test(apiId) || Number(apiId) > 2147483647)) throw new BadRequestException('TG_API_ID 必须是有效的正整数');
    if (apiHash && !/^[a-f\d]{32}$/i.test(apiHash)) throw new BadRequestException('TG_API_HASH 必须是 32 位十六进制字符');
    if (apiId || apiHash || phone !== undefined) await this.prisma.$transaction(async tx => {
      const row = await tx.setting.findUnique({ where: { key: ACCOUNT_KEY } });
      const previous: Account = row ? JSON.parse(row.value) : {};
      const changed = !!apiId && apiId !== previous.apiId || !!apiHash && apiHash !== previous.apiHash || phone !== undefined && phone !== previous.phone;
      const value = JSON.stringify({ ...previous, ...(apiId ? { apiId } : {}), ...(apiHash ? { apiHash } : {}), ...(phone === undefined ? {} : { phone }),
        ...(changed ? { revision: randomUUID() } : {}) });
      await tx.setting.upsert({ where: { key: ACCOUNT_KEY }, create: { key: ACCOUNT_KEY, value }, update: { value } });
    });
    return this.status();
  }
  async setEnabled(enabled: boolean) {
    await this.prisma.$transaction(async tx => {
      const row = await tx.setting.findUnique({ where: { key: ACCOUNT_KEY } });
      const saved: Account = row ? JSON.parse(row.value) : {};
      const value = JSON.stringify({ ...saved, enabled });
      await tx.setting.upsert({ where: { key: ACCOUNT_KEY }, create: { key: ACCOUNT_KEY, value }, update: { value } });
    });
  }
  async report(body: Omit<CollectorStatus, 'checkedAt'>) {
    if (!body || !SESSIONS.includes(body.session) || typeof body.revision !== 'string' || body.revision.length > 80 ||
      (body.phase !== undefined && !PHASES.includes(body.phase)) ||
      (body.proxyEnabled !== undefined && typeof body.proxyEnabled !== 'boolean') ||
      (body.error !== undefined && (!body.error || typeof body.error.code !== 'string' || !/^[a-z-]{1,60}$/.test(body.error.code) || typeof body.error.message !== 'string' || body.error.message.length > 400)) ||
      typeof body.running !== 'boolean' || typeof body.credentialsConfigured !== 'boolean' || !Array.isArray(body.channels) || body.channels.length > 100 || body.channels.some(row =>
        !row || typeof row.sourceId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(row.sourceId) || typeof row.channel !== 'string' || !/^[a-z][a-z\d_]{3,99}$/i.test(row.channel) || typeof row.subscribed !== 'boolean')) {
      throw new BadRequestException('采集器状态格式无效');
    }
    const value = JSON.stringify({ session: body.session, running: body.running, revision: body.revision, credentialsConfigured: body.credentialsConfigured,
      checkedAt: new Date().toISOString(), channels: body.channels.map(({ sourceId, channel, subscribed }) => ({ sourceId, channel, subscribed })),
      ...(body.proxyEnabled === undefined ? {} : { proxyEnabled: body.proxyEnabled }),
      ...(body.phase ? { phase: body.phase } : {}), ...(body.error ? { error: { code: body.error.code, message: body.error.message } } : {}) });
    await this.prisma.setting.upsert({ where: { key: STATUS_KEY }, create: { key: STATUS_KEY, value }, update: { value } });
    return { ok: true };
  }
}
