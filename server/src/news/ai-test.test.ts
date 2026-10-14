import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { APIConnectionTimeoutError, APIConnectionError, APIError } from 'openai';
import { runtimeFixtures } from '../../test-utils/runtime-fixture';

const model = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock('openai', async importOriginal => ({ ...await importOriginal<typeof import('openai')>(), default: class {
  chat = { completions: { create: model.create } };
  constructor(options: unknown) { model.options(options); }
} }));
const sample = { title: 'China announces new trade measures', summary: 'New import rules.' };
const analysis = { version: 2, scoring: { relevance: 8, novelty: 7, audience: 8, quality: 7, importance: 'high', tags: ['贸易'] }, relation: 'related', topics: ['policy', 'economy'], type: 'report', language: 'en', reason: '涉及中国贸易政策', translation: { title: '中国公布新贸易措施', summary: '新的进口规定。' } };
const store = runtimeFixtures();
beforeAll(() => store.prepare(), 30000);
afterAll(() => store.close());
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
async function fixture(used = '0', enabled = true, apiKey = 'test-only-key') {
  model.create.mockReset().mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }] });
  vi.stubEnv('COLLECTOR_ENABLED', 'false');
  const f = await store.create({ enabled, apiKey, dailyLimit: 5 }, used);
  return { ...f, async test(input: unknown = sample) {
    const ticket = await f.service.testAi(input); await f.run();
    const task = await f.runtime.task(ticket.taskId);
    expect(task.status).toBe('done'); return task.result as any;
  } };
}
describe('administrator AI test', () => {
  it('queues once, uses saved config, counts actual dispatch and leaves news/cache untouched', async () => {
    const f = await fixture(); f.config.ai.model = 'saved-model'; f.config.ai.instructions = '关注贸易政策'; await f.saveConfig();
    const output = await f.test({ title: `<b>${sample.title}</b>`, summary: sample.summary });
    expect(output).toMatchObject({ ok: true, model: 'saved-model', input: sample, result: analysis, preview: { visible: true, decisionBy: 'ai' }, usage: { used: 1, limit: 5 } });
    expect(model.create).toHaveBeenCalledOnce();
    expect(model.create.mock.calls[0][0]).toMatchObject({ model: 'saved-model', response_format: { type: 'json_object' } });
    expect(model.create.mock.calls[0][0].messages[0].content).toContain('关注贸易政策');
    expect(model.create.mock.calls[0][0].messages.at(-1).content).toBe(JSON.stringify({ ...sample, truncated: false }));
    expect(model.options).toHaveBeenCalledWith(expect.objectContaining({ timeout: 120000, maxRetries: 0 }));
    expect(await f.usage()).toBe('1'); expect(await f.db.aiRequest.count()).toBe(1);
    expect(await f.db.newsItem.count()).toBe(0); expect(await f.db.newsAnalysis.count()).toBe(0);
    expect(JSON.stringify(output)).not.toContain('test-only-key');
  });
  it('allows an explicit test with a saved key while automatic analysis is disabled', async () => {
    const f = await fixture('0', false); expect((await f.test()).ok).toBe(true);
    expect(f.config.ai.enabled).toBe(false); expect(model.create).toHaveBeenCalledOnce();
  });
  it.each([null, {}, { ...sample, title: ' ' }, { ...sample, title: '<b></b>' }, { ...sample, title: 'a'.repeat(601) }, { ...sample, summary: 'a'.repeat(1601) }])('rejects invalid content before queuing: %j', async input => {
    const f = await fixture(); await expect(f.service.testAi(input)).rejects.toThrow();
    expect(model.create).not.toHaveBeenCalled(); expect(await f.db.aiTask.count()).toBe(0); expect(await f.usage()).toBe('0');
  });
  it('rejects missing keys before queuing and exhausted quota before dispatch', async () => {
    const missing = await fixture('0', true, ''); await expect(missing.service.testAi(sample)).rejects.toThrow('API Key');
    const exhausted = await fixture('5'); expect(await exhausted.test()).toMatchObject({ ok: false, error: { code: 'configuration', message: expect.stringContaining('额度已用尽') } });
    expect(model.create).not.toHaveBeenCalled(); expect(await exhausted.usage()).toBe('5'); expect(await exhausted.db.aiRequest.count()).toBe(0);
  });
  it.each([401, 403, 404, 429, 400, 422, 503])('reports HTTP %i safely without retrying a test', async status => {
    const f = await fixture(); model.create.mockRejectedValue(APIError.generate(status, { error: { message: 'secret test-only-key' } }, undefined, {}));
    const output = await f.test(); expect(output).toMatchObject({ ok: false, error: { code: 'http-error', status }, usage: { used: 1 } });
    expect(JSON.stringify(output)).not.toContain('test-only-key'); expect(model.create).toHaveBeenCalledOnce();
    expect((await f.db.aiTask.findFirstOrThrow()).maxAttempts).toBe(1);
  });
  it('reports real SDK timeouts and lets later tasks proceed', async () => {
    const f = await fixture(); const timeout = new APIConnectionTimeoutError(); expect(timeout.name).toBe('Error');
    model.create.mockRejectedValueOnce(timeout);
    expect(await f.test()).toMatchObject({ ok: false, error: { code: 'timeout', errorType: 'APIConnectionTimeoutError', message: expect.stringContaining('120 秒') } });
    expect(await f.test()).toMatchObject({ ok: true, usage: { used: 2 } });
  });
  it('identifies connection causes without returning credentials', async () => {
    const f = await fixture(); const cause = Object.assign(new Error('https://test-only-key@example.invalid'), { code: 'ENOTFOUND' });
    model.create.mockRejectedValueOnce(new APIConnectionError({ cause }));
    const output = await f.test(); expect(output).toMatchObject({ ok: false, error: { code: 'connection-error', networkCode: 'ENOTFOUND', detail: expect.stringContaining('域名') } });
    expect(JSON.stringify(output)).not.toContain('test-only-key');
  });
  it('reports safe HTTP request identifiers and rejection guidance', async () => {
    const f = await fixture(); model.create.mockRejectedValueOnce(APIError.generate(429, {}, undefined, { 'x-request-id': 'req-test-429' }));
    expect(await f.test()).toMatchObject({ ok: false, error: { status: 429, errorType: 'RateLimitError', requestId: 'req-test-429', detail: expect.stringContaining('限流') } });
  });
  it('does not expose a credential returned as a request identifier', async () => {
    const f = await fixture(); model.create.mockRejectedValueOnce(APIError.generate(503, {}, undefined, { 'x-request-id': 'test-only-key' }));
    const output = await f.test(); expect(output.error).not.toHaveProperty('requestId'); expect(JSON.stringify(output)).not.toContain('test-only-key');
  });
  it('explains invalid JSON and includes a safe request identifier', async () => {
    const f = await fixture(); model.create.mockResolvedValueOnce({ _request_id: 'req-invalid-json', choices: [{ finish_reason: 'stop', message: { content: 'not JSON' } }] });
    expect(await f.test()).toMatchObject({ ok: false, error: { code: 'invalid-response', detail: expect.stringContaining('JSON'), requestId: 'req-invalid-json' } });
  });
  it('explains truncation before parsing', async () => {
    const f = await fixture(); model.create.mockResolvedValueOnce({ choices: [{ finish_reason: 'length', message: { content: '{' } }] });
    expect(await f.test()).toMatchObject({ ok: false, error: { code: 'invalid-response', detail: expect.stringContaining('截断') } });
  });
  it.each(['not JSON', JSON.stringify({ ...analysis, translation: { title: '标题', summary: '' } })])('rejects invalid results without caching', async content => {
    const f = await fixture(); model.create.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content } }] });
    expect(await f.test()).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
    expect(await f.db.newsAnalysis.count()).toBe(0); expect(await f.usage()).toBe('1');
  });
  it('previews uncertain rule fallback without another translation request', async () => {
    const f = await fixture(); model.create.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...analysis, language: 'zh-Hans', translation: null, relation: 'uncertain' }) } }] });
    expect(await f.test()).toMatchObject({ ok: true, preview: { visible: true, decisionBy: 'ai-uncertain-rules' }, result: { translation: null } });
    expect(model.create).toHaveBeenCalledOnce();
  });
  it('queues simultaneous tests and dispatches them serially without early charges', async () => {
    const f = await fixture(); let finish!: (value: unknown) => void;
    model.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = await f.service.testAi(sample); const second = await f.service.testAi(sample);
    expect(first.taskId).not.toBe(second.taskId); expect(await f.usage()).toBe('0');
    const pending = f.run(); await vi.waitFor(() => expect(model.create).toHaveBeenCalledOnce());
    expect((await f.runtime.task(second.taskId)).status).toBe('queued'); expect(await f.usage()).toBe('1');
    finish({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }] }); await pending; await f.run();
    expect(await f.usage()).toBe('2'); expect(model.create).toHaveBeenCalledTimes(2);
  });
  it('requires a guard-authenticated administrator and rejects foreign origins', () => {
    vi.stubEnv('CLIENT_URL', 'http://localhost:3410');
    const service = { testAi: vi.fn() }; const controller = new NewsController(service as unknown as NewsService);
    const request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    expect(() => controller.testAi(sample, request)).toThrow();
    expect(() => controller.testAi(sample, { ...request, adminAuthenticated: true, headers: { origin: 'https://foreign.example.org' } })).toThrow();
    expect(service.testAi).not.toHaveBeenCalled();
    controller.testAi(sample, { ...request, adminAuthenticated: true, headers: { origin: 'http://localhost:3410' } });
    expect(service.testAi).toHaveBeenCalledWith(sample);
  });
});
