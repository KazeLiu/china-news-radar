import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewsService } from './news.service';
import { PrismaService } from '../prisma/prisma.service';
import { analysisKey } from './analysis';

const result = { version: 1, relation: 'related', topics: ['policy', 'economy'], type: 'report', language: 'en', reason: '中国相关政策', translation: { title: '中国相关政策', summary: '新规定。' } };
function fixture(usage = '0') {
  vi.stubEnv('AI_ANALYSIS_ENABLED', 'true'); vi.stubEnv('OPENAI_API_KEY', 'test-only-key'); vi.stubEnv('AI_DAILY_LIMIT', '100');
  const originalTime = new Date('2026-10-10T00:00:00Z');
  const item = { id: '1', title: 'Officials impose new restrictions', summary: 'New rules', url: 'https://reuters.com/world/story', updatedAt: originalTime, firstSeenAt: originalTime, saved: true, visible: false, analysisKey: '' };
  item.analysisKey = analysisKey(item);
  const job: Record<string, any> = { key: item.analysisKey, status: 'pending', attempts: 0, inputJson: JSON.stringify({ title: item.title, summary: item.summary }), resultJson: null, retryAt: null, leaseUntil: null };
  const settings = new Map<string, string>(); const usageKey = `news-ai-usage-${new Date().toISOString().slice(0, 10)}`; settings.set(usageKey, usage);
  const updateJob = (data: Record<string, any>) => { const copy = { ...data }; if (copy.attempts?.increment) copy.attempts = job.attempts + copy.attempts.increment; Object.assign(job, copy); return { ...job }; };
  const db: Record<string, any> = {
    newsAnalysis: {
      findFirst: vi.fn(async () => ['pending', 'processing', 'limited'].includes(job.status) || (job.status === 'failed' && job.attempts < 3 && job.retryAt && job.retryAt <= new Date()) ? { ...job } : null),
      update: vi.fn(async ({ data }) => updateJob(data)),
      updateMany: vi.fn(async ({ where, data }) => job.status === where.status && job.attempts === where.attempts ? (updateJob(data), { count: 1 }) : { count: 0 }),
      findUniqueOrThrow: vi.fn(async () => ({ ...job })),
    },
    newsItem: { count: vi.fn(async () => Number(item.analysisKey === job.key)), findMany: vi.fn(async () => item.analysisKey === job.key ? [{ ...item }] : []),
      updateMany: vi.fn(async ({ where, data }) => { if (item.analysisKey !== where.analysisKey) return { count: 0 }; Object.assign(item, data); return { count: 1 }; }) },
    setting: { findUnique: vi.fn(async ({ where }) => settings.has(where.key) ? { value: settings.get(where.key) } : null),
      upsert: vi.fn(async ({ where, create, update }) => { settings.set(where.key, settings.has(where.key) ? update.value : create.value); }) },
  };
  db.$transaction = vi.fn(async callback => callback(db));
  const service = new NewsService(db as unknown as PrismaService);
  const completion = vi.spyOn(service['ai']!.chat.completions, 'create').mockResolvedValue({ choices: [{ message: { content: JSON.stringify(result) } }] } as never);
  return { db, item, job, service, completion, settings, usageKey, originalTime };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('persistent unified AI worker', () => {
  it('analyzes and translates with one request, preserving original dates and bookmark', async () => {
    const f = fixture(); await f.service['analyzeNext']();
    expect(f.item).toMatchObject({ visible: true, decisionBy: 'ai', aiStatus: 'done', titleZh: '中国相关政策', saved: true, updatedAt: f.originalTime, firstSeenAt: f.originalTime });
    expect(f.settings.get(f.usageKey)).toBe('1'); expect(f.completion).toHaveBeenCalledOnce();
    expect(await f.service['analyzeNext']()).toBe(false); expect(f.completion).toHaveBeenCalledOnce();
  });
  it('uses the stored budget across new service instances and falls back when it is exhausted', async () => {
    const f = fixture('100'); f.item.title = 'China trade policy';
    await f.service['analyzeNext']();
    expect(f.completion).not.toHaveBeenCalled(); expect(f.item).toMatchObject({ visible: true, decisionBy: 'rules', aiStatus: 'limited' });
    expect(f.job.retryAt.toISOString()).toMatch(/T00:00:00.000Z$/); expect(f.settings.get(f.usageKey)).toBe('100');
  });
  it('invalid model output does not apply a partial translation and has bounded retry attempts', async () => {
    const f = fixture(); f.item.title = 'China trade policy'; f.completion.mockResolvedValue({ choices: [{ message: { content: '{"translation":"bad"}' } }] } as never);
    for (let attempt = 0; attempt < 3; attempt++) { f.job.retryAt = new Date(0); await f.service['analyzeNext'](); }
    expect(f.item).toMatchObject({ visible: true, aiStatus: 'failed', titleZh: null, decisionBy: 'rules' });
    expect(f.job.attempts).toBe(3); expect(f.job.retryAt).toBeNull(); expect(f.settings.get(f.usageKey)).toBe('3');
    expect(await f.service['analyzeNext']()).toBe(false);
  });
  it('keeps Simplified Chinese original text without a separate translation call', async () => {
    const f = fixture(); f.completion.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ ...result, language: 'zh-Hans', translation: null }) } }] } as never);
    await f.service['analyzeNext'](); expect(f.item).toMatchObject({ aiLanguage: 'zh-Hans', titleZh: null, summaryZh: null, aiStatus: 'done' }); expect(f.completion).toHaveBeenCalledOnce();
  });
  it('does not overwrite an edited report with the old version returned mid-request', async () => {
    const f = fixture(); f.completion.mockImplementation(async () => { f.item.analysisKey = 'new-version'; f.item.title = 'Edited report'; return { choices: [{ message: { content: JSON.stringify(result) } }] } as never; });
    await f.service['analyzeNext'](); expect(f.item.title).toBe('Edited report'); expect(f.item).not.toHaveProperty('titleZh'); expect(f.job.status).toBe('done');
  });
  it('recovers an expired lease and skips orphaned content without paying for it', async () => {
    const f = fixture(); f.job.status = 'processing'; f.job.leaseUntil = new Date(0); f.job.attempts = 1;
    await f.service['analyzeNext'](); expect(f.job.status).toBe('done'); expect(f.job.attempts).toBe(2);
    const orphan = fixture(); orphan.item.analysisKey = 'new-version'; await orphan.service['analyzeNext'](); expect(orphan.completion).not.toHaveBeenCalled(); expect(orphan.job.status).toBe('obsolete');
  });
  it('keeps the processing lease alive longer than the model timeout', async () => {
    const f = fixture(); let finish!: (value: unknown) => void;
    f.completion.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
    const start = Date.now(); const pending = f.service['analyzeNext']();
    await vi.waitFor(() => expect(f.job.status).toBe('processing'));
    expect(f.job.leaseUntil.getTime()).toBeGreaterThanOrEqual(start + 150_000);
    finish({ choices: [{ message: { content: JSON.stringify(result) } }] }); await pending;
    expect(f.job.status).toBe('done'); expect(f.job.leaseUntil).toBeNull(); expect(f.settings.get(f.usageKey)).toBe('1');
  });
  it('temporarily displays rule-matched news when the model queue takes too long', async () => {
    const f = fixture(); f.item.title = 'China announces trade restrictions';
    await f.service['showOverdueFallbacks']();
    expect(f.item).toMatchObject({ visible: true, aiStatus: 'pending', decisionBy: 'rules-waiting', updatedAt: f.originalTime });
    expect(f.completion).not.toHaveBeenCalled();
    await f.service['analyzeNext'](); expect(f.item).toMatchObject({ visible: true, aiStatus: 'done', decisionBy: 'ai' });
  });
  it('honors a model rate-limit retry delay instead of immediately calling again', async () => {
    const f = fixture(); f.completion.mockRejectedValue({ status: 429, headers: { 'retry-after': '600' } });
    const before = Date.now(); await f.service['analyzeNext']();
    expect(f.job.retryAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
    expect(await f.service['analyzeNext']()).toBe(false); expect(f.completion).toHaveBeenCalledOnce();
  });
});
