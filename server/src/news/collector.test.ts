import { afterEach, describe, expect, it, vi } from 'vitest';
import * as network from './public-network';
import { inspectFeed, parseFeed, requestFeed } from './collector';
import { NEWS_SOURCES } from './sources';
import { defaultWeb, validateSource } from './admin-config';
import { clippedPageFragment, extractPage } from './web-parser';
import { WebCrawlerService } from './web-crawler.service';
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
    const get = vi.spyOn(network, 'requestPublic').mockResolvedValue({ status: 200, body: Buffer.from(''), headers: {}, url: 'http://127.0.0.1:3412/feeds/reuters' });
    await requestFeed({ ...reuters, kind: 'rsshub', feedUrl: 'http://127.0.0.1:3412/feeds/reuters' });
    expect(get.mock.calls[0][1]?.allowRsshub).toBe(true); expect(get.mock.calls[0][1]?.agent).toBeUndefined();
  });
  it('uses an HTTPS-compatible tunnel for an HTTP proxy, retaining conditional headers', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7897');
    const get = vi.spyOn(network, 'requestPublic').mockResolvedValue({ status: 304, body: Buffer.from(''), headers: {}, url: reuters.feedUrl! });
    await requestFeed(reuters, 'etag-1', 'yesterday');
    const options = get.mock.calls[0][1]!;
    expect(options.agent?.constructor.name).toBe('HttpsProxyAgent');
    expect((options.agent as { proxy: URL }).proxy.href).toBe('http://127.0.0.1:7897/');
    expect(options.headers?.['If-None-Match']).toBe('etag-1');
    expect(options.allowRsshub).toBe(true);
  });
});
describe('web extraction', () => {
  it('extracts metadata images and rejects invalid structures without invoking AI', () => {
    const html = '<script type="application/ld+json">' + JSON.stringify({ '@type': 'NewsArticle', headline: 'China trade policy', url: 'https://crawler.example/article', image: ['https://crawler.example/one.jpg', { url: 'https://crawler.example/two.jpg' }, null], articleBody: 'Original body' }) + '</script>';
    const result = extractPage(html, 'https://crawler.example/article', defaultWeb().rules, 50);
    expect(result.records[0]).toMatchObject({ title: 'China trade policy', body: 'Original body', images: ['https://crawler.example/one.jpg', 'https://crawler.example/two.jpg'] });
    expect(() => extractPage('<html><body>Site menu</body></html>', 'https://crawler.example/', defaultWeb().rules, 50)).toThrow('解析结构');
  });
  it('clips scripts, forms and URL parameters before parser assistance', () => {
    const fragment = clippedPageFragment('<script>private-script</script><form><input value="private-input"></form><article><a href="https://crawler.example/news?token=private-query">China trade policy</a><p>' + '正文'.repeat(10000) + '</p></article>');
    expect(fragment.length).toBeLessThanOrEqual(12000);
    for (const value of ['private-script', 'private-input', 'private-query']) expect(fragment).not.toContain(value);
  });
  it.each(['http://127.0.0.1:9/private', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/'])('rejects non-public target %s', async target => {
    await expect(network.requestPublic(target)).rejects.toMatchObject({ code: 'blocked-target' });
  });
  it.skipIf(process.env.TEST_WEB_BROWSER !== 'true')('loads an isolated Chromium page and extracts CSS rules', async () => {
    const target = 'https://crawler.example/news';
    vi.spyOn(network, 'resolvePublicTarget').mockResolvedValue({ url: new URL(target), address: '93.184.216.34' });
    vi.spyOn(network, 'requestPublic').mockImplementation(async url => ({ status: 200, url, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html><body><article></article><script>setTimeout(() => { document.querySelector("article").innerHTML = \'<h2>China trade policy</h2><a href="/article">Read</a><p>China export rules</p>\'; }, 100);</script></body></html>') }));
    const crawler = new WebCrawlerService({ registerWeb() {} } as never);
    const rules = { ...defaultWeb().rules, mode: 'css', item: 'article', title: 'h2', link: 'a', summary: 'p' };
    const source = validateSource({ name: 'Browser fixture', kind: 'web', target, pollSeconds: 60, publisherHosts: ['crawler.example'], web: { rules, maxPages: 1 } });
    try {
      const result = await crawler.collect(source, []);
      expect(result.items).toHaveLength(1); expect(result.items[0]).toMatchObject({ title: 'China trade policy', url: 'https://crawler.example/article', summary: 'China export rules' });
      expect(result.structure).toMatchObject({ matched: 1, counts: { title: 1, url: 1 } });
    } finally { await crawler.onModuleDestroy(); }
  });
});
