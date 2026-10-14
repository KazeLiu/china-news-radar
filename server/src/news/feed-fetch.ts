import axios from 'axios';
import { NewsSourceConfig } from './sources';
import { requestFeed, type inspectFeed, type FeedSample, type CollectedItem } from './collector';
import { feedSource, feedUrlsFor } from './transports';
import { retryAfterMs } from './rules';
import { SourceFetchError } from './public-network';

export interface FeedAttempt { url: string; status: number | null; error: string | null; skipped?: boolean }
export type FeedFailures = Record<string, { retryAt: string; error: string; status: number | null }>;
export type FeedValidators = Record<string, { etag: string | null; lastModified: string | null }>;
export interface FeedCache { activeFeedUrl: string | null; etag: string | null; lastModified: string | null; feedFailures?: string; feedValidators?: string }
export function restoreValidators(cache?: FeedCache): FeedValidators {
  let validators: FeedValidators;
  try {
    validators = JSON.parse(cache?.feedValidators ?? '{}');
    if (!validators || typeof validators !== 'object' || Array.isArray(validators) || Object.values(validators).some(value =>
      !value || (value.etag !== null && typeof value.etag !== 'string') || (value.lastModified !== null && typeof value.lastModified !== 'string'))) throw new Error();
  } catch { throw new Error('已保存的 RSS 条件请求状态无效，请检查数据库；状态未重置'); }
  if (cache?.activeFeedUrl && !Object.hasOwn(validators, cache.activeFeedUrl)) validators[cache.activeFeedUrl] = { etag: cache.etag ?? null, lastModified: cache.lastModified ?? null };
  return validators;
}
export function restoreFailures(raw?: string): FeedFailures {
  if (raw === undefined) return {};
  try {
    const failures: FeedFailures = JSON.parse(raw);
    if (!failures || typeof failures !== 'object' || Array.isArray(failures) || Object.values(failures).some(failure =>
      !failure || typeof failure.retryAt !== 'string' || !Number.isFinite(Date.parse(failure.retryAt)) || typeof failure.error !== 'string'
      || (failure.status !== null && (!Number.isInteger(failure.status) || failure.status < 100 || failure.status > 599)))) throw new Error();
    return failures;
  } catch { throw new Error('已保存的 RSS 重试状态无效，请检查数据库；退避记录未重置'); }
}
export class FeedFetchError extends Error {
  constructor(public attempts: FeedAttempt[], public failures: FeedFailures) { super(attempts.map(a => a.error).join('；')); }
}

let activeRequests = 0;
const waiting: Array<() => void> = [];
async function withFeedSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeRequests >= 4) await new Promise<void>(resolve => waiting.push(resolve));
  else activeRequests++;
  try { return await run(); }
  finally { const next = waiting.shift(); if (next) next(); else activeRequests--; }
}
export async function fetchSourceFeed<T>(source: NewsSourceConfig, parse: (xml: string, selected: NewsSourceConfig) => Promise<T>, cache?: FeedCache) {
  const urls = feedUrlsFor(source);
  const attempts: FeedAttempt[] = new Array(urls.length);
  const failures = restoreFailures(cache?.feedFailures);
  const validators = restoreValidators(cache);
  const results = await Promise.all(urls.map((url, index) => withFeedSlot(async () => {
    if (failures[url] && Date.parse(failures[url].retryAt) > Date.now()) {
      attempts[index] = { url, status: failures[url].status, error: `${failures[url].error}，等待重试`, skipped: true };
      return null;
    }
    const selected = feedSource(source, url);
    let stage: 'request' | 'parse' = 'request';
    try {
      const previous = validators[url];
      const response = await requestFeed(selected, previous?.etag ?? null, previous?.lastModified ?? null);
      if (response.status === 304 && !previous) throw new SourceFetchError('unexpected-not-modified', '地址没有条件请求记录，却返回 HTTP 304', 304);
      stage = 'parse';
      const parsed = response.status === 304 ? null : await parse(response.data, selected);
      validators[url] = { etag: response.headers.etag ?? (response.status === 304 ? previous.etag : null), lastModified: response.headers['last-modified'] ?? (response.status === 304 ? previous.lastModified : null) };
      attempts[index] = { url, status: response.status, error: null };
      delete failures[url];
      return { selected, response, parsed };
    } catch (error) {
      const status = error instanceof SourceFetchError ? error.status ?? null : axios.isAxiosError(error) ? error.response?.status ?? null : null;
      const message = error instanceof SourceFetchError ? error.message : status ? `HTTP ${status}` : stage === 'parse' ? 'RSS 格式无法解析' : '连接失败或请求超时';
      const delay = status === 429 ? retryAfterMs(error instanceof SourceFetchError ? error.retryAfter : axios.isAxiosError(error) ? error.response?.headers['retry-after'] : undefined) : 300_000;
      failures[url] = { retryAt: new Date(Date.now() + delay).toISOString(), status, error: message };
      attempts[index] = { url, status, error: message };
      return null;
    }
  })));
  const feeds = results.filter(result => result !== null);
  if (!feeds.length) throw new FeedFetchError(attempts, failures);
  return { feeds, attempts, failures, validators };
}
export function mergeFeeds(feeds: Array<Awaited<ReturnType<typeof inspectFeed>>>) {
  const allItems = feeds.flatMap(feed => feed.items);
  const unique = new Map<string, CollectedItem>();
  for (const item of allItems) if (!unique.has(item.url)) unique.set(item.url, item);
  const samples = new Map<string, FeedSample>();
  for (const feed of feeds) for (const sample of feed.samples) {
    const key = sample.url || `invalid-${samples.size}`;
    if (!samples.has(key) || (!samples.get(key)!.accepted && sample.accepted)) samples.set(key, sample);
  }
  const checkedCount = feeds.reduce((count, feed) => count + feed.checkedCount, 0);
  return { title: feeds[0]?.title || '', rawCount: feeds.reduce((count, feed) => count + feed.rawCount, 0), checkedCount, items: [...unique.values()], samples: [...samples.values()],
    duplicates: allItems.length - unique.size, filtered: checkedCount - allItems.length };
}
