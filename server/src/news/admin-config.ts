import { BadRequestException } from '@nestjs/common';
import { NEWS_SOURCES, NewsSourceConfig } from './sources';
import { DEFAULT_EXCLUSIONS, FilterRule } from './content-filter';
import { isDomesticUrl } from './rules';
import { isLocalFeed } from './transports';

export const ADMIN_CONFIG_KEY = 'news-admin-config-v1';
export interface AiConfig { enabled: boolean; baseUrl: string; model: string; dailyLimit: number; apiKey: string; instructions: string }
export interface AdminConfig { ai: AiConfig; sources: NewsSourceConfig[]; rules: FilterRule[]; removedSourceIds: string[] }
export function defaultConfig(): AdminConfig {
  const limit = Number(process.env.AI_DAILY_LIMIT || 100);
  return { ai: { enabled: (process.env.AI_ANALYSIS_ENABLED ?? process.env.AI_TRANSLATION_ENABLED) === 'true',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY || '',
    dailyLimit: Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0, instructions: '' },
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
  const apiKey = body.clearKey === true ? '' : body.apiKey === undefined || body.apiKey === '' ? previous.apiKey : string(body.apiKey, 'API Key', 1000);
  return { enabled: boolean(body.enabled), baseUrl: publicUrl(body.baseUrl, 'AI 接口地址'), model: string(body.model, '模型', 200),
    dailyLimit: Number(dailyLimit), apiKey, instructions: string(body.instructions ?? '', '额外提示词', 4000, true) };
}
export function validateSource(value: unknown, previous?: NewsSourceConfig): NewsSourceConfig {
  const body = object(value);
  const id = string(body.id, '来源 ID', 64);
  if (!/^[a-z][a-z0-9-]*$/.test(id) || id.startsWith('tg-')) throw new BadRequestException('RSS 来源 ID 只能使用小写字母、数字和短横线，不能以 tg- 开头');
  if (previous?.kind === 'telegram') throw new BadRequestException('Telegram 频道在客户端管理，本站只提供开关');
  if (!['rss', 'google-rss'].includes(String(body.kind))) throw new BadRequestException('入口类型必须是 RSS 或 Google News RSS');
  if (!Number.isInteger(body.pollSeconds) || Number(body.pollSeconds) < 60 || Number(body.pollSeconds) > 86400) throw new BadRequestException('采集间隔应为 60–86400 秒');
  if (!Array.isArray(body.publisherHosts) || !body.publisherHosts.length || body.publisherHosts.length > 20) throw new BadRequestException('至少配置一个发布者域名');
  const publisherHosts = body.publisherHosts.map(h => {
    const host = string(h, '发布者域名', 253).toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host) || isDomesticUrl(`https://${host}`)) throw new BadRequestException('发布者必须是海外媒体域名，不含协议和路径');
    return host;
  });
  const urls = body.feedUrls === undefined ? [body.feedUrl] : body.feedUrls;
  if (!Array.isArray(urls) || !urls.length || urls.length > 10) throw new BadRequestException('请配置 1–10 个 RSS 地址');
  const feedUrls = urls.map(value => {
    const raw = string(value, 'RSS 地址', 2000);
    return isLocalFeed(raw) ? new URL(raw).href : publicUrl(raw, 'RSS 地址');
  });
  if (new Set(feedUrls).size !== feedUrls.length) throw new BadRequestException('RSS 地址不能重复');
  return { id, name: string(body.name, '来源名称', 100), englishName: string(body.englishName, '发布者名称', 100),
    kind: new URL(feedUrls[0]).hostname === 'news.google.com' ? 'google-rss' : 'rss', website: publicUrl(body.website, '媒体网站'), feedUrl: feedUrls[0], feedUrls,
    publisherHosts: [...new Set(publisherHosts)], description: string(body.description ?? '', '说明', 800, true), pollSeconds: Number(body.pollSeconds), enabled: previous?.enabled ?? false };
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
    if (original?.kind === 'telegram' || (original?.kind === 'reserved' && source.kind === 'reserved')) return { ...original };
    return validateSource(source, original);
  });
  if (new Set(sources.map(s => s.id)).size !== sources.length) throw new BadRequestException('来源 ID 不能重复');
  const removedSourceIds = value.removedSourceIds ?? [];
  if (!Array.isArray(removedSourceIds) || removedSourceIds.length > 1000 || removedSourceIds.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id))) throw new BadRequestException('已删除来源记录无效');
  return { ai: validateAi(value.ai, { ...defaults.ai, apiKey: '' }), sources, removedSourceIds,
    rules: validateRules(value.rules, [...sources, ...removedSourceIds.map(id => ({ id }))]) };
}
