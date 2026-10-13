// Real SQLite pipeline test with an in-process model stub. No external API calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const server = path.join(root, 'server');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-ai-check-'));
const filename = path.join(work, 'test.db');
fs.writeFileSync(filename, '');
const databaseUrl = `file:${filename.replaceAll('\\', '/')}`;
const prismaCli = path.join(path.dirname(require.resolve('prisma/package.json', { paths: [server] })), 'build/index.js');
const push = spawnSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate'], { cwd: server, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' });
if (push.status !== 0) throw new Error(`Isolated schema setup failed: ${push.stderr || push.stdout}`);
process.env.AI_ANALYSIS_ENABLED = 'true';
process.env.OPENAI_API_KEY = 'test-only-not-a-real-key';
process.env.TELEGRAM_ENABLED = 'true';
process.env.AI_DAILY_LIMIT = '100';
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [server] }));
const { NewsService } = require(path.join(server, 'dist/news/news.service.js'));
const { createHash } = require('node:crypto');
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
function report(overrides = {}) {
  const item = { title: 'Officials consider new measures', summary: 'New measures announced', url: 'https://reuters.com/world/fixture', originalPublisher: 'Reuters', originalUrl: null, author: null, topic: 'society', eventKey: 'fixture', publishedAt: new Date(), ...overrides };
  return { ...item, contentHash: createHash('sha256').update(JSON.stringify(item)).digest('hex') };
}
(async () => {
  try {
    for (const id of ['reuters', 'ap', 'tg-xhqcankao']) await db.newsSource.create({ data: { id, enabled: true } });
    const service = new NewsService(db);
    let calls = 0;
    let output = { version: 2, scoring: { relevance: 8, novelty: 7, audience: 8, quality: 7, importance: 'high', tags: ['贸易'] }, relation: 'related', topics: ['policy', 'economy'], type: 'report', language: 'en', reason: '模拟：涉及中国政策', translation: { title: '模拟政策快讯', summary: '模拟摘要。' } };
    service.ai.chat.completions.create = async () => { calls++; return { choices: [{ message: { content: JSON.stringify(output) } }] }; };
    const item = report();
    await service.store('reuters', item);
    assert.equal((await db.newsItem.findFirst()).visible, false);
    await service.analyzeNext();
    const done = await db.newsItem.findFirst();
    assert.equal(done.visible, true); assert.equal(done.decisionBy, 'ai'); assert.equal(done.titleZh, output.translation.title);
    await service.store('ap', { ...item, url: 'https://apnews.com/article/fixture' });
    await service.items({}); await service.items({}); await service.analyzeNext();
    assert.equal(calls, 1); assert.equal(await db.newsAnalysis.count(), 1);
    const after = await db.newsItem.findUnique({ where: { id: done.id } });
    assert.equal(after.updatedAt.getTime(), done.updatedAt.getTime());
    await service.save(done.id, true);
    await service.store('reuters', report({ ...item, contentHash: 'metadata-version', publishedAt: new Date(Date.now() - 5000) }));
    assert.equal(calls, 1); assert.equal((await db.newsItem.findUnique({ where: { id: done.id } })).saved, true);
    const policyItems = await service.items({ topic: 'economy' }); assert.equal(policyItems.total, 2);
    output = { ...output, language: 'zh-Hans', translation: null };
    await service.ingest({ channel: 'xhqcankao', messageId: 1, text: '中国发布新的贸易政策', publishedAt: new Date().toISOString(), links: ['https://www.reuters.com/world/china/fixture'] });
    await service.analyzeNext();
    const tg = await db.newsItem.findFirst({ where: { sourceId: 'tg-xhqcankao' } });
    assert.equal(tg.aiStatus, 'done'); assert.equal(tg.aiLanguage, 'zh-Hans'); assert.equal(tg.titleZh, null); assert.equal(calls, 2);
    const usageKey = `news-ai-usage-${new Date().toISOString().slice(0, 10)}`;
    await db.setting.upsert({ where: { key: usageKey }, create: { key: usageKey, value: '100' }, update: { value: '100' } });
    await service.store('reuters', report({ title: 'China announces a new trade policy', url: 'https://reuters.com/world/limited', summary: 'Budget fixture' }));
    await service.analyzeNext();
    const limited = await db.newsItem.findFirst({ where: { url: 'https://reuters.com/world/limited' } });
    assert.equal(limited.aiStatus, 'limited'); assert.equal(limited.visible, true); assert.equal(calls, 2);
    const restarted = new NewsService(db);
    restarted.ai.chat.completions.create = async () => { throw new Error('Completed/limited cache must not request again'); };
    assert.equal(await restarted.analyzeNext(), false);
    const status = await restarted.status(); assert.equal(status.aiDailyUsed, 100); assert.equal(status.aiLimited, 1);
    await assert.rejects(service.testAi({ title: item.title, summary: item.summary }), /额度已用尽/);
    await db.setting.update({ where: { key: usageKey }, data: { value: '97' } });
    const beforeTest = { items: await db.newsItem.findMany(), analyses: await db.newsAnalysis.findMany() };
    const tested = await service.testAi({ title: item.title, summary: item.summary });
    assert.equal(tested.ok, true); assert.equal(tested.usage.used, 98); assert.equal(calls, 3);
    assert.deepEqual(await db.newsItem.findMany(), beforeTest.items); assert.deepEqual(await db.newsAnalysis.findMany(), beforeTest.analyses);
    assert.equal(JSON.stringify(tested).includes(process.env.OPENAI_API_KEY), false);
    await db.setting.update({ where: { key: usageKey }, data: { value: '99' } });
    await service.store('reuters', report({ title: 'China approves a new trade agreement', url: 'https://reuters.com/world/concurrent', summary: 'Concurrency budget fixture' }));
    const concurrent = await Promise.allSettled([service.testAi({ title: item.title, summary: item.summary }), service.analyzeNext()]);
    for (const outcome of concurrent) if (outcome.status === 'rejected') assert.match(outcome.reason.message, /额度已用尽/);
    assert.equal(calls, 4); assert.equal((await db.setting.findUnique({ where: { key: usageKey } })).value, '100');
    console.log(JSON.stringify({ ok: true, externalCalls: 0, stubCalls: calls, checks: ['AI-first discovery', 'shared content cache', 'read without calls', 'metadata preserves cache', 'bookmark retention', 'multi-topic filter', 'Telegram unified analysis', 'Simplified Chinese skip translation', 'persistent budget', 'restart cache', 'AI test does not write news or cache', 'AI test and worker share atomic quota'] }));
  } finally {
    await db.$disconnect();
    // Only known files inside our newly created test directory are removed.
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      const target = `${filename}${suffix}`;
      if (path.dirname(target) !== work) throw new Error('Unexpected test file path');
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    fs.rmdirSync(work);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
