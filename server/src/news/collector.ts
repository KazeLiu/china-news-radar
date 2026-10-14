import Parser from 'rss-parser';
import { createHash } from 'node:crypto';
import { canonicalUrl, eventKey, plainText, shouldDisplay, topicFor, withinNewsWindow } from './rules';
import { NewsSourceConfig } from './sources';
import { DEFAULT_EXCLUSIONS, FilterRule, matchingExclusions } from './content-filter';
import { load } from 'cheerio';
import { sourcePublishedAt } from './source-date';
import { requestPublic, sourceProxyAgent, SourceFetchError } from './public-network';

export interface CollectedItem {
  title: string; summary: string; url: string; originalPublisher: string | null;
  originalUrl: string | null; author: string | null; topic: string; eventKey: string;
  contentHash: string; publishedAt: Date | null;
  body?: string; images?: string;
}
// rss-parser flattens XML nodes containing `_`; keeping the array preserves source attributes.
interface ParsedFields { publisher?: { $?: { url?: string } }[]; 'content:encoded'?: string; 'content:encodedSnippet'?: string; author?: string; 'media:content'?: { $?: { url?: string; medium?: string; type?: string } }[]; 'media:thumbnail'?: { $?: { url?: string } }[] }
const parser = new Parser<Record<string, never>, ParsedFields>({ customFields: { item: [['source', 'publisher', { keepArray: true }], ['media:content', 'media:content', { keepArray: true }], ['media:thumbnail', 'media:thumbnail', { keepArray: true }]] } });
export function matchesHost(raw: string, hosts: string[]) {
  try { const host = new URL(raw).hostname.toLowerCase(); return hosts.some(h => host === h || host.endsWith(`.${h}`)); }
  catch { return false; }
}
export interface FeedSample { title: string; summary: string; url: string | null; publishedAt: Date | null; accepted: boolean; reason: string | null; images?: string[]; originalPublisher?: string | null }
export async function inspectFeed(xml: string, source: NewsSourceConfig, now = new Date(), filterByRules = true, exclusions: FilterRule[] = DEFAULT_EXCLUSIONS) {
  const feed = await parser.parseString(xml);
  const samples: FeedSample[] = [];
  const items = feed.items.slice(0, 150).flatMap(item => {
    const title = plainText(item.title || '').slice(0, 600);
    const summary = plainText(item.contentSnippet || item.summary || item['content:encodedSnippet'] || item.content || item['content:encoded'] || '').slice(0, 1600);
    const url = canonicalUrl(item.link || '');
    const publishedAt = sourcePublishedAt(item.pubDate || item.isoDate, source.timeZone, now);
    const publisher = item.publisher?.[0];
    const matched = matchingExclusions({ title, summary, url: url || '' }, exclusions, source.id);
    const reason = !title ? '缺少标题' : !url ? '缺少有效的 HTTP(S) 文章链接'
      : !withinNewsWindow(publishedAt, now) ? '发布时间超过最近 7 天'
      : source.kind === 'google-rss' && (!publisher?.$?.url || !matchesHost(publisher.$.url, source.publisherHosts) || !matchesHost(url, ['news.google.com'])) ? 'Google 索引的发布者域名不匹配'
      : source.kind !== 'google-rss' && !matchesHost(url, source.publisherHosts) ? '文章链接不属于允许的原文域名'
      : matched.length ? `命中排除规则：${matched.map(rule => rule.value).join('；')}`
      : filterByRules && !shouldDisplay(title, summary, url) ? '未通过涉华快讯关键词筛选' : null;
    const html = item['content:encoded'] || item.content || '';
    const $ = load(html);
    const media = [...(item['media:content'] || []).filter(m => m.$?.medium === 'image' || m.$?.type?.startsWith('image/')).map(m => m.$?.url), ...(item['media:thumbnail'] || []).map(m => m.$?.url),
      ...(item.enclosure?.type?.startsWith('image/') ? [item.enclosure.url] : []), ...$('img').map((_, node) => $(node).attr('src')).get()];
    const images = [...new Set(media.flatMap(raw => { if (!raw || raw.length > 2000) return []; try { const value = canonicalUrl(new URL(raw, source.website || source.feedUrl).href); return value ? [value] : []; } catch { return []; } }))].slice(0, 20);
    samples.push({ title, summary, url, publishedAt, accepted: !reason, reason, images, originalPublisher: !reason ? source.englishName : null });
    if (reason || !url) return [];
    return [{ title, summary, url, publishedAt, originalPublisher: source.englishName,
      originalUrl: source.kind === 'google-rss' ? null : url,
      author: item.creator || item.author ? plainText(item.creator || item.author || '').slice(0, 120) : null,
      topic: topicFor(`${title} ${summary}`), eventKey: eventKey(title), body: plainText(html).slice(0, 200000), images: JSON.stringify(images),
      contentHash: createHash('sha256').update(JSON.stringify([title, summary, publishedAt])).digest('hex') }];
  });
  return { title: plainText(feed.title || ''), rawCount: feed.items.length, checkedCount: samples.length, items, samples };
}
export async function parseFeed(xml: string, source: NewsSourceConfig, now = new Date(), filterByRules = true, exclusions: FilterRule[] = DEFAULT_EXCLUSIONS): Promise<CollectedItem[]> {
  return (await inspectFeed(xml, source, now, filterByRules, exclusions)).items;
}
export async function requestFeed(source: NewsSourceConfig, etag?: string | null, lastModified?: string | null) {
  const response = await requestPublic(source.feedUrl!, {
    agent: sourceProxyAgent(source.feedUrl!, true), allowRsshub: true,
    headers: { 'User-Agent': 'ChinaNewsRadar/1.0 (personal RSS reader)', Accept: 'application/rss+xml, application/xml, text/xml',
      ...(etag ? { 'If-None-Match': etag } : {}), ...(lastModified ? { 'If-Modified-Since': lastModified } : {}) },
  });
  if (![200, 304].includes(response.status)) throw new SourceFetchError('http-error', `RSS 返回 HTTP ${response.status}`, response.status, response.headers['retry-after']);
  return { status: response.status, data: response.body.toString('utf8'), headers: Object.fromEntries(Object.entries(response.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) };
}
