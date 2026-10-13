import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import { NewsService } from './news.service';
import { PrismaService } from '../prisma/prisma.service';
import { NEWS_SOURCES } from './sources';
import { requestFeed, parseFeed, inspectFeed } from './collector';
import { analysisKey } from './analysis';

vi.mock('./collector', () => ({ requestFeed: vi.fn(), parseFeed: vi.fn(), inspectFeed: vi.fn() }));
const source = NEWS_SOURCES.find(s => s.id === 'reuters')!;
const item = { title: 'China trade policy', summary: 'New export measures', url: 'https://news.google.com/rss/articles/id', originalPublisher: 'Reuters', originalUrl: null, author: null, topic: 'economy', eventKey: 'hash', contentHash: 'v1', publishedAt: new Date() };
function database() {
  return { newsSource: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: source.id, enabled: true }), update: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
    newsItem: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn(), update: vi.fn() }, setting: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    newsAnalysis: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ status: 'pending' }) } };
}
let db: ReturnType<typeof database>; let service: NewsService;
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('AI_ANALYSIS_ENABLED', 'false'); vi.stubEnv('AI_TRANSLATION_ENABLED', 'false'); vi.stubEnv('TELEGRAM_ENABLED', 'false'); db = database(); service = new NewsService(db as unknown as PrismaService); });
afterEach(() => vi.unstubAllEnvs());
describe('independent collector', () => {
  it('does not queue or create a Google-indexed media collection page for AI', async () => {
    vi.stubEnv('AI_ANALYSIS_ENABLED', 'true'); vi.stubEnv('OPENAI_API_KEY', 'test-only-key');
    service = new NewsService(db as unknown as PrismaService);
    const collection = { ...item, title: 'Beijing - AP News', summary: 'Beijing AP News', originalPublisher: 'Associated Press' };
    expect(await service['store']('ap', collection)).toBe(false);
    expect(db.newsAnalysis.upsert).not.toHaveBeenCalled(); expect(db.newsItem.upsert).not.toHaveBeenCalled();
  });
  it('hides an already stored collection without changing its bookmark or timestamps, even if content is unchanged', async () => {
    const collection = { ...item, title: 'Beijing - AP News', summary: 'Beijing AP News', originalPublisher: 'Associated Press' };
    const updatedAt = new Date('2026-10-10T00:00:00Z');
    db.newsItem.findUnique.mockResolvedValue({ ...collection, id: 'hub-record', visible: true, saved: true, analysisKey: 'old-job', updatedAt } as never);
    expect(await service['store']('ap', collection)).toBe(true);
    expect(db.newsItem.updateMany).toHaveBeenCalledWith({ where: { id: 'hub-record', updatedAt }, data: { visible: false, analysisKey: null, aiStatus: 'excluded', updatedAt } });
    expect(db.newsItem.upsert).not.toHaveBeenCalled(); expect(db.newsAnalysis.upsert).not.toHaveBeenCalled();
  });
  it('uses only configured RSS addresses, even when the legacy RSSHub service is enabled', async () => {
    vi.stubEnv('RSSHUB_ENABLED', 'true'); vi.stubEnv('RSSHUB_BASE_URL', 'http://127.0.0.1:3412');
    vi.mocked(requestFeed).mockResolvedValue({ status: 200, data: '<rss/>', headers: {} } as never);
    vi.mocked(parseFeed).mockResolvedValue([item]); await service['collect'](source);
    expect(vi.mocked(requestFeed).mock.calls[0][0]).toMatchObject({ kind: 'google-rss', feedUrl: source.feedUrl });
    expect(vi.mocked(parseFeed).mock.calls[0][1].kind).toBe('google-rss');
    expect(db.newsSource.update.mock.calls[0][0].data.activeFeedUrl).toBe(source.feedUrl);
  });
  it('tries backups in order, avoids ETag cross-use between feeds of the same kind, and backs off failed addresses', async () => {
    const selected = { ...source, feedUrls: ['https://example.org/first', 'https://example.org/backup'] };
    service['config'].sources = [selected];
    db.newsSource.findUniqueOrThrow.mockResolvedValue({ id: source.id, enabled: true, activeFeedUrl: selected.feedUrls[0], etag: 'first-tag' } as never);
    vi.mocked(requestFeed).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ status: 200, data: '<rss/>', headers: {} } as never);
    vi.mocked(parseFeed).mockResolvedValue([item]); await service['collect'](selected);
    expect(vi.mocked(requestFeed).mock.calls[0].slice(1)).toEqual(['first-tag', undefined]);
    expect(vi.mocked(requestFeed).mock.calls[1].slice(1)).toEqual([null, null]);
    const data = db.newsSource.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ activeKind: 'rss', activeFeedUrl: selected.feedUrls[1], error: null });
    expect(Date.parse(JSON.parse(data.feedFailures)[selected.feedUrls[0]].retryAt)).toBeGreaterThan(Date.now() + 290000);
    db.newsSource.findUniqueOrThrow.mockResolvedValue({ ...data, enabled: true } as never);
    vi.mocked(requestFeed).mockClear().mockResolvedValue({ status: 304, data: '', headers: {} } as never);
    await service['collect'](selected); expect(requestFeed).toHaveBeenCalledOnce(); expect(vi.mocked(requestFeed).mock.calls[0][0].feedUrl).toBe(selected.feedUrls[1]);
  });
  it('only changes the source switch and rejects non-boolean values', async () => {
    await service.enableSource(source.id, false);
    expect(db.newsSource.update.mock.calls[0][0].data).toMatchObject({ enabled: false });
    await expect(service.enableSource(source.id, 'yes')).rejects.toThrow();
    await expect(service.enableSource('missing', true)).rejects.toThrow();
  });
  it('falls back after XML parse failure but stops when a valid feed has zero matching articles', async () => {
    const selected = { ...source, feedUrls: ['https://example.org/first', 'https://example.org/backup'] };
    service['config'].sources = [selected];
    vi.mocked(requestFeed).mockResolvedValue({ status: 200, data: '<rss/>', headers: {} } as never);
    vi.mocked(parseFeed).mockRejectedValueOnce(new Error('malformed')).mockResolvedValueOnce([]);
    await service['collect'](selected); expect(requestFeed).toHaveBeenCalledTimes(2); expect(db.newsItem.upsert).not.toHaveBeenCalled();
    vi.mocked(requestFeed).mockClear(); vi.mocked(parseFeed).mockResolvedValue([]);
    await service['collect'](selected); expect(requestFeed).toHaveBeenCalledOnce();
  });
  it('tests the current draft without saving config, inserting news or queuing AI', async () => {
    vi.mocked(requestFeed).mockResolvedValue({ status: 200, data: '<rss/>', headers: {} } as never);
    vi.mocked(inspectFeed).mockResolvedValue({ title: 'Fixture feed', rawCount: 1, checkedCount: 1, items: [item], samples: [{ title: item.title, summary: item.summary, url: item.url, publishedAt: item.publishedAt, accepted: true, reason: null }] });
    const result = await service.testSource(source);
    expect(result).toMatchObject({ ok: true, rawCount: 1, acceptedCount: 1 });
    expect(db.newsItem.upsert).not.toHaveBeenCalled(); expect(db.newsSource.update).not.toHaveBeenCalled();
    expect(db.newsAnalysis.upsert).not.toHaveBeenCalled(); expect(db.setting.upsert).not.toHaveBeenCalled();
    expect(vi.mocked(requestFeed).mock.calls[0].slice(1)).toEqual([null, null]);
  });
  it('returns every failed test address without modifying the source state', async () => {
    vi.mocked(requestFeed).mockRejectedValue(new Error('offline'));
    const result = await service.testSource({ ...source, feedUrls: ['https://example.org/first', 'https://example.org/backup'] });
    expect(result.ok).toBe(false); expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every(attempt => !!attempt.error)).toBe(true);
    expect(db.newsSource.update).not.toHaveBeenCalled(); expect(db.newsItem.upsert).not.toHaveBeenCalled();
  });
  it('retains Retry-After for the primary address when a backup succeeds', async () => {
    const selected = { ...source, feedUrls: ['https://example.org/first', 'https://example.org/backup'] };
    service['config'].sources = [selected];
    const error = new AxiosError('limited'); error.response = { status: 429, headers: { 'retry-after': '600' } } as never;
    vi.mocked(requestFeed).mockRejectedValueOnce(error).mockResolvedValueOnce({ status: 200, data: '<rss/>', headers: { etag: 'backup-tag' } } as never);
    vi.mocked(parseFeed).mockResolvedValue([]);
    const before = Date.now(); await service['collect'](selected);
    const state = db.newsSource.update.mock.calls[0][0].data;
    expect(Date.parse(JSON.parse(state.feedFailures)[selected.feedUrls[0]].retryAt)).toBeGreaterThanOrEqual(before + 600_000);
    db.newsSource.findUniqueOrThrow.mockResolvedValue({ ...state, enabled: true } as never);
    vi.mocked(requestFeed).mockClear().mockResolvedValue({ status: 304, data: '', headers: {} } as never);
    await service['collect'](selected);
    expect(requestFeed).toHaveBeenCalledOnce(); expect(vi.mocked(requestFeed).mock.calls[0][0].feedUrl).toBe(selected.feedUrls[1]);
    expect(vi.mocked(requestFeed).mock.calls[0][1]).toBe('backup-tag');
  });
  it('does not store a response that arrives after its source was deleted or edited', async () => {
    vi.mocked(requestFeed).mockImplementationOnce(async () => { service['config'].sources = []; return { status: 200, data: '<rss/>', headers: {} } as never; });
    vi.mocked(parseFeed).mockResolvedValue([item]); await service['collect'](source);
    expect(db.newsItem.upsert).not.toHaveBeenCalled(); expect(db.newsSource.update).not.toHaveBeenCalled();
  });
  it('stores original news immediately without an AI key', async () => {
    vi.mocked(requestFeed).mockResolvedValue({ status: 200, data: '<rss/>', headers: { etag: 'v1' } } as never);
    vi.mocked(parseFeed).mockResolvedValue([item]);
    await service['collect'](source);
    expect(db.newsItem.upsert.mock.calls[0][0].create.aiStatus).toBe('disabled');
    expect(db.newsSource.update.mock.calls[0][0].data.error).toBeNull();
  });
  it('treats 304 as success while keeping prior count and news', async () => {
    db.newsSource.findUniqueOrThrow.mockResolvedValue({ id: source.id, enabled: true, activeFeedUrl: source.feedUrl, etag: 'fixture' } as never);
    vi.mocked(requestFeed).mockResolvedValue({ status: 304, data: '', headers: {} } as never);
    await service['collect'](source);
    expect(parseFeed).not.toHaveBeenCalled(); expect(db.newsItem.upsert).not.toHaveBeenCalled();
    expect(db.newsSource.update.mock.calls[0][0].data.lastItemCount).toBeUndefined();
  });
  it('honors Retry-After on 429 and keeps stored items', async () => {
    const error = new AxiosError('limited'); error.response = { status: 429, headers: { 'retry-after': '600' } } as never;
    vi.mocked(requestFeed).mockRejectedValue(error);
    const before = Date.now(); await service['collect'](source);
    const state = db.newsSource.update.mock.calls[0][0].data;
    expect(state.error).toContain('429'); expect(state.nextCheckAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
    expect(db.newsItem.upsert).not.toHaveBeenCalled();
  });
  it('distinguishes request, parsing and storage failures', async () => {
    vi.mocked(requestFeed).mockRejectedValue(new TypeError('invalid proxy'));
    await service['collect'](source); expect(db.newsSource.update.mock.calls[0][0].data.error).toContain('连接失败');
    vi.mocked(requestFeed).mockResolvedValue({ status: 200, data: '', headers: {} } as never);
    vi.mocked(parseFeed).mockRejectedValue(new Error('invalid xml'));
    await service['collect'](source); expect(db.newsSource.update.mock.calls[1][0].data.error).toContain('RSS');
  });
  it('does not rewrite unchanged content, and preserves firstSeen/saved on edits', async () => {
    db.newsItem.findUnique.mockResolvedValue({ contentHash: 'v1', saved: true } as never);
    expect(await service['store'](source.id, item)).toBe(false); expect(db.newsItem.upsert).not.toHaveBeenCalled();
    await service['store'](source.id, { ...item, contentHash: 'v2', title: 'China updates trade policy' });
    const update = db.newsItem.upsert.mock.calls[0][0].update;
    expect(update.saved).toBeUndefined(); expect(update.firstSeenAt).toBeUndefined(); expect(update.titleZh).toBeNull();
  });
  it('queues both RSS and Telegram for AI before deciding visibility', async () => {
    vi.stubEnv('AI_ANALYSIS_ENABLED', 'true'); vi.stubEnv('OPENAI_API_KEY', 'test-only-key');
    service = new NewsService(db as unknown as PrismaService);
    await service['store']('tg-xhqcankao', item);
    expect(db.newsItem.upsert.mock.calls[0][0].create.aiStatus).toBe('pending');
    expect(db.newsItem.upsert.mock.calls[0][0].create.visible).toBe(false);
    expect(db.newsAnalysis.upsert).toHaveBeenCalledOnce();
  });
  it('does not mistake a bookmark operation for a content update', async () => {
    const updatedAt = new Date('2026-10-10T00:00:00Z');
    db.newsItem.findUnique.mockResolvedValue({ ...item, updatedAt } as never);
    await service.save('id', true);
    expect(db.newsItem.update.mock.calls[0][0].data).toEqual({ saved: true, updatedAt });
  });
  it('reuses one completed result across sources and metadata changes without queuing another call', async () => {
    vi.stubEnv('AI_ANALYSIS_ENABLED', 'true'); vi.stubEnv('OPENAI_API_KEY', 'test-only-key');
    service = new NewsService(db as unknown as PrismaService);
    const updatedAt = new Date('2026-10-10T00:00:00Z');
    db.newsAnalysis.findUnique.mockResolvedValue({ status: 'done', analyzedAt: updatedAt, resultJson: JSON.stringify({ version: 1, relation: 'related', topics: ['policy', 'economy'], type: 'report', language: 'en', reason: '涉及中国贸易政策', translation: { title: '中国贸易政策', summary: '新的出口措施' } }) } as never);
    await service['store'](source.id, item);
    await service['store']('tg-xhqcankao', { ...item, publishedAt: new Date('2026-10-10T01:00:00Z') });
    expect(db.newsAnalysis.upsert).not.toHaveBeenCalled();
    for (const [args] of db.newsItem.upsert.mock.calls) expect(args.create).toMatchObject({ visible: true, decisionBy: 'ai', aiStatus: 'done', titleZh: '中国贸易政策', aiTopics: '["policy","economy"]', analysisKey: analysisKey(item) });
  });
});
