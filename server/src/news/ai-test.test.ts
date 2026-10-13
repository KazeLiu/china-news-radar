import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewsService } from './news.service';
import { NewsController } from './news.controller';
import { PrismaService } from '../prisma/prisma.service';
import { APIConnectionTimeoutError, APIConnectionError, APIError } from 'openai';

const model = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock('openai', async importOriginal => ({ ...await importOriginal<typeof import('openai')>(), default: class {
  chat = { completions: { create: model.create } };
  constructor(options: unknown) { model.options(options); }
} }));
const sample = { title: 'China announces new trade measures', summary: 'New import rules.' };
const analysis = { version: 1, relation: 'related', topics: ['policy', 'economy'], type: 'report', language: 'en', reason: '涉及中国贸易政策', translation: { title: '中国公布新贸易措施', summary: '新的进口规定。' } };

function fixture(used = '0', enabled = true, key = 'test-only-key') {
  vi.stubEnv('AI_ANALYSIS_ENABLED', String(enabled)); vi.stubEnv('OPENAI_API_KEY', key); vi.stubEnv('AI_DAILY_LIMIT', '5');
  const usageKey = `news-ai-usage-${new Date().toISOString().slice(0, 10)}`;
  const settings = new Map([[usageKey, used]]);
  const db = {
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => ({ value: settings.get(where.key) || '0' })),
      upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { value: string }; update: { value: string } }) => { settings.set(where.key, settings.has(where.key) ? update.value : create.value); }),
    },
    newsItem: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    newsAnalysis: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async callback => callback(db));
  model.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(analysis) } }] });
  const service = new NewsService(db as unknown as PrismaService);
  return { service, db, settings, usageKey };
}
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('administrator AI test', () => {
  it('uses the saved model and prompt once, counts quota, and leaves news, cache and configuration untouched', async () => {
    const f = fixture(); f.service['config'].ai.model = 'saved-model'; f.service['config'].ai.instructions = '关注贸易政策';
    const output = await f.service.testAi({ title: `<b>${sample.title}</b>`, summary: sample.summary });
    expect(output).toMatchObject({ ok: true, model: 'saved-model', input: sample, result: analysis, preview: { visible: true, decisionBy: 'ai' }, usage: { used: 1, limit: 5 } });
    expect(model.create).toHaveBeenCalledOnce();
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ model: 'saved-model', response_format: { type: 'json_object' }, messages: [
      expect.objectContaining({ role: 'system', content: expect.stringContaining('关注贸易政策') }),
      { role: 'user', content: JSON.stringify({ ...sample, truncated: false }) },
    ] }));
    expect(model.options).toHaveBeenCalledWith(expect.objectContaining({ timeout: 120_000, maxRetries: 0 }));
    expect(f.settings.get(f.usageKey)).toBe('1'); expect(f.settings.size).toBe(1);
    for (const method of Object.values(f.db.newsItem)) expect(method).not.toHaveBeenCalled();
    for (const method of Object.values(f.db.newsAnalysis)) expect(method).not.toHaveBeenCalled();
    expect(JSON.stringify(output)).not.toContain('test-only-key');
  });
  it('allows an explicit test with a saved key while automatic AI analysis is disabled', async () => {
    const f = fixture('0', false);
    expect(f.service['ai']).toBeNull(); expect((await f.service.testAi(sample)).ok).toBe(true);
    expect(f.service['config'].ai.enabled).toBe(false); expect(model.create).toHaveBeenCalledOnce();
    expect(model.options).toHaveBeenCalledWith(expect.objectContaining({ timeout: 120_000, maxRetries: 0 }));
  });
  it.each([null, {}, { ...sample, title: ' ' }, { ...sample, title: '<b></b>' }, { ...sample, title: 'a'.repeat(601) }, { ...sample, summary: 'a'.repeat(1601) }])('rejects invalid sample content without charging: %j', async sample => {
    const f = fixture(); await expect(f.service.testAi(sample)).rejects.toThrow();
    expect(model.create).not.toHaveBeenCalled(); expect(f.db.setting.upsert).not.toHaveBeenCalled();
  });
  it('rejects missing keys and exhausted quota before making a request', async () => {
    const missing = fixture('0', true, ''); await expect(missing.service.testAi(sample)).rejects.toThrow('API Key');
    const exhausted = fixture('5'); await expect(exhausted.service.testAi(sample)).rejects.toThrow('额度已用尽');
    expect(model.create).not.toHaveBeenCalled(); expect(exhausted.settings.get(exhausted.usageKey)).toBe('5');
  });
  it.each([401, 403, 404, 429, 400, 422, 503])('reports HTTP %i without exposing provider error bodies or retrying', async status => {
    const f = fixture(); model.create.mockRejectedValue({ status, message: 'secret test-only-key', error: { apiKey: 'test-only-key' } });
    const output = await f.service.testAi(sample);
    expect(output).toMatchObject({ ok: false, error: { code: 'http-error', status }, usage: { used: 1 } });
    expect(JSON.stringify(output)).not.toContain('test-only-key'); expect(model.create).toHaveBeenCalledOnce();
  });
  it('reports timeouts and releases the test lock after failure', async () => {
    const f = fixture(); const timeout = new APIConnectionTimeoutError();
    expect(timeout.name).toBe('Error');
    model.create.mockRejectedValueOnce(timeout);
    expect(await f.service.testAi(sample)).toMatchObject({ ok: false, error: { code: 'timeout', errorType: 'APIConnectionTimeoutError', message: expect.stringContaining('120 秒'), detail: expect.stringContaining('未收到完整响应') } });
    expect(await f.service.testAi(sample)).toMatchObject({ ok: true, usage: { used: 2 } });
  });
  it('identifies connection causes without returning credentials or provider error bodies', async () => {
    const f = fixture(); const cause = Object.assign(new Error('https://test-only-key@example.invalid'), { code: 'ENOTFOUND' });
    model.create.mockRejectedValueOnce(new APIConnectionError({ cause }));
    const output = await f.service.testAi(sample);
    expect(output).toMatchObject({ ok: false, error: { code: 'connection-error', errorType: 'APIConnectionError', networkCode: 'ENOTFOUND', detail: expect.stringContaining('域名') } });
    expect(JSON.stringify(output)).not.toContain('test-only-key');
  });
  it('reports HTTP request identifiers and specific rejection guidance', async () => {
    const f = fixture(); model.create.mockRejectedValueOnce(APIError.generate(429, { error: { message: 'secret test-only-key' } }, undefined, { 'x-request-id': 'req-test-429' }));
    const output = await f.service.testAi(sample);
    expect(output).toMatchObject({ ok: false, error: { code: 'http-error', status: 429, errorType: 'RateLimitError', requestId: 'req-test-429', detail: expect.stringContaining('限流') } });
    expect(JSON.stringify(output)).not.toContain('test-only-key');
  });
  it('does not expose a credential returned as a request identifier', async () => {
    const f = fixture(); model.create.mockRejectedValueOnce(APIError.generate(503, {}, undefined, { 'x-request-id': 'test-only-key' }));
    const output = await f.service.testAi(sample);
    expect(output.error).not.toHaveProperty('requestId'); expect(JSON.stringify(output)).not.toContain('test-only-key');
  });
  it('explains invalid JSON and includes the response request identifier', async () => {
    const f = fixture(); model.create.mockResolvedValueOnce({ _request_id: 'req-invalid-json', choices: [{ finish_reason: 'stop', message: { content: 'not JSON' } }] });
    expect(await f.service.testAi(sample)).toMatchObject({ ok: false, error: { code: 'invalid-response', detail: '模型输出不是有效 JSON。', requestId: 'req-invalid-json' } });
  });
  it('explains output truncation before trying to parse it', async () => {
    const f = fixture(); model.create.mockResolvedValueOnce({ choices: [{ finish_reason: 'length', message: { content: '{' } }] });
    expect(await f.service.testAi(sample)).toMatchObject({ ok: false, error: { code: 'invalid-response', detail: expect.stringContaining('输出长度上限') } });
  });
  it.each(['not JSON', JSON.stringify({ ...analysis, translation: { title: '标题', summary: '' } })])('rejects invalid output and incomplete translations without caching', async content => {
    const f = fixture(); model.create.mockResolvedValue({ choices: [{ message: { content } }] });
    expect(await f.service.testAi(sample)).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
    expect(f.db.newsAnalysis.upsert).not.toHaveBeenCalled(); expect(f.settings.get(f.usageKey)).toBe('1');
  });
  it('previews uncertain rule fallback and Simplified Chinese without another translation request', async () => {
    const f = fixture(); model.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ ...analysis, language: 'zh-Hans', translation: null, relation: 'uncertain' }) } }] });
    expect(await f.service.testAi(sample)).toMatchObject({ ok: true, preview: { visible: true, decisionBy: 'ai-uncertain-rules' }, result: { translation: null } });
    expect(model.create).toHaveBeenCalledOnce();
  });
  it('blocks a second simultaneous test before it spends quota', async () => {
    const f = fixture(); let finish!: (value: unknown) => void;
    model.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.service.testAi(sample);
    await vi.waitFor(() => expect(model.create).toHaveBeenCalledOnce());
    await expect(f.service.testAi(sample)).rejects.toThrow('正在保存配置或测试 AI');
    expect(f.settings.get(f.usageKey)).toBe('1');
    finish({ choices: [{ message: { content: JSON.stringify(analysis) } }] }); await pending;
  });
  it('protects the paid endpoint with administrator and same-origin checks', () => {
    vi.stubEnv('ADMIN_TOKEN', 'a'.repeat(32)); vi.stubEnv('CLIENT_URL', 'http://localhost:3410');
    const service = { testAi: vi.fn() }; const controller = new NewsController(service as unknown as NewsService);
    const request = { headers: {}, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } };
    expect(() => controller.testAi(sample, request)).toThrow();
    expect(() => controller.testAi(sample, { ...request, headers: { origin: 'https://foreign.example.org', 'x-admin-token': 'a'.repeat(32) } })).toThrow();
    expect(service.testAi).not.toHaveBeenCalled();
    controller.testAi(sample, { ...request, headers: { origin: 'http://localhost:3410', 'x-admin-token': 'a'.repeat(32) } });
    expect(service.testAi).toHaveBeenCalledWith(sample);
  });
});
