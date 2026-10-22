import { BadRequestException } from '@nestjs/common';
import { NEWS_SOURCES, NewsSourceConfig, ApiSourceConfig, WebSourceConfig, WebRules, xUsername } from './sources';
import { DEFAULT_EXCLUSIONS, FilterRule } from './content-filter';
import { isDomesticUrl } from './rules';
import { isLocalFeed } from './transports';
import { randomUUID } from 'node:crypto';
import { SourceNetworkConfig, validateSourceNetwork, sourceNetwork } from './source-network';
import { BrowserConfig, validateBrowserConfig } from './browser-config';

export const ADMIN_CONFIG_KEY = 'news-admin-config-v1';
export interface AiConfig { enabled: boolean; baseUrl: string; model: string; dailyLimit: number; apiKey: string; instructions: string; intervalMs: number; autoAnalyzeNew: boolean; newsOutputTokens: number }
export interface SourceOrder { id: string; sortOrder: number; editedAt: string | null }
export interface AdminConfig { version: 2; ai: AiConfig; sources: NewsSourceConfig[]; rules: FilterRule[]; removedSourceIds: string[]; network?: SourceNetworkConfig; browser?: BrowserConfig; sourceOrder?: SourceOrder[] }
export function validateSourceSortOrder(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new BadRequestException('排序必须是安全范围内的整数');
  return value;
}
export function sourceOrdering(config: AdminConfig): SourceOrder[] {
  const saved = new Map(config.sourceOrder?.map(order => [order.id, order]));
  return config.sources.map((source, index) => saved.get(source.id) || { id: source.id, sortOrder: index + 1, editedAt: null });
}
function restoreSourceOrdering(value: unknown, sources: NewsSourceConfig[]): SourceOrder[] {
  if (!Array.isArray(value) || value.length > sources.length) throw new BadRequestException('来源排序配置无效');
  const ids = new Set<string>();
  return value.map(input => {
    const entry = object(input); const id = string(entry.id, '来源 ID', 64);
    if (ids.has(id) || !sources.some(source => source.id === id)) throw new BadRequestException('来源排序包含重复或不存在的来源');
    ids.add(id);
    const editedAt = entry.editedAt;
    if (editedAt !== null && (typeof editedAt !== 'string' || editedAt.length > 40 || !Number.isFinite(Date.parse(editedAt)))) throw new BadRequestException('来源编辑时间无效');
    return { id, sortOrder: validateSourceSortOrder(entry.sortOrder), editedAt: editedAt as string | null };
  });
}
export function readAiUsage(value?: string): number {
  if (value === undefined) return 0;
  const usage = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(usage)) throw new Error('已保存的 AI 用量无效，请检查数据库；调用已停止');
  return usage;
}
export function defaultConfig(): AdminConfig {
  const limit = Number(process.env.AI_DAILY_LIMIT || 100);
  return { version: 2, ai: { enabled: (process.env.AI_ANALYSIS_ENABLED ?? process.env.AI_TRANSLATION_ENABLED) === 'true',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY || '',
    dailyLimit: Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0, instructions: '', intervalMs: 500, autoAnalyzeNew: true, newsOutputTokens: 8192 },
    sources: NEWS_SOURCES.map(s => ({ ...s, feedUrls: [...s.feedUrls], publisherHosts: [...s.publisherHosts] })), rules: DEFAULT_EXCLUSIONS.map(r => ({ ...r })), removedSourceIds: [] };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('配置必须是对象');
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string, max: number, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new BadRequestException(`${name}为空或过长`);
  return value.trim();
}
function boolean(value: unknown) {
  if (typeof value !== 'boolean') throw new BadRequestException('开关必须是布尔值');
  return value;
}
export function publicUrl(value: unknown, name: string): string {
  const raw = string(value, name, 2000);
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
      || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname) || !url.hostname.includes('.') || url.hostname.endsWith('.local')) throw new Error();
    return url.href;
  } catch { throw new BadRequestException(`${name}必须是公开的 HTTP(S) 地址，不能包含账号密码`); }
}
export function validateAi(value: unknown, previous: AiConfig): AiConfig {
  const body = object(value);
  const dailyLimit = body.dailyLimit;
  if (!Number.isInteger(dailyLimit) || Number(dailyLimit) < 0 || Number(dailyLimit) > 100_000) throw new BadRequestException('每日额度应为 0–100000 的整数');
  const apiKey = body.apiKey === undefined || body.apiKey === '' ? previous.apiKey : string(body.apiKey, 'API Key', 1000);
  const intervalMs = body.intervalMs ?? previous.intervalMs;
  const newsOutputTokens = body.newsOutputTokens ?? previous.newsOutputTokens;
  if (!Number.isInteger(intervalMs) || Number(intervalMs) < 0 || Number(intervalMs) > 60000) throw new BadRequestException('请求间隔应为 0–60000 毫秒');
  if (!Number.isInteger(newsOutputTokens) || Number(newsOutputTokens) < 1024 || Number(newsOutputTokens) > 32768) throw new BadRequestException('新闻输出预算应为 1024–32768 tokens');
  return { enabled: boolean(body.enabled), baseUrl: publicUrl(body.baseUrl, 'AI 接口地址'), model: string(body.model, '模型', 200),
    dailyLimit: Number(dailyLimit), apiKey, instructions: string(body.instructions ?? '', '额外提示词', 4000, true), intervalMs: Number(intervalMs), newsOutputTokens: Number(newsOutputTokens), autoAnalyzeNew: boolean(body.autoAnalyzeNew ?? previous.autoAnalyzeNew) };
}
export const defaultApi = (): ApiSourceConfig => ({ method: 'GET', body: '', auth: { type: 'none', header: 'Authorization', value: '' }, mapping: { items: 'articles', title: 'title', summary: 'description', url: 'url', publishedAt: 'publishedAt', author: 'author', images: 'urlToImage', body: 'content' } });
export const defaultWeb = (): WebSourceConfig => ({ rules: { mode: 'metadata', item: '', title: '', summary: '', link: '', date: '', image: '', body: '', author: '', next: '' }, loadMoreText: '', loadMoreContainer: '', timeoutSeconds: 30, maxItems: 50, maxPages: 3, concurrency: 1 });
export function validateWebRules(value: unknown): WebRules {
  const input = object(value); const rules = defaultWeb().rules;
  if (!['metadata', 'css'].includes(String(input.mode))) throw new BadRequestException('解析方式必须是 metadata 或 css');
  rules.mode = input.mode as WebRules['mode'];
  for (const key of ['item', 'title', 'summary', 'link', 'date', 'image', 'body', 'author', 'next'] as const) rules[key] = string(input[key] ?? '', 'CSS 选择器', 500, true);
  if (Object.keys(input).some(key => !Object.hasOwn(rules, key))) throw new BadRequestException('解析规则不能包含脚本或其他字段');
  if (rules.mode === 'css' && (!rules.item || (!rules.title && !rules.body) || !rules.link)) throw new BadRequestException('列表解析至少需要条目、标题或正文、链接选择器');
  return rules;
}
export function validateSource(value: unknown, previous?: NewsSourceConfig, restoring = false): NewsSourceConfig {
  const body = object(value);
  const id = body.id ? string(body.id, '来源 ID', 64) : `source-${randomUUID()}`;
  if (!/^[a-z][a-z0-9_-]*$/.test(id)) throw new BadRequestException('来源 ID 格式无效');
  const rawKind = String(body.kind);
  if (!['rss', 'google-rss', 'rsshub', 'web', 'api', 'telegram', ...(previous?.kind === 'reserved' ? ['reserved'] : [])].includes(rawKind)) throw new BadRequestException('未知的来源获取方式');
  const adapter = String(body.adapter || 'generic') as NewsSourceConfig['adapter'];
  if (!['generic', 'x-official', 'twitter', 'bing', 'hackernews', 'bilibili', 'sogou'].includes(adapter!)) throw new BadRequestException('未知的来源适配器');
  const pollSeconds = Number(body.pollSeconds);
  if (!Number.isInteger(body.pollSeconds) || pollSeconds < (rawKind === 'telegram' ? 0 : 60) || pollSeconds > 86400) throw new BadRequestException('采集间隔应为 60–86400 秒；Telegram 接收可为 0');
  const rss = ['rss', 'google-rss', 'rsshub'].includes(rawKind);
  const urls = rss ? body.feedUrls ?? [body.feedUrl] : [];
  if (!Array.isArray(urls) || urls.length > 10 || (rss && !urls.length)) throw new BadRequestException('RSS 需配置 1–10 个地址');
  const feedUrls = urls.map(value => { const raw = string(value, 'RSS 地址', 2000); return isLocalFeed(raw) ? new URL(raw).href : publicUrl(raw, 'RSS 地址'); });
  if (new Set(feedUrls).size !== feedUrls.length) throw new BadRequestException('RSS 地址不能重复');
  let target = rawKind === 'web' || (rawKind === 'api' && adapter === 'generic') ? publicUrl(body.target, '采集目标') : string(body.target ?? body.channel ?? '', '采集目标', 2000, true);
  if (rawKind === 'api' && adapter === 'x-official') {
    const username = xUsername(target);
    if (!username) throw new BadRequestException('请填写 X 公开用户名（如 USA_China_Talk）、@用户名或账号主页地址');
    target = username;
  }
  const hosts = body.publisherHosts ?? previous?.publisherHosts ?? [];
  if (!Array.isArray(hosts) || hosts.length > 20) throw new BadRequestException('原文域名最多 20 个');
  const publisherHosts = hosts.map(h => {
    const host = string(h, '原文域名', 253).toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host) || isDomesticUrl(`https://${host}`)) throw new BadRequestException('原文域名应为海外发布者域名');
    return host;
  });
  if (!publisherHosts.length && (rss || rawKind === 'web' || (rawKind === 'api' && adapter === 'generic'))) {
    const host = new URL(feedUrls[0] || target).hostname;
    if (!isLocalFeed(feedUrls[0] || target) && host !== 'news.google.com') publisherHosts.push(host);
  }
  if (rss && !publisherHosts.length) throw new BadRequestException('Google 索引或内部 RSSHub 需在高级配置中填写原文发布者域名');
  const logo = string(body.logo ?? previous?.logo ?? '', 'Logo', 2000, true);
  const timeZone = string(body.timeZone || previous?.timeZone || 'UTC', '发布时间时区', 80);
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new BadRequestException('发布时间时区应为有效 IANA 时区，如 UTC 或 Asia/Shanghai'); }
  if (logo && !/^\/api\/news\/logos\/[a-f0-9-]+\.(png|jpg|webp)$/.test(logo)) publicUrl(logo, 'Logo 地址');
  const source: NewsSourceConfig = { id, name: string(body.name, '来源名称', 100), englishName: string(body.englishName || previous?.englishName || publisherHosts[0] || body.name, '发布者', 100),
    kind: rss ? new URL(feedUrls[0]).hostname === 'news.google.com' ? 'google-rss' : 'rss' : rawKind as NewsSourceConfig['kind'],
    website: body.website ? publicUrl(body.website, '来源链接') : previous?.website || (rss ? new URL(feedUrls[0]).origin : rawKind === 'web' || (rawKind === 'api' && adapter === 'generic') ? new URL(target).origin : ''),
    feedUrls, feedUrl: feedUrls[0], target, adapter, logo, timeZone, notes: string(body.notes ?? previous?.notes ?? '', '备注', 2000, true), publisherHosts: [...new Set(publisherHosts)],
    description: string(body.description ?? '', '说明', 800, true), pollSeconds, enabled: previous?.enabled ?? false,
    forceChina: boolean(body.forceChina ?? previous?.forceChina ?? false),
    ...(body.useProxy === undefined && previous?.useProxy === undefined ? {} : { useProxy: boolean(body.useProxy ?? previous?.useProxy) }) };
  if (source.kind === 'telegram') {
    const channel = string(body.channel || target, 'Telegram 频道', 100).replace(/^@/, '');
    if (!/^[a-zA-Z][a-zA-Z0-9_]{3,99}$/.test(channel)) throw new BadRequestException('请填写公开 Telegram 频道用户名');
    source.channel = channel; source.target = channel; source.website = `https://t.me/${channel}`;
    delete source.useProxy;
  }
  if (source.kind === 'api' && adapter === 'x-official') source.website = `https://x.com/${target}`;
  if (source.kind === 'api') {
    const input = object(body.api ?? defaultApi()); const defaults = defaultApi();
    const auth = object(input.auth ?? defaults.auth);
    const sameAdapter = previous?.kind === 'api' && (previous.adapter || 'generic') === adapter;
    const secret = string(auth.value || (sameAdapter ? previous?.api?.auth.value : '') || '', '鉴权值', 4000, true);
    if (/[\r\n]/.test(secret)) throw new BadRequestException('鉴权值不能包含换行');
    if (adapter !== 'generic') {
      source.api = { ...defaults, auth: adapter === 'x-official' ? { type: 'bearer', header: 'Authorization', value: secret }
        : adapter === 'twitter' ? { type: 'header', header: 'X-API-Key', value: secret } : defaults.auth };
    } else {
      const mapping = object(input.mapping ?? defaults.mapping);
      if (!['GET', 'POST'].includes(String(input.method)) || !['none', 'bearer', 'header'].includes(String(auth.type))) throw new BadRequestException('API 方法或鉴权方式无效');
      const header = string(auth.header || 'Authorization', '鉴权头名称', 100);
      if (!/^[A-Za-z0-9-]+$/.test(header) || /^(host|content-length|connection|transfer-encoding|origin|forwarded|x-forwarded-.*)$/i.test(header)) throw new BadRequestException('不能覆盖网络或代理请求头');
      const requestBody = string(input.body ?? '', 'API 请求内容', 10000, true);
      if (requestBody) { try { JSON.parse(requestBody); } catch { throw new BadRequestException('API 请求内容必须是有效 JSON'); } }
      for (const key of Object.keys(defaults.mapping) as Array<keyof ApiSourceConfig['mapping']>) {
        defaults.mapping[key] = string(mapping[key] ?? '', '字段映射', 200, true);
        if (defaults.mapping[key] && (!/^[A-Za-z0-9_$.-]+$/.test(defaults.mapping[key]) || defaults.mapping[key].split('.').some(v => ['__proto__', 'prototype', 'constructor'].includes(v)))) throw new BadRequestException('字段映射只能使用属性路径，不支持脚本');
      }
      if ((!defaults.mapping.title && !defaults.mapping.body) || !defaults.mapping.url) throw new BadRequestException('API 至少需要标题或正文、链接字段映射');
      source.api = { method: input.method as ApiSourceConfig['method'], body: requestBody, auth: { type: auth.type as ApiSourceConfig['auth']['type'], header, value: secret }, mapping: defaults.mapping };
    }
  }
  if (source.kind === 'web') {
    const input = object(body.web ?? defaultWeb()); const web = defaultWeb();
    for (const [key, low, high] of [['timeoutSeconds', 5, 120], ['maxItems', 1, 500], ['maxPages', 1, 20], ['concurrency', 1, 3]] as const) {
      const number = input[key] ?? web[key]; if (!Number.isInteger(number) || Number(number) < low || Number(number) > high) throw new BadRequestException(`网页 ${key} 超出允许范围`); web[key] = Number(number);
    }
    web.rules = validateWebRules(input.rules ?? web.rules); web.previousRules = restoring && input.previousRules ? validateWebRules(input.previousRules) : previous?.web?.previousRules;
    web.loadMoreText = string(input.loadMoreText ?? '', '加载更多按钮文字', 120, true);
    web.loadMoreContainer = string(input.loadMoreContainer ?? '', '加载更多区域', 500, true);
    web.parseInstructions = string(input.parseInstructions ?? previous?.web?.parseInstructions ?? '', 'AI 解析提示', 2000, true);
    if (web.loadMoreText && !web.loadMoreContainer) throw new BadRequestException('按钮加载需要填写内容增长区域的 CSS 选择器');
    source.web = web;
  }
  return source;
}
export function validateRules(value: unknown, sources: Pick<NewsSourceConfig, 'id'>[]): FilterRule[] {
  if (!Array.isArray(value) || value.length > 200) throw new BadRequestException('最多配置 200 条规则');
  const ids = new Set<string>();
  return value.map(input => {
    const body = object(input); const id = string(body.id, '规则 ID', 100);
    if (ids.has(id)) throw new BadRequestException('规则 ID 不能重复'); ids.add(id);
    const sourceId = string(body.sourceId ?? '', '来源 ID', 64, true);
    if (sourceId && !sources.some(s => s.id === sourceId)) throw new BadRequestException('规则引用了不存在的来源');
    if (!['titleExact', 'titleContains', 'textContains', 'urlPrefix', 'urlExact'].includes(String(body.field))) throw new BadRequestException('未知规则类型');
    const value = body.field === 'urlPrefix' || body.field === 'urlExact' ? publicUrl(body.value, '规则 URL') : string(body.value, '匹配内容', 600);
    return { id, sourceId, enabled: boolean(body.enabled), field: body.field as FilterRule['field'], value };
  });
}
export function restoreConfig(raw: string): AdminConfig {
  const value = object(JSON.parse(raw)); const defaults = defaultConfig();
  if (!Array.isArray(value.sources) || value.sources.length > 100) throw new BadRequestException('来源配置无效');
  const sources = value.sources.map(input => {
    const source = object(input); const original = NEWS_SOURCES.find(s => s.id === source.id);
    return validateSource(source, original, true);
  });
  if (new Set(sources.map(s => s.id)).size !== sources.length) throw new BadRequestException('来源 ID 不能重复');
  const removedSourceIds = value.removedSourceIds ?? [];
  if (!Array.isArray(removedSourceIds) || removedSourceIds.length > 1000 || removedSourceIds.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(id))) throw new BadRequestException('已删除来源记录无效');
  return { version: 2, ai: validateAi(value.ai, { ...defaults.ai, apiKey: '' }), sources, removedSourceIds,
    ...(value.network === undefined ? {} : { network: validateSourceNetwork(value.network, { ...sourceNetwork(), proxyUrl: '' }) }),
    ...(value.browser === undefined ? {} : { browser: validateBrowserConfig(value.browser) }),
    ...(value.sourceOrder === undefined ? {} : { sourceOrder: restoreSourceOrdering(value.sourceOrder, sources) }),
    rules: validateRules(value.rules, [...sources, ...removedSourceIds.map(id => ({ id }))]) };
}
