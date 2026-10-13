import { NewsSourceConfig } from './sources';

export function feedUrlsFor(source: NewsSourceConfig): string[] {
  return source.feedUrls ?? (source.feedUrl ? [source.feedUrl] : []);
}
// The local adapter is allowed only at its configured origin and feed paths.
export function isLocalFeed(raw: string): boolean {
  try {
    if (!process.env.RSSHUB_BASE_URL) return false;
    const base = new URL(process.env.RSSHUB_BASE_URL);
    const url = new URL(raw);
    const prefix = `${base.pathname.replace(/\/$/, '')}/feeds/`;
    return ['http:', 'https:'].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash
      && url.origin === base.origin && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.startsWith(prefix) && /^[a-z][a-z0-9-]*$/.test(url.pathname.slice(prefix.length));
  } catch { return false; }
}
export function feedSource(source: NewsSourceConfig, feedUrl: string): NewsSourceConfig {
  return { ...source, feedUrl, kind: new URL(feedUrl).hostname === 'news.google.com' ? 'google-rss' : 'rss' };
}
export function distributionFor(kind: string) {
  return kind === 'google-rss' ? 'Google News RSS 索引' : kind === 'rss' ? 'RSS 订阅' : kind === 'telegram' ? 'Telegram 频道' : '待接入';
}
