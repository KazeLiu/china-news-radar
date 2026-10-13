import { Injectable, Logger, OnModuleInit, OnModuleDestroy, BadRequestException, NotFoundException, ConflictException, Optional } from '@nestjs/common';
import { Prisma, NewsAnalysis } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { NewsSourceConfig } from './sources';
import { CollectedItem, inspectFeed, parseFeed } from './collector';
import { retryAfterMs } from './rules';
import { telegramItem } from './telegram';
import { analysisKey, analysisInput, parseAnalysis, analysisDecision, fallbackDecision, ANALYSIS_PROMPT } from './analysis';
import { feedUrlsFor, distributionFor } from './transports';
import { fetchSourceFeed, FeedFetchError, restoreFailures } from './feed-fetch';
import { ADMIN_CONFIG_KEY, AdminConfig, defaultConfig, restoreConfig, validateAi, validateRules, validateSource, readAiUsage } from './admin-config';
import { matchingExclusions } from './content-filter';
import { AI_TIMEOUT_MS, InvalidAnalysisResponse, aiTestError, analysisErrorDetail } from './ai-errors';
import { createAiClient, reserveAiUsage } from './ai-runtime.service';
import { NewsBridgeService } from './news-bridge.service';

@Injectable()
export class NewsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NewsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private analysisTimer?: ReturnType<typeof setInterval>;
  private busy = false;
  private analyzing = false;
  private stopped = false;
  private config = defaultConfig();
  private configBusy = false;
  private testingSource = false;
  private testingAi = false;
  private get aiRequested() { return this.config.ai.enabled; }
  private get aiEnabled() { return this.aiRequested && !!this.config.ai.apiKey; }
  private get dailyLimit() { return this.config.ai.dailyLimit; }
  private ai = this.makeAi();
  constructor(private readonly prisma: PrismaService, @Optional() private readonly bridge?: NewsBridgeService) {}

  private makeAi() { return this.aiEnabled ? createAiClient(this.config.ai) : null; }
  private startAnalysisTimer() {
    if (!this.analysisTimer) this.analysisTimer = setInterval(() => {
      if (this.aiEnabled) void Promise.all([this.showOverdueFallbacks(), this.drainAnalysis()]).catch(() => this.logger.warn('AI 队列异常，原文已保留'));
    }, 1000);
  }

  async onModuleInit() {
    const stored = await this.prisma.setting.findUnique({ where: { key: ADMIN_CONFIG_KEY } });
    if (stored) this.config = restoreConfig(stored.value);
    this.ai = this.makeAi();
    for (const source of this.config.sources) await this.prisma.newsSource.upsert({ where: { id: source.id }, create: { id: source.id, enabled: source.enabled }, update: {} });
    await this.reapplyFilters();
    // Bootstrap recent candidates, preserving cached AI decisions and content timestamps.
    const recent = await this.prisma.newsItem.findMany({ where: { firstSeenAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } });
    for (const record of recent) {
      if (!this.config.sources.some(s => s.id === record.sourceId)) continue;
      const { title, summary, url, originalPublisher, originalUrl, author, topic, eventKey, contentHash, publishedAt } = record;
      await this.store(record.sourceId, { title, summary, url, originalPublisher, originalUrl, author, topic, eventKey, contentHash, publishedAt }, record.firstSeenAt, true);
    }
    await this.bridge?.rebuild();
    if (this.aiEnabled) {
      this.startAnalysisTimer();
      void this.drainAnalysis().catch(() => this.logger.warn('AI 队列异常，原文已保留'));
    }
    if (process.env.COLLECTOR_ENABLED !== 'false') {
      this.timer = setInterval(() => { void this.tick(); }, 15_000);
      void this.tick();
    }
  }
  onModuleDestroy() { this.stopped = true; if (this.timer) clearInterval(this.timer); if (this.analysisTimer) clearInterval(this.analysisTimer); }
  private async tick() {
    try { await this.scan(false); }
    catch { this.logger.warn('采集任务异常，请检查数据库和来源状态'); }
  }
  async sources(includeFeedAddresses = false) {
    const states = await this.prisma.newsSource.findMany();
    return this.config.sources.map(s => {
      const state = states.find(x => x.id === s.id);
      return { ...s, feedUrl: undefined, feedUrls: undefined, ...state, configured: feedUrlsFor(s).length > 0 || (s.kind === 'telegram' && process.env.TELEGRAM_ENABLED === 'true'),
        activeFeedUrl: includeFeedAddresses ? state?.activeFeedUrl || null : undefined,
        feedFailures: undefined, feedWarning: Object.values(restoreFailures(state?.feedFailures)).map(f => f.error).join('；'),
        distribution: distributionFor(state?.activeKind || s.kind) };
    });
  }
  async status() {
    const day = new Date().toISOString().slice(0, 10);
    const [total, latest, usage, pending, failed, limited] = await Promise.all([this.prisma.newsItem.count(), this.prisma.newsItem.findFirst({ orderBy: { firstSeenAt: 'desc' }, select: { firstSeenAt: true } }),
      this.prisma.setting.findUnique({ where: { key: `news-ai-usage-${day}` } }), this.prisma.newsAnalysis.count({ where: { status: { in: ['pending', 'processing'] } } }),
      this.prisma.newsAnalysis.count({ where: { status: 'failed' } }), this.prisma.newsAnalysis.count({ where: { status: 'limited' } })]);
    return { total, latestDiscoveryAt: latest?.firstSeenAt || null, scanning: this.busy, aiEnabled: this.aiEnabled, aiMode: this.aiEnabled ? 'enabled' : this.aiRequested ? 'missing-key' : 'disabled',
      aiDailyUsed: readAiUsage(usage?.value), aiDailyLimit: this.dailyLimit, aiPending: pending, aiFailed: failed, aiLimited: limited,
      collectorEnabled: process.env.COLLECTOR_ENABLED !== 'false', serverTime: new Date() };
  }
  async items(query: { q?: string; source?: string; topic?: string; saved?: string; offset?: string; clues?: string }) {
    const offset = Math.max(0, Math.min(100_000, Math.floor(Number(query.offset) || 0)));
    const where: Prisma.NewsItemWhereInput = {
      ...(query.source ? { sourceId: query.source } : {}), ...(query.topic ? { AND: [{ OR: [{ topic: query.topic }, { aiTopics: { contains: JSON.stringify(query.topic) } }] }] } : {}),
      ...(query.saved === 'true' ? { saved: true } : {}),
      ...(query.saved === 'true' ? {} : { visible: true }),
      ...(query.clues === 'true' || query.saved === 'true' ? {} : { originalPublisher: { not: null } }),
      ...(query.q ? { OR: ['title', 'summary', 'titleZh', 'summaryZh'].map(field => ({ [field]: { contains: query.q!.slice(0, 200) } })) } : {}),
    };
    const [items, total] = await Promise.all([this.prisma.newsItem.findMany({ where, orderBy: [{ firstSeenAt: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }], skip: offset, take: 50 }), this.prisma.newsItem.count({ where })]);
    return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null };
  }
  async save(id: string, saved: unknown) {
    if (typeof saved !== 'boolean') throw new BadRequestException('saved 必须是布尔值');
    const item = await this.prisma.newsItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('消息不存在');
    return this.prisma.newsItem.update({ where: { id }, data: { saved, updatedAt: item.updatedAt } });
  }
  async enableSource(id: string, enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new BadRequestException('开关必须是布尔值');
    const config = this.config.sources.find(s => s.id === id);
    if (!config) throw new NotFoundException('来源不存在');
    if (enabled && !feedUrlsFor(config).length && !(config.kind === 'telegram' && process.env.TELEGRAM_ENABLED === 'true')) throw new BadRequestException('来源尚未配置，请先完成接入');
    await this.prisma.newsSource.update({ where: { id }, data: { enabled, nextCheckAt: enabled ? null : undefined } });
    return this.sources();
  }
  async scan(force = true) {
    if (this.busy || this.configBusy) return { scanning: true, started: false };
    this.busy = true;
    this.bridge?.scanStatus(true);
    try {
      const now = new Date();
      const states = await this.prisma.newsSource.findMany({ where: { enabled: true } });
      const due = this.config.sources.filter(s => feedUrlsFor(s).length && states.some(x => x.id === s.id && (!x.nextCheckAt || x.nextCheckAt <= now || (force && !x.error))));
      // At most two HTTP requests at a time. Manual scans still honor error backoff.
      for (let i = 0; i < due.length; i += 2) await Promise.all(due.slice(i, i + 2).map(s => this.collect(s)));
      return { scanning: false, started: true, sourcesChecked: due.length };
    } finally { this.busy = false; this.bridge?.scanStatus(false); }
  }
  private async collect(source: NewsSourceConfig) {
    if (JSON.stringify(source) !== JSON.stringify(this.config.sources.find(s => s.id === source.id))) return;
    const state = await this.prisma.newsSource.findUniqueOrThrow({ where: { id: source.id } });
    const now = new Date();
    try {
      const { response, parsed, selected, failures } = await fetchSourceFeed(source, (xml, selected) => parseFeed(xml, selected, now, false, this.config.rules), state);
      if (JSON.stringify(source) !== JSON.stringify(this.config.sources.find(s => s.id === source.id))) return;
      let changed = 0;
      for (const item of parsed || []) {
        if (JSON.stringify(source) !== JSON.stringify(this.config.sources.find(s => s.id === source.id))) return;
        if (await this.store(source.id, item, now)) changed++;
      }
      await this.prisma.newsSource.update({ where: { id: source.id }, data: { lastCheckedAt: now, lastSuccessAt: now, error: null,
        nextCheckAt: new Date(Date.now() + source.pollSeconds * 1000), activeKind: selected.kind, activeFeedUrl: selected.feedUrl, feedFailures: JSON.stringify(failures),
        ...(response.status === 200 ? { etag: response.headers.etag || null, lastModified: response.headers['last-modified'] || null, lastItemCount: parsed?.length || 0 } : {}) } });
      this.logger.log(`${source.englishName}: ${response.status}, ${changed} 条新增或更新`);
    } catch (error) {
      if (JSON.stringify(source) !== JSON.stringify(this.config.sources.find(s => s.id === source.id))) return;
      const failures = error instanceof FeedFetchError ? error.failures : {};
      const retryTimes = Object.values(failures).map(f => Date.parse(f.retryAt)).filter(t => t > Date.now());
      await this.prisma.newsSource.update({ where: { id: source.id }, data: { lastCheckedAt: now,
        nextCheckAt: new Date(retryTimes.length ? Math.min(...retryTimes) : Date.now() + 300_000),
        error: error instanceof FeedFetchError ? `${error.message}，所有 RSS 地址均未成功，稍后重试` : '入库失败，请检查数据库',
        ...(error instanceof FeedFetchError ? { feedFailures: JSON.stringify(failures) } : {}) } });
    }
  }
  private async store(sourceId: string, item: CollectedItem, discoveredAt = new Date(), refresh = false) {
    const where = { sourceId_url: { sourceId, url: item.url } };
    const existing = await this.prisma.newsItem.findUnique({ where });
    if (matchingExclusions(item, this.config.rules, sourceId).length) {
      if (existing) await this.updateItem({ where: { id: existing.id, updatedAt: existing.updatedAt },
        data: { visible: false, analysisKey: null, aiStatus: 'excluded', updatedAt: existing.updatedAt } });
      return !!existing;
    }
    if (existing?.contentHash === item.contentHash && !refresh) return false;
    let key = analysisKey(item);
    let cache = await this.findCached(item);
    if (cache?.key) key = cache.key;
    if (!cache && this.aiEnabled) cache = await this.prisma.newsAnalysis.upsert({ where: { key }, create: { key, inputJson: JSON.stringify(analysisInput(item)) }, update: {} });
    if (cache?.status === 'obsolete' && this.aiEnabled) cache = await this.prisma.newsAnalysis.update({ where: { key }, data: { status: 'pending', retryAt: null, leaseUntil: null } });
    const decision = await this.cachedDecision(item, sourceId, cache, this.aiEnabled ? cache?.status || 'pending' : 'disabled');
    if (this.aiEnabled && (!cache || ['pending', 'processing'].includes(cache.status))) decision.visible = false;
    const data = { ...item, analysisKey: key, ...decision };
    const args = { where, create: { ...data, sourceId, firstSeenAt: discoveredAt }, update: { ...data, ...(existing?.contentHash === item.contentHash ? { updatedAt: existing.updatedAt } : {}) } };
    if (this.bridge) {
      const stored = await this.prisma.$transaction(async tx => {
        const record = await tx.newsItem.upsert(args);
        await this.bridge!.sync(tx, record.id, !refresh && !existing);
        return record;
      });
      if (!refresh && !existing) await this.bridge.announce(stored.id);
    } else await this.prisma.newsItem.upsert(args);
    return true;
  }
  async ingest(input: Parameters<typeof telegramItem>[0]) {
    if (process.env.TELEGRAM_ENABLED !== 'true') throw new BadRequestException('Telegram 尚未启用');
    const parsed = telegramItem(input, false);
    if (!parsed) return { accepted: false, reason: '空消息、过期或国内来源' };
    if (!this.config.sources.some(s => s.id === parsed.sourceId)) return { accepted: false, reason: '频道来源已删除' };
    const state = await this.prisma.newsSource.findUniqueOrThrow({ where: { id: parsed.sourceId } });
    if (!state.enabled) return { accepted: false, reason: '频道已暂停，请在来源管理中启用' };
    const changed = await this.store(parsed.sourceId, parsed.item);
    await this.prisma.newsSource.update({ where: { id: parsed.sourceId }, data: { lastCheckedAt: new Date(), lastSuccessAt: new Date(), error: null } });
    return { accepted: true, changed };
  }
  private async drainAnalysis() {
    if (!this.ai || this.analyzing || this.stopped) return;
    this.analyzing = true;
    try { for (let count = 0; count < 20 && !this.stopped; count++) if (!await this.analyzeNext()) break; }
    finally { this.analyzing = false; }
  }
  private async showOverdueFallbacks() {
    // Slow providers or a long queue must not hide timely rule-matched news indefinitely.
    const overdue = await this.prisma.newsItem.findMany({ where: { aiStatus: 'pending', decisionBy: 'rules', firstSeenAt: { lte: new Date(Date.now() - 15_000) } } });
    for (const item of overdue) {
      const args = { where: { id: item.id, analysisKey: item.analysisKey, updatedAt: item.updatedAt }, data: { ...fallbackDecision(item, 'pending', this.config.rules, item.sourceId), decisionBy: 'rules-waiting', updatedAt: item.updatedAt } };
      if (this.bridge) await this.prisma.$transaction(async tx => { await tx.newsItem.updateMany(args); await this.bridge!.sync(tx, item.id); });
      else await this.prisma.newsItem.updateMany(args);
      await this.bridge?.announce(item.id);
    }
  }
  private async applyCache(tx: Prisma.TransactionClient, job: NewsAnalysis) {
    const items = await tx.newsItem.findMany({ where: { analysisKey: job.key } });
    const result = job.status === 'done' && job.resultJson ? parseAnalysis(job.resultJson) : null;
    for (const item of items) {
      const data = result ? { ...analysisDecision(result, item, this.config.rules, item.sourceId), analyzedAt: job.analyzedAt } : fallbackDecision(item, job.status, this.config.rules, item.sourceId);
      await tx.newsItem.updateMany({ where: { id: item.id, analysisKey: job.key, updatedAt: item.updatedAt }, data: { ...data, updatedAt: item.updatedAt } });
      await this.bridge?.sync(tx, item.id);
    }
  }
  private async announceAnalysis(key: string) {
    if (!this.bridge) return;
    const items = await this.prisma.newsItem.findMany({ where: { analysisKey: key }, select: { id: true } });
    for (const item of items) await this.bridge.announce(item.id);
  }
  private async findCached(item: Parameters<typeof analysisKey>[0]) {
    const current = await this.prisma.newsAnalysis.findUnique({ where: { key: analysisKey(item) } });
    if (current?.status === 'done') return current;
    const legacy = await this.prisma.newsAnalysis.findUnique({ where: { key: analysisKey(item, 1) } });
    return legacy && (legacy.status === 'done' || (legacy.status === 'failed' && legacy.resultJson)) ? legacy : current;
  }
  private async updateItem(args: Prisma.NewsItemUpdateManyArgs & { where: { id: string } }) {
    if (!this.bridge) return this.prisma.newsItem.updateMany(args);
    return this.prisma.$transaction(async tx => {
      const result = await tx.newsItem.updateMany(args);
      if (result.count) await this.bridge!.sync(tx, args.where.id);
      return result;
    });
  }
  private async cachedDecision(item: Parameters<typeof fallbackDecision>[0], sourceId: string, cache: NewsAnalysis | null, status: string) {
    if (cache?.status === 'done') {
      try {
        if (!cache.resultJson) throw new Error('AI JSON object required');
        return { ...analysisDecision(parseAnalysis(cache.resultJson), item, this.config.rules, sourceId), analyzedAt: cache.analyzedAt };
      } catch (problem) {
        const error = `已保存的 AI 结果无效：${analysisErrorDetail(problem)} 采用规则兜底，不自动重新调用模型。`;
        await this.prisma.newsAnalysis.updateMany({ where: { key: cache.key, status: 'done' }, data: { status: 'failed', error, retryAt: null, leaseUntil: null } });
        this.logger.warn(error);
        status = 'failed';
      }
    }
    return fallbackDecision(item, status, this.config.rules, sourceId);
  }
  private async analyzeNext(): Promise<boolean> {
    const ai = this.ai; const model = this.config.ai.model; const instructions = this.config.ai.instructions;
    if (!ai || !this.aiEnabled || this.configBusy) return false;
    const now = new Date(); const day = now.toISOString().slice(0, 10); const usageKey = `news-ai-usage-${day}`;
    const nextDay = new Date(`${day}T00:00:00.000Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const claimed = await this.prisma.$transaction(async tx => {
      const job = await tx.newsAnalysis.findFirst({ where: { OR: [
        { status: { in: ['pending', 'limited'] }, OR: [{ retryAt: null }, { retryAt: { lte: now } }] },
        { status: 'failed', attempts: { lt: 3 }, retryAt: { lte: now } },
        { status: 'processing', leaseUntil: { lte: now } },
      ] }, orderBy: { createdAt: 'desc' } });
      if (!job) return null;
      if (!await tx.newsItem.count({ where: { analysisKey: job.key } })) {
        await tx.newsAnalysis.update({ where: { key: job.key }, data: { status: 'obsolete', leaseUntil: null, retryAt: null } });
        return { job, call: false };
      }
      const usage = readAiUsage((await tx.setting.findUnique({ where: { key: usageKey } }))?.value);
      if (job.attempts >= 3 || usage >= this.dailyLimit) {
        const updated = await tx.newsAnalysis.update({ where: { key: job.key }, data: { status: job.attempts >= 3 ? 'failed' : 'limited',
          error: job.attempts >= 3 ? '尝试次数已用尽，采用规则兜底' : '今日调用额度已用尽，采用规则兜底', retryAt: job.attempts >= 3 ? null : nextDay, leaseUntil: null } });
        await this.applyCache(tx, updated);
        return { job: updated, call: false };
      }
      // A single SQLite transaction reserves budget before the paid request and claims the job.
      await reserveAiUsage(tx, this.dailyLimit, now);
      const updated = await tx.newsAnalysis.update({ where: { key: job.key }, data: { status: 'processing', attempts: { increment: 1 }, leaseUntil: new Date(now.getTime() + AI_TIMEOUT_MS + 30_000), retryAt: null } });
      return { job: updated, call: true };
    });
    if (!claimed) return false;
    if (!claimed.call) { await this.announceAnalysis(claimed.job.key); return true; }
    const { job } = claimed;
    let resultJson: string | null = null; let error: string | null = null; let retryDelay = 30_000 * 2 ** (job.attempts - 1);
    try {
      resultJson = JSON.stringify(await this.requestAnalysis(ai, model, instructions, job.inputJson));
    } catch (problem) {
      error = 'AI 调用失败或 JSON 不符合约定，采用规则兜底';
      const failure = problem as { status?: number; headers?: Record<string, unknown> | Headers };
      if (failure?.status === 429) retryDelay = retryAfterMs(failure.headers instanceof Headers ? failure.headers.get('retry-after') : failure.headers?.['retry-after']);
    }
    await this.prisma.$transaction(async tx => {
      const changed = await tx.newsAnalysis.updateMany({ where: { key: job.key, status: 'processing', attempts: job.attempts }, data: {
        status: resultJson ? 'done' : 'failed', resultJson, model, error,
        analyzedAt: resultJson ? new Date() : null, leaseUntil: null, retryAt: !resultJson && job.attempts < 3 ? new Date(Date.now() + retryDelay) : null,
      } });
      if (changed.count) await this.applyCache(tx, await tx.newsAnalysis.findUniqueOrThrow({ where: { key: job.key } }));
    });
    await this.announceAnalysis(job.key);
    return true;
  }

  private prompt(instructions = this.config.ai.instructions) { return `${ANALYSIS_PROMPT}\nAdministrator editorial instructions:\n${instructions || '(none)'}\nKeep the required JSON schema and translation rules unchanged.`; }
  private async requestAnalysis(ai: OpenAI, model: string, instructions: string, inputJson: string) {
    const response = await ai.chat.completions.create({ model, temperature: 0, max_tokens: 3000,
      response_format: { type: 'json_object' }, messages: [{ role: 'system', content: this.prompt(instructions) }, { role: 'user', content: inputJson }] });
    const choice = response.choices?.[0];
    if (choice?.finish_reason === 'length') throw new InvalidAnalysisResponse('模型达到输出长度上限，返回内容被截断。请使用支持当前输出长度的模型。', response._request_id);
    if (choice?.finish_reason === 'content_filter') throw new InvalidAnalysisResponse('提供商的内容过滤阻止了模型输出。', response._request_id);
    if (!choice?.message?.content) throw new InvalidAnalysisResponse('接口响应缺少 choices[0].message.content，无法读取模型结果。', response._request_id);
    try {
      const result = parseAnalysis(choice.message.content);
      if (result.version !== 2) throw new Error('AI JSON enum invalid');
      if (JSON.parse(inputJson).summary && result.translation && !result.translation.summary) throw new Error('Translation summary missing');
      return result;
    } catch (problem) { throw new InvalidAnalysisResponse(analysisErrorDetail(problem), response._request_id); }
  }
  async testAi(body: unknown) {
    const sample = body as { title?: unknown; summary?: unknown } | null;
    if (!sample || typeof sample.title !== 'string' || typeof sample.summary !== 'string' || sample.title.length > 600 || sample.summary.length > 1600)
      throw new BadRequestException('测试标题最多 600 字符，摘要最多 1600 字符');
    const input = analysisInput({ title: sample.title, summary: sample.summary });
    if (!input.title) throw new BadRequestException('请填写测试标题');
    const config = { ...this.config.ai };
    const savedClient = this.ai;
    if (!config.apiKey) throw new BadRequestException('请先保存 API Key，再测试调用');
    if (this.configBusy || this.testingAi) throw new ConflictException('正在保存配置或测试 AI，请稍后重试');
    this.testingAi = true;
    const checkedAt = new Date(); const start = Date.now();
    try {
      const usageKey = `news-ai-usage-${checkedAt.toISOString().slice(0, 10)}`;
      const usage = await this.prisma.$transaction(tx => reserveAiUsage(tx, config.dailyLimit, checkedAt));
      const metadata = { checkedAt, model: config.model, input, usage };
      try {
        const ai = savedClient || createAiClient(config);
        const result = await this.requestAnalysis(ai, config.model, config.instructions, JSON.stringify(input));
        const decision = analysisDecision(result, { ...input, url: 'https://example.invalid/ai-test' }, []);
        return { ...metadata, ok: true, elapsedMs: Date.now() - start, result, preview: { visible: decision.visible, decisionBy: decision.decisionBy } };
      } catch (problem) {
        return { ...metadata, ok: false, elapsedMs: Date.now() - start, error: aiTestError(problem, config.apiKey) };
      }
    } finally { this.testingAi = false; }
  }
  async adminConfig() {
    const { apiKey, ...ai } = this.config.ai;
    const states = await this.sources(true);
    return { ai: { ...ai, keyConfigured: !!apiKey, protocolPrompt: ANALYSIS_PROMPT },
      sources: this.config.sources.map(s => ({ ...s, state: states.find(state => state.id === s.id) })), rules: this.config.rules,
      status: await this.status(), localOnly: !process.env.ADMIN_TOKEN };
  }
  adminAiKey() { return { apiKey: this.config.ai.apiKey }; }
  private async updateConfig(next: AdminConfig, mutation?: (tx: Prisma.TransactionClient) => Promise<unknown>, afterChange?: () => Promise<unknown>) {
    if (this.configBusy) throw new ConflictException('正在保存配置，请稍后重试');
    this.configBusy = true;
    try {
      // Persist first. Validation never changes in-memory settings or credentials.
      await this.prisma.$transaction(async tx => {
        await tx.setting.upsert({ where: { key: ADMIN_CONFIG_KEY }, create: { key: ADMIN_CONFIG_KEY, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
        if (mutation) await mutation(tx);
      });
      this.config = next; this.ai = this.makeAi();
      if (afterChange) await afterChange();
      if (this.aiEnabled) this.startAnalysisTimer();
    } finally { this.configBusy = false; }
  }
  async configureAi(body: unknown) {
    const ai = validateAi(body, this.config.ai);
    await this.updateConfig({ ...this.config, ai }, undefined, async () => { if (!this.aiEnabled) {
      const pending = await this.prisma.newsItem.findMany({ where: { aiStatus: 'pending' } });
      for (const item of pending) await this.updateItem({ where: { id: item.id, analysisKey: item.analysisKey, updatedAt: item.updatedAt },
        data: { ...fallbackDecision(item, 'disabled', this.config.rules, item.sourceId), updatedAt: item.updatedAt } });
    } });
    await this.bridge?.rebuild();
    return this.adminConfig();
  }
  async configureSource(body: unknown) {
    const id = (body as { id?: unknown } | null)?.id;
    const previous = this.config.sources.find(s => s.id === id);
    const source = validateSource(body, previous);
    if (!previous && this.config.sources.length >= 100) throw new BadRequestException('最多配置 100 个来源');
    const sources = previous ? this.config.sources.map(s => s.id === source.id ? source : s) : [...this.config.sources, source];
    await this.updateConfig({ ...this.config, sources, removedSourceIds: this.config.removedSourceIds.filter(id => id !== source.id) }, tx => tx.newsSource.upsert({ where: { id: source.id },
      create: { id: source.id, enabled: false }, update: { etag: null, lastModified: null, activeKind: null, activeFeedUrl: null, feedFailures: '{}', nextCheckAt: null, error: null } }));
    return this.adminConfig();
  }
  async deleteSource(id: string) {
    if (!this.config.sources.some(s => s.id === id)) throw new NotFoundException('来源不存在');
    if (this.config.removedSourceIds.length >= 1000) throw new BadRequestException('已删除来源记录达到上限');
    await this.updateConfig({ ...this.config, sources: this.config.sources.filter(s => s.id !== id),
      removedSourceIds: [...this.config.removedSourceIds, id] }, tx => tx.newsSource.update({ where: { id }, data: { enabled: false, nextCheckAt: null } }));
    return this.adminConfig();
  }
  async testSource(body: unknown) {
    const previous = this.config.sources.find(s => s.id === (body as { id?: unknown } | null)?.id);
    const source = validateSource(body, previous);
    if (this.testingSource) throw new ConflictException('正在测试其他来源，请稍后重试');
    this.testingSource = true;
    const now = new Date();
    try {
      const result = await fetchSourceFeed(source, (xml, selected) => inspectFeed(xml, selected, now, false, this.config.rules));
      const feed = result.parsed!;
      return { ok: true, checkedAt: now, feedUrl: result.selected.feedUrl, attempts: result.attempts, feedTitle: feed.title,
        rawCount: feed.rawCount, checkedCount: feed.checkedCount, acceptedCount: feed.items.length,
        samples: feed.samples.slice(0, 10).map(sample => ({ ...sample,
          fallbackVisible: sample.accepted && fallbackDecision({ ...sample, url: sample.url! }, 'preview', this.config.rules, source.id).visible })) };
    } catch (error) {
      if (!(error instanceof FeedFetchError)) throw error;
      return { ok: false, checkedAt: now, attempts: error.attempts, error: '所有 RSS 地址都获取失败，请检查下方逐条结果。' };
    } finally { this.testingSource = false; }
  }
  async configureRules(body: unknown) {
    const rules = validateRules(body, [...this.config.sources, ...this.config.removedSourceIds.map(id => ({ id }))]);
    let changed = 0;
    await this.updateConfig({ ...this.config, rules }, undefined, async () => { changed = await this.reapplyFilters(); });
    return { ...await this.adminConfig(), changed };
  }
  async previewRules(body: { title?: unknown; summary?: unknown; url?: unknown; sourceId?: unknown; rules?: unknown }) {
    if (!body || typeof body.title !== 'string' || typeof body.summary !== 'string' || typeof body.url !== 'string' || typeof body.sourceId !== 'string'
      || body.title.length > 600 || body.summary.length > 1600 || body.url.length > 2000) throw new BadRequestException('预览内容格式无效');
    const rules = body.rules === undefined ? this.config.rules : validateRules(body.rules, [...this.config.sources, ...this.config.removedSourceIds.map(id => ({ id }))]);
    const matched = matchingExclusions({ title: body.title, summary: body.summary, url: body.url }, rules, body.sourceId);
    return { excluded: matched.length > 0, matched, fallbackVisible: fallbackDecision({ title: body.title, summary: body.summary, url: body.url }, 'preview', rules, body.sourceId).visible };
  }
  private async reapplyFilters() {
    let cursor: string | undefined; let changed = 0;
    while (true) {
      const page = await this.prisma.newsItem.findMany({ orderBy: { id: 'asc' }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!page.length) break;
      for (const item of page) {
        const excluded = matchingExclusions(item, this.config.rules, item.sourceId).length > 0;
        if (excluded) {
          if (item.visible || item.aiStatus !== 'excluded' || item.analysisKey) {
            const result = await this.updateItem({ where: { id: item.id, updatedAt: item.updatedAt }, data: { visible: false, aiStatus: 'excluded', analysisKey: null, updatedAt: item.updatedAt } });
            changed += result.count;
          }
        } else if (item.aiStatus === 'excluded') {
          // Restore from an existing cache or rules only; rule edits never buy a new analysis.
          const cache = await this.findCached(item); const key = cache?.key || analysisKey(item);
          const decision = await this.cachedDecision(item, item.sourceId, cache, 'disabled');
          const result = await this.updateItem({ where: { id: item.id, updatedAt: item.updatedAt }, data: { ...decision, analysisKey: decision.aiStatus === 'done' ? key : null, updatedAt: item.updatedAt } });
          changed += result.count;
        }
      }
      cursor = page[page.length - 1].id;
      if (page.length < 200) break;
    }
    return changed;
  }
}
