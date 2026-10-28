import { BadRequestException, ConflictException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../admin/password';
import { ADMIN_CONFIG_KEY, readAiUsage } from './admin-config';
import { NewsService } from './news.service';
import { TelegramAccountService } from './telegram-account.service';
import { TelegramControlService } from './telegram-control.service';
import { decryptMigration, encryptMigration, MigrationDocument, validateMigration, validateTelegramSnapshot } from './config-migration-format';
import { assertNoConfigurationMigration, lockConfigurationMigration } from './config-migration-lock';
import { mediaDirectory } from './source-logo.controller';

const PENDING = 'news-migration-pending';
const COMMITTED = 'news-migration-committed';
type Pending = { id: string; sources: string[]; telegramEnabled: boolean; aiPaused: boolean; backup: string };
@Injectable()
export class ConfigMigrationService implements OnModuleDestroy {
  private preview?: { id: string; owner: string; expires: number; file?: Buffer; document?: MigrationDocument; target?: string };
  private expiry?: ReturnType<typeof setTimeout>;
  private completing = false;
  constructor(private readonly prisma: PrismaService, private readonly news: NewsService, private readonly account: TelegramAccountService, private readonly control: TelegramControlService) {}
  private clearPreview() { clearTimeout(this.expiry); this.preview?.file?.fill(0); this.preview = undefined; }
  onModuleDestroy() { this.clearPreview(); }
  private async pending() {
    const row = await this.prisma.setting.findUnique({ where: { key: PENDING } });
    return row ? JSON.parse(row.value) as Pending : null;
  }
  async status() {
    const pending = await this.pending();
    return { workerReady: this.control.migrationReady(), collectorEnabled: process.env.COLLECTOR_ENABLED !== 'false', telegramEnabled: process.env.TELEGRAM_ENABLED === 'true',
      tokenConfigured: (process.env.COLLECTOR_TOKEN?.length || 0) >= 32, pending: pending ? { id: pending.id, backup: pending.backup } : null };
  }
  private async requireReady() {
    if (await this.pending()) throw new ConflictException('上一次导入仍在恢复，请保留采集器持久卷并等待完成');
    if (!this.control.migrationReady()) throw new ConflictException('请先更新并连接支持迁移的 Telegram 采集器，且完成或取消当前账号登录');
    if (await this.prisma.aiTask.count({ where: { status: 'running' } })) throw new ConflictException('AI 任务正在执行，请等待请求完成后再迁移');
  }
  private async configuration() {
    const [config, account, follows, keywords, pause, usage] = await Promise.all([
      this.news.migrationConfiguration(), this.account.credentials(), this.prisma.setting.findUnique({ where: { key: 'news-follow-access-v1' } }),
      this.prisma.keyword.findMany({ orderBy: { text: 'asc' }, include: { newsProfile: true, entityCard: true } }),
      this.prisma.setting.findUnique({ where: { key: 'news-ai-queue-paused' } }),
      this.prisma.setting.findUnique({ where: { key: `news-ai-usage-${new Date().toISOString().slice(0, 10)}` } }),
    ]);
    const follow = follows ? JSON.parse(follows.value) : { password: '', sessionHours: 24 };
    return { config, telegram: { apiId: account.apiId, apiHash: account.apiHash, phone: account.phone, enabled: account.enabled },
      follows: { password: follow.password, sessionHours: follow.sessionHours },
      keywords: keywords.map(keyword => ({ text: keyword.text, category: keyword.category, isActive: keyword.isActive,
        profile: keyword.newsProfile ? { data: keyword.newsProfile.data, generatedAt: keyword.newsProfile.generatedAt.toISOString() } : null,
        card: keyword.entityCard ? { name: keyword.entityCard.name, type: keyword.entityCard.type, summary: keyword.entityCard.summary, relatedData: keyword.entityCard.relatedData, lastRefresh: keyword.entityCard.lastRefresh.toISOString() } : null })),
      aiPaused: pause?.value === 'true', aiUsage: { day: new Date().toISOString().slice(0, 10), used: readAiUsage(usage?.value) } };
  }
  async export(password: unknown) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 256 || !password.trim()) throw new BadRequestException('迁移密码须为 12–256 个字符');
    const release = lockConfigurationMigration(); let unlock: (() => void) | undefined; let held = false;
    try {
      unlock = this.news.lockForMigration(); await this.requireReady();
      const data = await this.configuration(); const id = randomUUID();
      this.control.beginMigration(id); held = true;
      // Persist the stop before returning any session. Restarting the old host must not reconnect it.
      await this.account.setEnabled(false);
      const state = validateTelegramSnapshot(await this.control.migrationCommand('snapshot'));
      const logos: MigrationDocument['logos'] = [];
      for (const name of new Set(data.config.sources.flatMap(source => source.logo?.startsWith('/api/news/logos/') ? [source.logo.slice('/api/news/logos/'.length)] : []))) {
        if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name)) throw new BadRequestException('来源 Logo 文件名无效');
        logos.push({ name, data: (await readFile(path.join(mediaDirectory(), name))).toString('base64') });
      }
      const document = validateMigration({ format: 'china-radar-migration', version: 1, exportedAt: new Date().toISOString(), ...data, telegram: { ...data.telegram, state }, logos });
      return await encryptMigration(document, password);
    } finally { if (held) this.control.endMigration(); unlock?.(); release(); }
  }
  async upload(owner: string, file: Buffer) {
    if (await this.pending()) throw new ConflictException('请先完成上一次迁移恢复');
    assertNoConfigurationMigration();
    this.clearPreview();
    this.preview = { id: randomUUID(), owner, expires: Date.now() + 10 * 60_000, file };
    this.expiry = setTimeout(() => this.clearPreview(), 10 * 60_000);
    return { id: this.preview.id };
  }
  private requirePreview(owner: string, id: unknown) {
    if (!this.preview || this.preview.owner !== owner || this.preview.id !== id || this.preview.expires <= Date.now()) throw new ConflictException('迁移预览已失效，请重新上传文件');
    return this.preview;
  }
  async inspect(owner: string, id: unknown, password: unknown) {
    const release = lockConfigurationMigration();
    try {
      const preview = this.requirePreview(owner, id);
      if (!preview.file) throw new ConflictException('请重新上传迁移包');
      const document = await decryptMigration(preview.file, password);
      if (this.preview !== preview) throw new ConflictException('迁移预览已失效，请重新上传');
      preview.file.fill(0); preview.file = undefined; preview.document = document;
      const target = await this.configuration(); preview.target = this.configurationIdentity(target);
      const oldIds = new Set(target.config.sources.map(source => source.id));
      const queued = await this.prisma.aiTask.count({ where: { status: 'queued' } });
      return { id: preview.id, exportedAt: document.exportedAt, expiresAt: new Date(preview.expires).toISOString(),
        sources: document.config.sources.map(source => ({ name: source.name, kind: source.kind, enabled: source.enabled, action: oldIds.has(source.id) ? '覆盖' : '新增' })),
        removedSources: target.config.sources.filter(source => !document.config.sources.some(next => next.id === source.id)).map(source => source.name),
        rules: document.config.rules.length, keywords: document.keywords.length, logos: document.logos.length, telegramSession: !!document.telegram.state.session, pendingMessages: document.telegram.state.pending.length,
        warnings: ['将替换本站来源、AI、代理、浏览器、过滤和关注设置；保留新闻、收藏和本站管理员账号。', '不导入旧的抓取时间和 RSS 缓存标记，启用来源会从新服务器重新检查。',
          '导入会替换本机 Telegram 登录状态；原 session 和队列另存备份，不同账号的待投递队列不会混用。',
          ...(document.config.network?.mode === 'proxy' ? ['迁移包使用代理。请确认该代理地址在新服务器可用，尤其是 localhost、127.0.0.1 或容器名称。'] : []),
          ...(document.config.sources.some(source => source.feedUrls?.some(url => /rsshub|localhost|127\.0\.0\.1/i.test(url))) ? ['来源包含内部 RSSHub 地址，请确认新服务器使用相同服务名和端口。'] : []),
          ...(queued ? ['本站已有待处理 AI 任务，导入后保持 AI 队列暂停，请检查后手动恢复。'] : []),
          ...(document.keywords.some(keyword => keyword.profile && JSON.parse(keyword.profile.data).generationStatus === 'pending') ? ['包内尚未生成的关注档案会标记为未生成；迁移不携带旧 AI 任务，也不会自动付费补生成。'] : []),
          ...(!document.telegram.state.session ? ['包内没有 Telegram 登录 session，导入后需由管理员自行登录。'] : []),
          ...(process.env.COLLECTOR_ENABLED === 'false' ? ['本站环境关闭了定时采集；需在部署配置中设置 COLLECTOR_ENABLED=true 并重建后端。'] : [])] };
    } finally { release(); }
  }
  private configurationIdentity({ aiUsage: _usage, ...configuration }: Awaited<ReturnType<ConfigMigrationService['configuration']>>) { return JSON.stringify(configuration); }
  private async backup(id: string) {
    const databases = await this.prisma.$queryRawUnsafe<Array<{ name: string; file: string }>>('PRAGMA database_list');
    const file = databases.find(database => database.name === 'main')?.file;
    if (!file) throw new ConflictException('迁移需要可持久备份的 SQLite 数据库');
    const backup = `${file}.backup-migration-${id}.db`;
    await this.prisma.$executeRawUnsafe(`VACUUM INTO '${backup.replaceAll("'", "''")}'`); await chmod(backup, 0o600); return backup;
  }
  async import(owner: string, body: { id?: unknown; oldCollectorStopped?: unknown; replaceConfirmed?: unknown }) {
    if (body?.oldCollectorStopped !== true || body.replaceConfirmed !== true) throw new BadRequestException('请确认旧服务器 Telegram 采集器已停止，并确认替换本站配置');
    const release = lockConfigurationMigration(); let unlock: (() => void) | undefined; let held = false;
    try {
      unlock = this.news.lockForMigration(); await this.requireReady();
      const preview = this.requirePreview(owner, body.id); const document = preview.document;
      if (!document || preview.target !== this.configurationIdentity(await this.configuration())) throw new ConflictException('本站配置已改变，请重新上传并预览');
      const id = randomUUID(); this.control.beginMigration(id); held = true;
      const prepared = await this.control.migrationCommand('prepare', document.telegram.state) as { prepared?: unknown } | null;
      if (prepared?.prepared !== true) throw new ConflictException('采集器未确认状态已完整暂存，未修改本站配置');
      const backup = await this.backup(id);
      const config = structuredClone(document.config);
      await mkdir(mediaDirectory(), { recursive: true });
      for (const logo of document.logos) {
        const name = `${randomUUID()}${path.extname(logo.name)}`;
        await writeFile(path.join(mediaDirectory(), name), Buffer.from(logo.data, 'base64'), { mode: 0o600, flag: 'wx' });
        for (const source of config.sources) if (source.logo === `/api/news/logos/${logo.name}`) source.logo = `/api/news/logos/${name}`;
      }
      const follow = { ...document.follows, passwordHash: document.follows.password ? await hashPassword(document.follows.password) : '' };
      const pending: Pending = { id, sources: config.sources.filter(source => source.enabled).map(source => source.id), telegramEnabled: document.telegram.enabled, aiPaused: document.aiPaused || !!await this.prisma.aiTask.count({ where: { status: 'queued' } }), backup };
      await this.prisma.$transaction(async tx => {
        const settings = { [ADMIN_CONFIG_KEY]: JSON.stringify(config), 'news-follow-access-v1': JSON.stringify(follow),
          'news-telegram-account-v1': JSON.stringify({ apiId: document.telegram.apiId, apiHash: document.telegram.apiHash, phone: document.telegram.phone, enabled: false, revision: randomUUID() }),
          'news-ai-queue-paused': 'true', [COMMITTED]: id, [PENDING]: JSON.stringify(pending) };
        for (const [key, value] of Object.entries(settings)) await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
        const day = new Date().toISOString().slice(0, 10); const key = `news-ai-usage-${day}`;
        const used = readAiUsage((await tx.setting.findUnique({ where: { key } }))?.value);
        const value = String(Math.max(used, document.aiUsage.day === day ? document.aiUsage.used : 0));
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
        await tx.setting.deleteMany({ where: { key: { in: ['news-telegram-status-v1', 'news-applied-filters'] } } });
        await tx.newsSource.updateMany({ data: { enabled: false } });
        for (const source of config.sources) await tx.newsSource.upsert({ where: { id: source.id }, create: { id: source.id, enabled: false }, update: { enabled: false, nextCheckAt: null, etag: null, lastModified: null, feedValidators: '{}', feedFailures: '{}', activeKind: null, activeFeedUrl: null, lastParseJson: null, lastCheckedAt: null, lastSuccessAt: null, lastItemCount: 0, error: null, rsshubError: null, rsshubRetryAt: null } });
        await tx.keyword.deleteMany({ where: { text: { notIn: document.keywords.map(keyword => keyword.text) } } });
        for (const keyword of document.keywords) {
          const data = { category: keyword.category, isActive: keyword.isActive };
          const saved = await tx.keyword.upsert({ where: { text: keyword.text }, create: { text: keyword.text, ...data }, update: data });
          const card = keyword.card ? { ...keyword.card, lastRefresh: new Date(keyword.card.lastRefresh) } : { name: keyword.text };
          await tx.entityCard.upsert({ where: { keywordId: saved.id }, create: { keywordId: saved.id, ...card }, update: card });
          if (keyword.profile) {
            const profile = JSON.parse(keyword.profile.data);
            const data = { data: profile.generationStatus === 'pending' ? JSON.stringify({ ...profile, generationStatus: 'missing', summary: `${keyword.text} 的关注档案尚未生成。` }) : keyword.profile.data, generatedAt: new Date(keyword.profile.generatedAt) };
            await tx.newsEntityProfile.upsert({ where: { keywordId: saved.id }, create: { keywordId: saved.id, ...data }, update: data });
          }
          else await tx.newsEntityProfile.deleteMany({ where: { keywordId: saved.id } });
        }
      }, { timeout: 30_000 });
      this.clearPreview();
      return { committed: true, pending: true, backup, message: '配置已保存，采集器正在恢复 session 和队列。恢复完成前来源和 Telegram 保持暂停。' };
    } finally { if (held) this.control.endMigration(); unlock?.(); release(); }
  }
  async recovery(id: unknown) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new BadRequestException('迁移 ID 无效');
    if (this.control.migrationActive(id)) return { action: 'wait' };
    const committed = await this.prisma.setting.findUnique({ where: { key: COMMITTED } });
    return { action: committed?.value === id ? 'commit' : 'rollback' };
  }
  async complete(id: unknown) {
    const pending = await this.pending();
    if (!pending) return { ok: true };
    if (pending.id !== id || this.completing) throw new ConflictException('迁移恢复正在进行，请稍后重试');
    const release = lockConfigurationMigration(); let unlock: (() => void) | undefined;
    this.completing = true;
    try {
      unlock = this.news.lockForMigration(); await this.news.reloadAfterMigration();
      await this.prisma.$transaction(async tx => {
        await tx.newsSource.updateMany({ where: { id: { in: pending.sources } }, data: { enabled: true, nextCheckAt: null } });
        const row = await tx.setting.findUniqueOrThrow({ where: { key: 'news-telegram-account-v1' } });
        const value = JSON.stringify({ ...JSON.parse(row.value), enabled: pending.telegramEnabled });
        await tx.setting.update({ where: { key: row.key }, data: { value } });
        await tx.setting.update({ where: { key: 'news-ai-queue-paused' }, data: { value: String(pending.aiPaused) } });
        await tx.setting.delete({ where: { key: PENDING } });
      });
      this.control.restartCollection(); return { ok: true };
    } finally { this.completing = false; unlock?.(); release(); }
  }
}
