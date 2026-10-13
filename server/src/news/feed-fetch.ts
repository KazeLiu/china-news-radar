import axios from 'axios';
import { NewsSourceConfig } from './sources';
import { requestFeed } from './collector';
import { feedSource, feedUrlsFor } from './transports';
import { retryAfterMs } from './rules';

export interface FeedAttempt { url: string; status: number | null; error: string | null; skipped?: boolean }
export type FeedFailures = Record<string, { retryAt: string; error: string; status: number | null }>;
export function restoreFailures(raw?: string): FeedFailures {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
export class FeedFetchError extends Error {
  constructor(public attempts: FeedAttempt[], public problem: unknown, public failures: FeedFailures) { super(attempts.map(a => a.error).join('；')); }
}
export async function fetchSourceFeed<T>(source: NewsSourceConfig, parse: (xml: string, selected: NewsSourceConfig) => Promise<T>, cache?: { activeFeedUrl: string | null; etag: string | null; lastModified: string | null; feedFailures?: string }) {
  const attempts: FeedAttempt[] = [];
  const failures = restoreFailures(cache?.feedFailures);
  let problem: unknown;
  for (const url of feedUrlsFor(source)) {
    if (failures[url] && Date.parse(failures[url].retryAt) > Date.now()) {
      attempts.push({ url, status: failures[url].status, error: `${failures[url].error}，等待重试`, skipped: true });
      continue;
    }
    const selected = feedSource(source, url);
    let stage: 'request' | 'parse' = 'request';
    try {
      const sameFeed = cache?.activeFeedUrl === url;
      const response = await requestFeed(selected, sameFeed ? cache.etag : null, sameFeed ? cache.lastModified : null);
      if (response.status === 304 && !sameFeed) throw new Error('Unexpected 304 without matching cache');
      stage = 'parse';
      const parsed = response.status === 304 ? null : await parse(response.data, selected);
      attempts.push({ url, status: response.status, error: null });
      delete failures[url];
      return { selected, response, parsed, attempts, failures };
    } catch (error) {
      problem = error;
      const status = axios.isAxiosError(error) ? error.response?.status ?? null : null;
      const message = status ? `HTTP ${status}` : stage === 'parse' ? 'RSS 格式无法解析' : '连接失败或请求超时';
      const delay = status === 429 && axios.isAxiosError(error) ? retryAfterMs(error.response?.headers['retry-after']) : 300_000;
      failures[url] = { retryAt: new Date(Date.now() + delay).toISOString(), status, error: message };
      attempts.push({ url, status, error: message });
    }
  }
  throw new FeedFetchError(attempts, problem, failures);
}
