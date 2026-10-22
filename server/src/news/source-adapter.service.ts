import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TwitterApiError, TwitterService } from '../services/twitter.service';
import { SearchService } from '../services/search.service';
import { CollectedItem, matchesHost } from './collector';
import { NewsSourceConfig } from './sources';
import { canonicalUrl, eventKey, isDomesticUrl, plainText, publisherForUrl, topicFor, withinNewsWindow } from './rules';
import { FilterRule, matchingExclusions } from './content-filter';
import { requestPublic, SourceFetchError } from './public-network';
import { feedUrlsFor } from './transports';
import { sourcePublishedAt, webPublicationTime } from './source-date';
import { collectXAccount } from './x-official';

export interface ScrapedRecord { title?: unknown; sourceTitlePresent?: boolean; summary?: unknown; url?: unknown; publishedAt?: unknown; author?: unknown; images?: unknown; body?: unknown }
export interface CollectionResult { items: CollectedItem[]; rawCount: number; checkedCount: number; samples: Array<ScrapedRecord & { title: string; summary: string; url: string | null; publishedAt: Date | null; publishedAtEstimated?: boolean; accepted: boolean; reason: string | null; originalPublisher: string | null }>; structure: Record<string, unknown>; status: number; pageFragment?: string }
export function inspectRecords(records: ScrapedRecord[], source: NewsSourceConfig, rules: FilterRule[], structure: Record<string, unknown> = {}, baseUrl = source.target, now = new Date()) {
  const items: CollectedItem[] = [];
  const publisherHosts = source.kind === 'api' && ['x-official', 'twitter'].includes(source.adapter || '') ? [...source.publisherHosts, 'x.com', 'twitter.com'] : source.publisherHosts;
  const samples = records.slice(0, source.kind === 'web' ? source.web!.maxItems : 150).map(record => {
    const sourceTitle = plainText(typeof record.title === 'string' ? record.title : '').slice(0, 600);
    const body = typeof record.body === 'string' ? record.body.slice(0, 200000) : '';
    const sourceTitlePresent = record.sourceTitlePresent !== false && !!sourceTitle;
    const title = sourceTitle || plainText(body).slice(0, 220);
    const summary = plainText(typeof record.summary === 'string' ? record.summary : '').slice(0, 1600);
    let url: string | null = null;
    if (typeof record.url === 'string' && record.url.trim() && record.url.length <= 2000) { try { url = canonicalUrl(new URL(record.url, baseUrl).href); } catch { url = null; } }
    const publication = source.kind === 'web' ? webPublicationTime(record.publishedAt, source.timeZone, now) : { publishedAt: sourcePublishedAt(record.publishedAt, source.timeZone, now), estimated: false };
    const { publishedAt } = publication;
    const originalPublisher = url ? publisherForUrl(url) || (matchesHost(url, publisherHosts) ? new URL(url).hostname : null) : null;
    const matched = matchingExclusions({ title, summary, url: url || '' }, rules, source.id);
    const reason = !title ? '缺少标题及正文' : !url ? '缺少有效原文链接' : isDomesticUrl(url) ? '本轮不接入国内平台' : !withinNewsWindow(publishedAt, now) ? '发布时间超过最近七天' : matched.length ? '命中排除规则' : null;
    const media = (Array.isArray(record.images) ? record.images : record.images ? [record.images] : []).slice(0, 20).flatMap(value => {
      const raw = typeof value === 'string' ? value : value && typeof value.url === 'string' ? value.url : '';
      if (!raw || raw.length > 2000) return [];
      try { const image = canonicalUrl(new URL(raw, baseUrl || url || undefined).href); return image ? [image] : []; } catch { return []; }
    });
    if (!reason && url) items.push({ title, sourceTitlePresent, summary, url, originalUrl: url, originalPublisher, publishedAt, publishedAtEstimated: publication.estimated,
      author: typeof record.author === 'string' ? plainText(record.author).slice(0, 120) : null,
      body, images: JSON.stringify([...new Set(media)]),
      topic: topicFor(`${title} ${summary}`), eventKey: eventKey(title), contentHash: createHash('sha256').update(JSON.stringify([title, summary, publishedAt])).digest('hex') });
    return { title, sourceTitlePresent, summary, url, publishedAt, publishedAtEstimated: publication.estimated, images: media, originalPublisher, body,
      author: typeof record.author === 'string' ? plainText(record.author).slice(0, 120) : null, accepted: !reason, reason };
  });
  return { items, samples, rawCount: records.length, checkedCount: samples.length, structure, status: 200 } satisfies CollectionResult;
}
function atPath(value: unknown, path: string): unknown {
  if (!path) return value;
  for (const key of path.split('.')) { if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined; value = (value as Record<string, unknown>)[key]; }
  return value;
}
@Injectable()
export class SourceAdapterService {
  private webCollector?: (source: NewsSourceConfig, rules: FilterRule[]) => Promise<CollectionResult>;
  constructor(private readonly twitter: TwitterService, private readonly search: SearchService) {}
  registerWeb(collect: NonNullable<SourceAdapterService['webCollector']>) { this.webCollector = collect; }
  configured(source: NewsSourceConfig) {
    if (source.kind === 'telegram') return process.env.TELEGRAM_ENABLED === 'true' && !!source.channel;
    if (source.kind === 'web') return !!source.target && !!this.webCollector;
    if (source.kind === 'api') return !!source.target && !['bilibili', 'sogou'].includes(source.adapter || '') && (!['twitter', 'x-official'].includes(source.adapter || '') || !!source.api?.auth.value);
    return !!feedUrlsFor(source).length;
  }
  async collect(source: NewsSourceConfig, rules: FilterRule[]): Promise<CollectionResult> {
    if (source.kind === 'web') { if (!this.webCollector) throw new SourceFetchError('not-configured', '网页采集尚未接入'); return this.webCollector(source, rules); }
    if (source.kind === 'telegram') return { ...inspectRecords([], source, rules), structure: { receiver: 'Telegram', channel: source.channel, enabled: process.env.TELEGRAM_ENABLED === 'true' } };
    if (source.adapter === 'bilibili' || source.adapter === 'sogou') throw new SourceFetchError('platform-disabled', '此国内平台实现已保留，本轮不启用');
    if (source.adapter === 'x-official') {
      const result = await collectXAccount(source.target!, source.api?.auth.value || '', source.useProxy);
      return inspectRecords(result.records, source, rules, result.structure, `https://x.com/${source.target}`);
    }
    if (source.adapter && source.adapter !== 'generic') {
      if (source.adapter === 'twitter' && (!source.api?.auth.value || source.api.auth.value === 'placeholder' || source.api.auth.value.startsWith('your_'))) throw new SourceFetchError('missing-auth', '请填写 TwitterAPI.io 的 API Key；X 官方 Bearer Token 应选择“X 官方 API · 账号动态”');
      const query = source.target!;
      const results = source.adapter === 'twitter'
        ? await this.twitter.searchTwitter(query, { apiKey: source.api?.auth.value, strict: true, network: { useProxy: source.useProxy } }).catch(error => {
          if (error instanceof SourceFetchError) throw error;
          const status = error instanceof TwitterApiError ? error.status : undefined;
          throw new SourceFetchError('twitterapi-error', `TwitterAPI.io ${status ? `返回 HTTP ${status}` : '连接或解析失败'}；此入口需要 TwitterAPI.io API Key，官方 Token 请改选“X 官方 API · 账号动态”`, status);
        })
        : source.adapter === 'bing' ? await this.search.searchBing(query, true, { useProxy: source.useProxy }) : await this.search.searchHackerNews(query, true, { useProxy: source.useProxy });
      return inspectRecords(results.map(item => ({ title: item.title, ...(source.adapter === 'twitter' ? { sourceTitlePresent: false, body: item.content } : {}), summary: item.content, url: item.url, publishedAt: item.publishedAt, author: item.author?.name, images: item.media?.filter(m => m.type === 'photo').map(m => m.url) })), source, rules, { adapter: source.adapter, count: results.length });
    }
    const config = source.api!;
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (config.auth.type !== 'none') headers[config.auth.type === 'bearer' ? 'Authorization' : config.auth.header] = config.auth.type === 'bearer' ? `Bearer ${config.auth.value}` : config.auth.value;
    const response = await requestPublic(source.target!, { method: config.method, headers, body: config.method === 'POST' ? config.body : undefined, useProxy: source.useProxy });
    if (response.status < 200 || response.status >= 300) throw new SourceFetchError(response.status === 401 || response.status === 403 ? 'access-denied' : 'http-error', `来源返回 HTTP ${response.status}`, response.status);
    let json: unknown;
    try { json = JSON.parse(response.body.toString('utf8')); } catch { throw new SourceFetchError('invalid-structure', 'API 未返回有效 JSON'); }
    const list = atPath(json, config.mapping.items);
    if (!Array.isArray(list)) throw new SourceFetchError('invalid-structure', '列表字段不是数组，请核对字段映射');
    const records = list.slice(0, 150).map(value => Object.fromEntries(Object.entries(config.mapping).filter(([key]) => key !== 'items').map(([key, path]) => [key, path ? atPath(value, path) : undefined])) as ScrapedRecord);
    return inspectRecords(records, source, rules, { rootType: Array.isArray(json) ? 'array' : 'object', keys: json && typeof json === 'object' ? Object.keys(json).slice(0, 40) : [], mapping: config.mapping, listCount: list.length }, response.url);
  }
}
