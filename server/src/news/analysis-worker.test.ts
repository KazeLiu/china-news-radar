import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { APIError } from 'openai';
import { analysisInput, analysisKey } from './analysis';
import { runtimeFixtures } from '../../test-utils/runtime-fixture';

const model = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', async importOriginal => ({ ...await importOriginal<typeof import('openai')>(), default: class {
  chat = { completions: { create: model.create } };
} }));
const result = { version: 2, scoring: { relevance: 8, novelty: 7, audience: 8, quality: 7, importance: 'high', tags: ['贸易'] }, relation: 'related', topics: ['policy', 'economy'], type: 'report', language: 'en', reason: '中国相关政策', translation: { title: '中国相关政策', summary: '新规定。' } };
const store = runtimeFixtures();
beforeAll(() => store.prepare(), 30000);
afterAll(() => store.close());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function response(results: unknown) { return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(results) } }] }; }
async function fixture(usage = '0') {
  vi.stubEnv('COLLECTOR_ENABLED', 'false');
  model.create.mockReset().mockImplementation(async params => response({ results: JSON.parse(params.messages.at(-1).content).items.map((input: { id: string }) => ({ id: input.id, ...result })) }));
  const f = await store.create({}, usage);
  const originalTime = new Date('2026-10-10T00:00:00Z');
  const item = await f.db.newsItem.create({ data: { id: '1', sourceId: 'reuters', topic: 'policy', title: 'China trade policy', summary: 'New rules', url: 'https://reuters.com/world/story', originalPublisher: 'Reuters', updatedAt: originalTime, firstSeenAt: originalTime, saved: true, visible: false, contentHash: 'original', eventKey: 'event' } });
  const key = analysisKey(item);
  await f.db.newsItem.update({ where: { id: item.id }, data: { analysisKey: key, aiStatus: 'pending', updatedAt: originalTime } });
  await f.db.newsAnalysis.create({ data: { key, inputJson: JSON.stringify(analysisInput(item)), historical: false } });
  const ticket = await f.service['queueBatch']([key]);
  return { ...f, key, item, ticket, originalTime,
    readItem: () => f.db.newsItem.findUniqueOrThrow({ where: { id: item.id } }),
    readJob: () => f.db.newsAnalysis.findUniqueOrThrow({ where: { key } }),
    readTask: () => f.db.aiTask.findUniqueOrThrow({ where: { id: ticket.taskId } }),
  };
}
describe('persistent unified AI worker', () => {
  it('analyzes and translates once, preserving original dates and bookmark', async () => {
    const f = await fixture(); await f.run();
    expect(await f.readItem()).toMatchObject({ visible: true, decisionBy: 'ai', aiStatus: 'done', titleZh: '中国相关政策', saved: true, updatedAt: f.originalTime, firstSeenAt: f.originalTime });
    expect(await f.usage()).toBe('1'); expect(model.create).toHaveBeenCalledOnce();
    await f.run(); expect(model.create).toHaveBeenCalledOnce();
  });
  it('does not dispatch when the persisted shared budget is exhausted', async () => {
    const f = await fixture('100'); await f.run(); await f.run();
    expect(model.create).not.toHaveBeenCalled(); expect(await f.readItem()).toMatchObject({ visible: true, decisionBy: 'rules', aiStatus: 'failed' });
    expect((await f.readTask()).errorJson).toContain('额度已用尽'); expect(await f.usage()).toBe('100');
  });
  it('stops before a request when stored daily usage is corrupt', async () => {
    const f = await fixture('invalid'); await f.run();
    expect(model.create).not.toHaveBeenCalled(); expect(await f.usage()).toBe('invalid'); expect(await f.db.aiRequest.count()).toBe(0);
    expect((await f.readTask()).status).toBe('failed');
  });
  it('never applies partial invalid output and makes at most three requests', async () => {
    const f = await fixture(); model.create.mockResolvedValue(response({ translation: 'bad' }));
    for (let attempt = 0; attempt < 3; attempt++) {
      await f.db.aiTask.update({ where: { id: f.ticket.taskId }, data: { availableAt: new Date(0) } }); await f.run();
    }
    await f.run();
    expect(await f.readItem()).toMatchObject({ visible: true, aiStatus: 'failed', titleZh: null, decisionBy: 'rules' });
    expect((await f.readJob()).attempts).toBe(3); expect((await f.readTask()).status).toBe('failed'); expect(await f.usage()).toBe('3');
    await f.run(); expect(model.create).toHaveBeenCalledTimes(3);
  });
  it('keeps Simplified Chinese text without a separate translation call', async () => {
    const f = await fixture(); model.create.mockResolvedValue(response({ results: [{ id: f.key, ...result, language: 'zh-Hans', translation: null }] }));
    await f.run(); expect(await f.readItem()).toMatchObject({ aiLanguage: 'zh-Hans', titleZh: null, summaryZh: null, aiStatus: 'done' }); expect(model.create).toHaveBeenCalledOnce();
  });
  it('does not overwrite material edited during a request', async () => {
    const f = await fixture(); model.create.mockImplementation(async () => {
      await f.db.newsItem.update({ where: { id: f.item.id }, data: { analysisKey: null, title: 'Edited report', aiStatus: 'disabled' } });
      return response({ results: [{ id: f.key, ...result }] });
    });
    await f.run(); expect(await f.readItem()).toMatchObject({ title: 'Edited report', titleZh: null, aiStatus: 'disabled' }); expect((await f.readJob()).status).toBe('done');
  });
  it('does not replay interrupted paid tasks and skips orphaned materials', async () => {
    const f = await fixture(); await f.db.aiTask.update({ where: { id: f.ticket.taskId }, data: { status: 'running', owner: 'previous-process', leaseUntil: new Date(0), attempts: 1 } });
    await f.run(); expect((await f.readTask()).status).toBe('failed'); expect((await f.readTask()).errorJson).toContain('interrupted'); expect(model.create).not.toHaveBeenCalled();
    const orphan = await fixture(); await orphan.db.newsItem.update({ where: { id: orphan.item.id }, data: { analysisKey: null } }); await orphan.run();
    expect((await orphan.readJob()).status).toBe('obsolete'); expect(model.create).not.toHaveBeenCalled();
  });
  it('holds a queue lease longer than the model timeout', async () => {
    const f = await fixture(); let finish!: (value: unknown) => void;
    model.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const start = Date.now(); const pending = f.run(); await vi.waitFor(() => expect(model.create).toHaveBeenCalledOnce());
    expect((await f.readTask()).leaseUntil!.getTime()).toBeGreaterThanOrEqual(start + 180000);
    finish(response({ results: [{ id: f.key, ...result }] })); await pending;
    expect((await f.readTask()).leaseUntil).toBeNull(); expect(await f.usage()).toBe('1');
  });
  it('temporarily displays rule-matched news without making a request', async () => {
    const f = await fixture(); await f.service['showOverdueFallbacks']();
    expect(await f.readItem()).toMatchObject({ visible: true, aiStatus: 'pending', decisionBy: 'rules-waiting', updatedAt: f.originalTime }); expect(model.create).not.toHaveBeenCalled();
    await f.run(); expect((await f.readItem()).decisionBy).toBe('ai');
  });
  it('honors provider Retry-After before a rate-limited retry', async () => {
    const f = await fixture(); model.create.mockRejectedValue(APIError.generate(429, {}, undefined, { 'retry-after': '600' }));
    const before = Date.now(); await f.run(); expect((await f.readTask()).availableAt.getTime()).toBeGreaterThanOrEqual(before + 600000);
    await f.run(); expect(model.create).toHaveBeenCalledOnce();
  });
  it('saves unordered partial results by ID and retries only missing items', async () => {
    const f = await fixture(); const second = await f.db.newsItem.create({ data: { sourceId: 'reuters', topic: 'policy', title: 'China announces export restrictions', summary: 'Export rules', url: 'https://reuters.com/second', contentHash: 'second', eventKey: 'second', originalPublisher: 'Reuters' } });
    const key = analysisKey(second); await f.db.newsItem.update({ where: { id: second.id }, data: { analysisKey: key } });
    await f.db.newsAnalysis.create({ data: { key, inputJson: JSON.stringify(analysisInput(second)), historical: false, queuedTaskId: f.ticket.taskId } });
    await f.db.aiTask.update({ where: { id: f.ticket.taskId }, data: { payload: JSON.stringify({ keys: [f.key, key], chunkSize: 20 }) } });
    model.create.mockResolvedValueOnce(response({ results: [{ id: key, ...result }] })); await f.run();
    expect((await f.db.newsAnalysis.findUniqueOrThrow({ where: { key } })).status).toBe('done'); expect((await f.readJob()).status).toBe('pending');
    await f.db.aiTask.update({ where: { id: f.ticket.taskId }, data: { availableAt: new Date(0) } }); await f.run();
    const retry = JSON.parse(model.create.mock.calls[1][0].messages.at(-1).content).items;
    expect(retry.map((item: { id: string }) => item.id)).toEqual([f.key]); expect(await f.usage()).toBe('2');
  });
  it('keeps manual drafts private until publication and restores without reanalysis', async () => {
    const f = await fixture(); await f.db.aiTask.deleteMany(); await f.db.newsItem.deleteMany(); await f.db.newsAnalysis.deleteMany();
    const input = { title: 'China trade policy', summary: 'New rules', body: 'Saved original body', url: 'https://unidentified.example/story', publisher: '', publishedAt: '', images: ['https://images.example/photo.jpg'] };
    const saved = await f.service.saveManual(input); const id = saved.item.id;
    await expect(f.service.article(id)).rejects.toThrow('未公开');
    const ticket = await f.service.analyzeManual(id); expect(ticket).toHaveProperty('taskId'); await f.run();
    await expect(f.service.article(id)).rejects.toThrow('未公开'); await f.service.publishManual(id);
    expect(await f.service.article(id)).toMatchObject({ url: `/articles/${id}`, originalUrl: input.url, originalPublisher: '管理员录入', body: input.body });
    await f.service.displayState(id, { hiddenImages: true }); expect((await f.service.article(id)).images).toBe('[]');
    await f.service.displayState(id, { hiddenArticle: true }); await expect(f.service.article(id)).rejects.toThrow();
    await f.service.displayState(id, { hiddenArticle: false, hiddenImages: false }); await f.service.publishManual(id);
    expect((await f.service.article(id)).images).toBe(JSON.stringify(input.images)); expect(model.create).toHaveBeenCalledOnce();
    expect((await f.db.newsItem.findUniqueOrThrow({ where: { id } })).body).toBe(input.body);
  });
});
