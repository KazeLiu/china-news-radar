import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, restoreConfig, validateAi, validateRules, validateSource, readAiUsage } from './admin-config';
import { matchingExclusions } from './content-filter';
import { requireAdmin } from './admin-access';

afterEach(() => vi.unstubAllEnvs());
describe('administrator configuration', () => {
  it('rejects corrupt stored usage instead of bypassing the daily budget', () => {
    expect(readAiUsage()).toBe(0); expect(readAiUsage('0')).toBe(0); expect(readAiUsage('100')).toBe(100);
    for (const value of ['', 'invalid', '-1', '1.5', 'Infinity', '9007199254740992']) expect(() => readAiUsage(value)).toThrow('用量无效');
  });
  it('preserves saved keys when blank, replaces keys across restarts, and validates budgets', () => {
    vi.stubEnv('OPENAI_API_KEY', 'environment-fixture');
    const config = defaultConfig();
    expect(validateAi({ ...config.ai, apiKey: '' }, config.ai).apiKey).toBe('environment-fixture');
    expect(validateAi({ ...config.ai, apiKey: '', clearKey: true }, config.ai).apiKey).toBe('environment-fixture');
    const replaced = validateAi({ ...config.ai, apiKey: 'replacement-fixture' }, config.ai);
    expect(restoreConfig(JSON.stringify({ ...config, ai: replaced })).ai.apiKey).toBe('replacement-fixture');
    for (const dailyLimit of [-1, 1.5, '100', 100001]) expect(() => validateAi({ ...config.ai, dailyLimit }, config.ai)).toThrow();
  });
  it('validates ordered foreign RSS addresses and removes legacy RSSHub route fields', () => {
    const config = defaultConfig(); const ap = config.sources.find(s => s.id === 'ap')!;
    const saved = validateSource({ ...ap, feedUrls: ['https://example.org/feed', 'https://backup.example.org/feed'], kind: 'rss', rsshubRoute: '/apnews/topics/china' }, ap);
    expect(saved.feedUrls).toEqual(['https://example.org/feed', 'https://backup.example.org/feed']); expect(saved).not.toHaveProperty('rsshubRoute');
    for (const patch of [{ feedUrls: ['http://127.0.0.1/private'] }, { feedUrls: [] }, { feedUrls: ['https://example.org/rss', 'https://example.org/rss'] }, { publisherHosts: ['apnews.com.evil/'] }, { publisherHosts: ['sina.com.cn'] }, { pollSeconds: 0 }, { id: 'tg-new-channel' }]) expect(() => validateSource({ ...ap, ...patch }, ap)).toThrow();
    vi.stubEnv('RSSHUB_BASE_URL', 'http://127.0.0.1:3412');
    expect(validateSource({ ...ap, feedUrls: ['http://127.0.0.1:3412/feeds/ap'] }).feedUrls).toHaveLength(1);
  });
  it('migrates a single saved RSS URL and keeps deleted built-in sources absent after restart', () => {
    const config = defaultConfig(); const ap = config.sources.find(s => s.id === 'ap')!;
    const restored = restoreConfig(JSON.stringify({ ...config, sources: [{ ...ap, feedUrls: undefined, rsshubRoute: '/apnews/topics/china' }] }));
    expect(restored.sources).toHaveLength(1); expect(restored.sources[0].feedUrls).toEqual([ap.feedUrl]);
    expect(restored.sources[0]).not.toHaveProperty('rsshubRoute');
    expect(restoreConfig(JSON.stringify({ ...config, sources: [], removedSourceIds: ['ap'], rules: [{ id: 'ap-rule', sourceId: 'ap', enabled: true, field: 'titleContains', value: 'podcast' }] })).sources).toEqual([]);
  });
  it('supports scoped and disabled rules, original URLs, path boundaries and normal short reports', () => {
    const config = defaultConfig();
    const rules = validateRules([{ id: 'hub', sourceId: 'ap', enabled: true, field: 'urlPrefix', value: 'https://apnews.com/hub/' }], config.sources);
    const item = { title: 'China policy', summary: '', url: 'https://t.me/channel/1', originalUrl: 'https://www.apnews.com/hub/beijing?foo=bar' };
    expect(matchingExclusions(item, rules, 'ap')).toHaveLength(1);
    expect(matchingExclusions(item, rules, 'reuters')).toHaveLength(0);
    for (const url of ['https://apnews.com/article/china-hub-story', 'https://apnews.com/hubris', 'https://apnews.com.evil.test/hub/beijing']) expect(matchingExclusions({ ...item, originalUrl: url }, rules, 'ap')).toHaveLength(0);
    expect(matchingExclusions(item, [{ ...rules[0], enabled: false }], 'ap')).toHaveLength(0);
    expect(matchingExclusions({ title: 'Beijing bans imports - AP News', summary: '', url: 'https://news.google.com/rss/articles/opaque' })).toHaveLength(0);
    expect(() => validateRules([{ ...rules[0], value: '' }], config.sources)).toThrow();
    expect(() => validateRules([rules[0], rules[0]], config.sources)).toThrow();
  });
});
describe('administrator access', () => {
  const local = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:3411', origin: 'http://localhost:3410', 'x-forwarded-for': '::1', 'x-forwarded-host': 'localhost:3410' } };
  it('allows localhost without a token and rejects remote visitors including proxies', () => {
    vi.stubEnv('ADMIN_TOKEN', ''); requireAdmin(local);
    expect(() => requireAdmin({ ...local, socket: { remoteAddress: '203.0.113.10' } })).toThrow();
    expect(() => requireAdmin({ ...local, headers: { ...local.headers, 'x-forwarded-for': '203.0.113.10' } })).toThrow();
    expect(() => requireAdmin({ ...local, headers: { ...local.headers, 'x-forwarded-host': 'china-news.example.org' } })).toThrow();
  });
  it('requires the token even from localhost once configured', () => {
    const token = 'test-only-admin-token-32-characters'; vi.stubEnv('ADMIN_TOKEN', token);
    expect(() => requireAdmin(local)).toThrow();
    requireAdmin({ ...local, headers: { authorization: `Bearer ${token}` } });
    requireAdmin({ ...local, headers: { authorization: 'Basic proxy-auth-fixture', 'x-admin-token': token } });
    expect(() => requireAdmin({ ...local, headers: { authorization: `Bearer ${token.slice(1)}` } })).toThrow();
  });
});
