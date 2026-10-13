import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEWS_SOURCES } from './sources';
import { feedSource, feedUrlsFor, isLocalFeed } from './transports';
afterEach(() => vi.unstubAllEnvs());
describe('RSS address configuration', () => {
  it('does not inject built-in RSSHub routes or change configured address order', () => {
    for (const source of NEWS_SOURCES) expect(source).not.toHaveProperty('rsshubRoute');
    const source = NEWS_SOURCES[0];
    expect(feedUrlsFor({ ...source, feedUrls: ['https://example.org/a', 'https://example.org/b'] })).toEqual(['https://example.org/a', 'https://example.org/b']);
    expect(feedUrlsFor({ ...source, feedUrls: undefined })).toEqual([source.feedUrl]);
  });
  it('only permits the configured local adapter feed paths', () => {
    vi.stubEnv('RSSHUB_BASE_URL', 'http://127.0.0.1:3412');
    expect(isLocalFeed('http://127.0.0.1:3412/feeds/ap')).toBe(true);
    for (const url of ['http://127.0.0.1:3412/private', 'http://127.0.0.1:9999/feeds/ap', 'http://127.0.0.1:3412/feeds/ap?url=private', 'http://user:secret@127.0.0.1:3412/feeds/ap']) expect(isLocalFeed(url)).toBe(false);
    vi.stubEnv('RSSHUB_BASE_URL', 'http://user:secret@localhost'); expect(isLocalFeed('http://localhost/feeds/ap')).toBe(false);
  });
  it('identifies Google indexes and direct media links for each selected address', () => {
    expect(feedSource(NEWS_SOURCES[0], 'https://news.google.com/rss/search?q=China').kind).toBe('google-rss');
    expect(feedSource(NEWS_SOURCES[0], 'https://foreign.example.org/rss').kind).toBe('rss');
  });
});
