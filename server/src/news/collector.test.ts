import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { inspectFeed, parseFeed, requestFeed } from './collector';
import { NEWS_SOURCES } from './sources';
const reuters = NEWS_SOURCES.find(s => s.id === 'reuters')!;
const guardian = NEWS_SOURCES.find(s => s.id === 'guardian')!;
const now = new Date('2026-10-10T12:00:00Z');
function feed(link: string, publisher: string) { return `<rss version="2.0"><channel><title>News</title><item><title>China announces trade measures</title><link>${link}</link><description>China trade policy</description><pubDate>Sat, 10 Oct 2026 10:00:00 GMT</pubDate><source url="${publisher}">Reuters</source></item></channel></rss>`; }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('RSS parsing and attribution', () => {
  it('excludes the AP Beijing hub indexed by Google even in AI candidate mode', async () => {
    const ap = NEWS_SOURCES.find(s => s.id === 'ap')!;
    const xml = feed('https://news.google.com/rss/articles/opaque-hub-id', 'https://apnews.com')
      .replace('China announces trade measures', 'Beijing - AP News').replace('China trade policy', 'Beijing AP News');
    for (const filterByRules of [true, false]) expect(await parseFeed(xml, ap, now, filterByRules)).toEqual([]);
    const article = xml.replace('Beijing - AP News', 'Beijing announces trade measures - AP News').replace('Beijing AP News', 'Beijing announces trade measures AP News');
    expect(await parseFeed(article, ap, now, false)).toHaveLength(1);
  });
  it('rejects media collection URLs from direct RSS and RSSHub without rejecting actual articles', async () => {
    const ap = { ...NEWS_SOURCES.find(s => s.id === 'ap')!, kind: 'rsshub' as const };
    expect(await parseFeed(feed('https://apnews.com/hub/beijing', 'https://apnews.com'), ap, now, false)).toEqual([]);
    expect(await parseFeed(feed('https://apnews.com/article/beijing-trade-policy', 'https://apnews.com'), ap, now, false)).toHaveLength(1);
    expect(await parseFeed(feed('https://www.theguardian.com/world/china', 'https://theguardian.com'), guardian, now, false)).toEqual([]);
    expect(await parseFeed(feed('https://www.theguardian.com/world/2026/oct/10/china-trade-policy', 'https://theguardian.com'), guardian, now, false)).toHaveLength(1);
  });
  it('also rejects the AP homepage when it appears in a Google News search feed', async () => {
    const ap = NEWS_SOURCES.find(s => s.id === 'ap')!;
    const xml = feed('https://news.google.com/rss/articles/home', 'https://apnews.com').replace('China announces trade measures', 'Associated Press News: Breaking News | Latest News Today - AP News');
    expect(await parseFeed(xml, ap, now, false)).toEqual([]);
    expect(await parseFeed(feed('https://apnews.com/', 'https://apnews.com'), { ...ap, kind: 'rss' }, now, false)).toEqual([]);
  });
  it('preserves a Google index link without inventing the publisher article URL', async () => {
    const [item] = await parseFeed(feed('https://news.google.com/rss/articles/abc', 'https://www.reuters.com'), reuters, now);
    expect(item.originalPublisher).toBe('Reuters'); expect(item.originalUrl).toBeNull(); expect(item.publishedAt?.toISOString()).toBe('2026-10-10T10:00:00.000Z');
  });
  it('rejects wrong or spoofed publisher metadata', async () => {
    expect(await parseFeed(feed('https://news.google.com/rss/articles/abc', 'https://reuters.com.evil.test'), reuters, now)).toEqual([]);
    expect(await parseFeed(feed('https://attacker.test/abc', 'https://reuters.com'), reuters, now)).toEqual([]);
  });
  it('accepts only actual publisher URLs from direct RSS', async () => {
    expect((await parseFeed(feed('https://www.theguardian.com/world/story', 'https://reuters.com'), guardian, now))[0].originalUrl).toContain('theguardian.com');
    expect(await parseFeed(feed('https://attacker.test/story', 'https://reuters.com'), guardian, now)).toEqual([]);
  });
  it('fails visibly for malformed XML', async () => { await expect(parseFeed('<rss><oops>', guardian)).rejects.toThrow(); });
  it('normalizes Atom links, summary, publication time and RSS namespaced content', async () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>World</title><entry><title>China trade policy</title><link rel="alternate" href="https://www.theguardian.com/world/atom-story"/><summary>China announces new trade measures</summary><published>2026-10-10T10:00:00Z</published><updated>2026-10-10T11:00:00Z</updated></entry></feed>`;
    const [item] = await parseFeed(atom, guardian, now);
    expect(item.title).toBe('China trade policy'); expect(item.summary).toContain('trade measures'); expect(item.url).toContain('atom-story'); expect(item.publishedAt).not.toBeNull();
    const rss = feed('https://www.theguardian.com/world/rss-story', 'https://theguardian.com').replace('<rss version="2.0">', '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">').replace('<description>China trade policy</description>', '<content:encoded><![CDATA[<p>China trade policy</p>]]></content:encoded><dc:creator>News Reporter</dc:creator>');
    expect((await parseFeed(rss, guardian, now))[0]).toMatchObject({ summary: 'China trade policy', author: 'News Reporter' });
  });
  it('shows parsed samples and rejection reasons even when all articles are excluded', async () => {
    const xml = feed('https://apnews.com/hub/beijing', 'https://apnews.com');
    const result = await inspectFeed(xml, { ...NEWS_SOURCES.find(s => s.id === 'ap')!, kind: 'rss' }, now, false);
    expect(result.rawCount).toBe(1); expect(result.items).toEqual([]); expect(result.samples[0].reason).toContain('排除规则');
  });
  it('keeps non-keyword candidates for AI while still checking publisher identity', async () => {
    const xml = feed('https://www.theguardian.com/world/story', 'https://reuters.com').replaceAll('China announces trade measures', 'Officials weigh emergency curbs').replaceAll('China trade policy', 'The cabinet is considering restrictions');
    expect(await parseFeed(xml, guardian, now)).toEqual([]);
    expect((await parseFeed(xml, guardian, now, false)).length).toBe(1);
    expect(await parseFeed(xml.replace('https://www.theguardian.com/world/story', 'https://attacker.test/story'), guardian, now, false)).toEqual([]);
  });
});
describe('RSS network limits', () => {
  it('does not route internal RSSHub requests through the external proxy', async () => {
    vi.stubEnv('RSSHUB_BASE_URL', 'http://127.0.0.1:3412');
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7897');
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: '', headers: {} });
    await requestFeed({ ...reuters, kind: 'rsshub', feedUrl: 'http://127.0.0.1:3412/feeds/reuters' });
    expect(get.mock.calls[0][1]?.proxy).toBe(false); expect(get.mock.calls[0][1]?.httpsAgent).toBeUndefined();
  });
  it('uses an HTTPS-compatible tunnel for an HTTP proxy, retaining conditional headers', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7897');
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ status: 304, data: '', headers: {} });
    await requestFeed(reuters, 'etag-1', 'yesterday');
    const options = get.mock.calls[0][1]!;
    expect(options.proxy).toBe(false);
    expect(options.httpsAgent.constructor.name).toBe('HttpsProxyAgent');
    expect(options.httpsAgent.proxy.href).toBe('http://127.0.0.1:7897/');
    expect(options.headers?.['If-None-Match']).toBe('etag-1');
    expect(options.timeout).toBe(15_000);
  });
});
