// Exercise the restored upstream modules with isolated SQLite and a local model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const dns = require('node:dns');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const serverDir = path.join(root, 'server');
require('../server/node_modules/ts-node').register({ transpileOnly: true, project: path.join(serverDir, 'tsconfig.json') });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-restored-'));
const filename = path.join(work, 'fixture.db');
const databaseUrl = `file:${filename.replaceAll('\\', '/')}`;
const lookup = dns.lookup;
dns.lookup = function(host, options, callback) {
  if (host !== 'model.radar.test') return lookup.apply(this, arguments);
  if (typeof options === 'function') { callback = options; options = {}; }
  queueMicrotask(() => options?.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4));
};
let calls = 0; let failModel = false; let profileAliases = ['trade'];
const model = http.createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  calls++;
  if (failModel) { res.writeHead(401); res.end('provider body must never be returned: test-only-key'); return; }
  const body = JSON.parse(text); const prompt = body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n'); const input = JSON.parse(body.messages.at(-1).content);
  let result;
  if (prompt.includes('涉华新闻编辑')) result = { summary: '模拟涉华日报', highlights: input.items.slice(0, 1).map(item => ({ newsId: item.id, summary: '贸易政策报道', whyImportant: '涉及贸易', affects: ['企业'] })), sections: [{ key: 'policy', items: input.items.map(item => ({ newsId: item.id, summary: item.summary })) }] };
  else if (prompt.includes('为关注词创建')) result = { type: 'topic', summary: '贸易关注档案', aliases: profileAliases, relatedCountries: ['中国'], relatedOrganizations: [], relatedCompanies: [], relatedPeople: [], tags: ['贸易'] };
  else {
    const analysis = { version: 2, relation: 'related', topics: ['policy', 'economy'], type: 'report', language: 'zh-Hans', reason: '涉及中国贸易', translation: null,
      scoring: { relevance: 9, novelty: 8, audience: 8, quality: 8, importance: 'high', tags: ['贸易'] } };
    result = input.items ? { results: input.items.map(item => ({ id: item.id, ...analysis })) } : analysis;
  }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(result) } }] }));
});

function runNode(args, env) {
  const result = spawnSync(process.execPath, args, { cwd: serverDir, env: { ...process.env, DATABASE_URL: databaseUrl, ...env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

(async () => {
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, { DATABASE_URL: databaseUrl, RADAR_MODE: 'news', COLLECTOR_ENABLED: 'false',
    CLIENT_URL: 'http://localhost:3420', SMTP_HOST: '', NOTIFY_EMAIL: '', OPENAI_API_KEY: 'test-only-key', OPENAI_BASE_URL: `http://model.radar.test:${model.address().port}/v1`, AI_ANALYSIS_ENABLED: 'true', AI_DAILY_LIMIT: '100' });
  // Keep the upgrade fixture tied to the schema before the news bridge.
  const oldSchema = spawnSync('git', ['show', '0b6e239:server/prisma/schema.prisma'], { cwd: root, encoding: 'utf8' });
  assert.equal(oldSchema.status, 0); const schema = path.join(work, 'old.prisma'); fs.writeFileSync(schema, oldSchema.stdout);
  fs.writeFileSync(filename, '');
  const prismaCli = path.join(path.dirname(require.resolve('prisma/package.json', { paths: [serverDir] })), 'build/index.js');
  runNode([prismaCli, 'db', 'push', '--schema', schema, '--skip-generate']);
  require('../server/node_modules/reflect-metadata');
  const { PrismaClient } = require('../server/node_modules/@prisma/client');
  const db = new PrismaClient();
  const { analysisKey } = require('../server/src/news/analysis');
  const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const yesterday = new Date(`${day}T12:00:00+08:00`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const firstSeenAt = new Date(Date.now() - 3600_000);
  const source = await db.newsSource.create({ data: { id: 'reuters' }, select: { id: true } });
  const keyword = await db.keyword.create({ data: { text: '贸易' } });
  await db.keyword.create({ data: { text: '中国' } });
  await db.entityCard.create({ data: { keywordId: keyword.id, name: keyword.text, summary: '旧档案', relatedData: '{}' } });
  await db.dailyDigest.create({ data: { date: day, data: '{"summary":"旧 AI 日报"}' } });
  await db.$executeRawUnsafe(`INSERT INTO "Hotspot" ("id","title","content","url","source","qualityScore","isCurated") VALUES ('legacy','旧 AI 行业消息','旧内容','https://example.org/legacy','rss_openai',90,true)`);
  const oldItem = { title: '中国贸易政策旧缓存', summary: '中国贸易新措施', url: 'https://reuters.com/old', originalPublisher: 'Reuters', originalUrl: null, author: null, topic: 'policy', eventKey: 'old-title', contentHash: 'old-content', publishedAt: yesterday };
  const oldKey = analysisKey(oldItem, 1);
  const oldResult = JSON.stringify({ version: 1, relation: 'related', topics: ['policy'], type: 'report', language: 'zh-Hans', reason: '涉华', translation: null });
  await db.$executeRaw`INSERT INTO "NewsAnalysis" ("key", "status", "inputJson", "resultJson", "analyzedAt", "updatedAt") VALUES (${oldKey}, 'done', ${JSON.stringify(oldItem)}, ${oldResult}, ${firstSeenAt}, ${firstSeenAt})`;
  const saved = { id: 'legacy-saved-news' };
  await db.$executeRaw`INSERT INTO "NewsItem" ("id", "sourceId", "title", "summary", "url", "originalPublisher", "topic", "eventKey", "contentHash", "publishedAt", "analysisKey", "aiStatus", "aiRelation", "saved", "firstSeenAt", "updatedAt") VALUES (${saved.id}, ${source.id}, ${oldItem.title}, ${oldItem.summary}, ${oldItem.url}, ${oldItem.originalPublisher}, ${oldItem.topic}, ${oldItem.eventKey}, ${oldItem.contentHash}, ${yesterday}, ${oldKey}, 'done', 'related', true, ${firstSeenAt}, ${firstSeenAt})`;
  await db.$disconnect();
  runNode([path.join(root, 'scripts/init-db.cjs')]);
  assert.equal(fs.readdirSync(work).filter(name => name.includes('.backup-')).length, 1);
  runNode([path.join(root, 'scripts/init-db.cjs')]);
  assert.equal(fs.readdirSync(work).filter(name => name.includes('.backup-')).length, 1);
  const { NestFactory } = require('../server/node_modules/@nestjs/core');
  const { AppModule } = require('../server/src/app.module');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.listen(process.argv.includes('--serve') ? 3421 : 0, '127.0.0.1');
  const { NewsService } = require('../server/src/news/news.service');
  const news = app.get(NewsService); news.onModuleDestroy();
  assert.throws(() => app.get(require('../server/src/scheduler/hotspot.scheduler').HotspotScheduler), 'news mode must not register legacy scheduler');
  const { NewsBridgeService } = require('../server/src/news/news-bridge.service');
  const bridge = app.get(NewsBridgeService);
  const database = app.get(require('../server/src/prisma/prisma.service').PrismaService);
  const runtime = app.get(require('../server/src/news/ai-runtime.service').AiRuntimeService);
  const base = await app.getUrl();
  let cookie = '';
  const call = async (route, options = {}) => {
    const response = await fetch(`${base}${route}`, { ...options, headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3420', ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
    const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null, text, cookie: response.headers.get('set-cookie') };
  };
  const waitTask = async ticket => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const task = await runtime.task(ticket.taskId);
      if (task.status === 'done' || task.status === 'failed') return task;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Task timed out: ${ticket.taskId}`);
  };
  try {
    assert.equal(calls, 0, 'startup must not reanalyze completed v1 caches');
    assert.equal((await database.newsItem.findUnique({ where: { id: saved.id } })).saved, true);
    assert.equal((await database.dailyDigest.findUnique({ where: { date: day } })).data, '{"summary":"旧 AI 日报"}');
    assert.equal((await call('/api/hotspots')).body.data.some(item => item.id === 'legacy'), false);
    assert.equal((await call('/api/settings')).status, 404);
    assert.equal((await call('/api/digest/generate', { method: 'POST' })).status, 401);
    const { hashPassword } = require('../server/src/admin/password');
    await database.adminAccount.create({ data: { id: 'admin', username: 'review-admin', passwordHash: await hashPassword('review-only-password-123') } });
    const login = await call('/api/news/admin/auth/login', { method: 'POST', body: JSON.stringify({ username: 'review-admin', password: 'review-only-password-123' }) });
    assert.equal(login.status, 201); assert.match(login.cookie, /HttpOnly/); assert.match(login.cookie, /SameSite=Strict/); cookie = login.cookie.split(';')[0];
    assert.equal((await call('/api/news/admin/config', { headers: { Cookie: '' } })).status, 401);
    assert.equal((await call('/api/news/admin/ai/key')).body.apiKey, 'test-only-key');
    await news.store('reuters', { ...oldItem, title: '中国贸易政策公布', url: 'https://reuters.com/new', eventKey: 'new-title', contentHash: 'new-content' });
    await news.enqueueAnalysis();
    const firstTask = await database.aiTask.findFirstOrThrow({ where: { kind: 'news' } });
    assert.equal((await waitTask({ taskId: firstTask.id })).status, 'done');
    const fresh = await database.newsItem.findFirst({ where: { url: 'https://reuters.com/new' } });
    assert.equal(fresh.aiStatus, 'done');
    assert.equal((await call('/api/hotspots')).body.data.find(item => item.newsItemId === fresh.id).relevance, 90);
    const scoringStates = (await call('/api/hotspots')).body.data;
    assert.equal(scoringStates.find(item => item.newsItemId === fresh.id).scoringStatus, 'scored');
    assert.equal(scoringStates.find(item => item.newsItemId === saved.id).scoringStatus, 'unscored');
    assert.equal(await database.newsKeywordMatch.count({ where: { newsItemId: fresh.id } }), 2);
    assert.equal((await call('/api/curated?period=week')).body.items.length, 2);
    assert.equal((await call('/api/curated?period=week&category=economy&search=政策')).body.items.length, 1);
    assert.equal((await call('/api/hotspots?category=economy')).body.data.length, 1);
    const count = await database.hotspot.count(); await bridge.rebuild(); await bridge.rebuild();
    assert.equal(await database.hotspot.count(), count);
    const notices = await database.notification.count(); await bridge.announce(fresh.id); assert.equal(await database.notification.count(), notices);
    const beforeRead = calls;
    for (const route of ['/api/hotspots', '/api/curated', '/api/entities', '/api/agent/search?q=贸易', '/api/agent/stats', '/api/agent/rss/all.xml']) {
      const response = await fetch(`${base}${route}`); assert.equal(response.status, 200, route);
    }
    assert.equal(calls, beforeRead);
    const headers = {};
    assert.equal((await call(`/api/keywords/${keyword.id}`, { method: 'PUT', headers, body: JSON.stringify({ text: '未出现的词' }) })).status, 200);
    assert.equal(await database.newsKeywordMatch.count({ where: { keywordId: keyword.id } }), 0);
    await call(`/api/keywords/${keyword.id}`, { method: 'PUT', headers, body: JSON.stringify({ text: keyword.text }) });
    assert.equal(await database.newsKeywordMatch.count({ where: { keywordId: keyword.id } }), 2);
    await call(`/api/keywords/${keyword.id}/toggle`, { method: 'PATCH', headers });
    assert.equal(await database.newsKeywordMatch.count({ where: { keywordId: keyword.id } }), 0);
    await call(`/api/keywords/${keyword.id}/toggle`, { method: 'PATCH', headers });
    assert.equal(await database.newsKeywordMatch.count({ where: { keywordId: keyword.id } }), 2);
    assert.equal(calls, beforeRead, 'keyword edits and historical matches must not call AI');
    assert.equal(await database.notification.count(), notices);
    assert.equal((await call(`/api/digest/generate?date=${day}`, { method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example' } })).status, 403);
    const invalidDigest = await call('/api/digest/generate?date=2026-99-99', { method: 'POST', headers });
    assert.equal((await waitTask(invalidDigest.body)).status, 'failed');
    assert.equal((await call('/api/keywords', { method: 'POST', headers, body: JSON.stringify({ text: '外交' }) })).status, 201);
    const added = await database.keyword.findUnique({ where: { text: '外交' } });
    for (let attempt = 0; attempt < 100; attempt++) {
      const profile = await database.newsEntityProfile.findUnique({ where: { keywordId: added.id } });
      if (profile && JSON.parse(profile.data).generationStatus === 'ai') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(JSON.parse((await database.newsEntityProfile.findUnique({ where: { keywordId: added.id } })).data).generationStatus, 'ai', 'new keywords must generate profiles even after bridge backfill');
    const addedCard = await database.entityCard.findUnique({ where: { keywordId: added.id } });
    profileAliases = ['新措施'];
    assert.equal((await waitTask((await call(`/api/entities/${addedCard.id}/refresh`, { method: 'POST', headers })).body)).status, 'done');
    assert.equal(await database.newsKeywordMatch.count({ where: { keywordId: added.id } }), 2, 'updated profile aliases must rebuild historical matches');
    assert.equal(await database.notification.count(), notices, 'historical alias matches must not notify');
    profileAliases = ['trade'];
    assert.equal((await waitTask((await call(`/api/digest/generate?date=${day}`, { method: 'POST', headers })).body)).status, 'done');
    const digest = (await call(`/api/digest/${day}`)).body; assert.equal(digest.data.version, 2); assert.equal(digest.data.generationStatus, 'ai');
    const beforeSchedule = calls; await app.get(require('../server/src/digest/digest.service').DigestService).generateDigest(day, false); assert.equal(calls, beforeSchedule);
    const card = await database.entityCard.findUnique({ where: { keywordId: keyword.id } });
    assert.equal((await waitTask((await call(`/api/entities/${card.id}/refresh`, { method: 'POST', headers })).body)).status, 'done');
    assert.equal((await call(`/api/entities/${card.id}`)).body.relatedData.includes('relatedCountries'), true);
    const stable = (await database.newsDigest.findUnique({ where: { date: day } })).data;
    failModel = true;
    const failed = await call(`/api/digest/generate?date=${day}`, { method: 'POST', headers });
    const failedTask = await waitTask(failed.body); assert.equal(failedTask.status, 'failed'); assert.equal(JSON.stringify(failedTask).includes('test-only-key'), false);
    assert.equal((await database.newsDigest.findUnique({ where: { date: day } })).data, stable);
    const stableProfile = (await database.newsEntityProfile.findUnique({ where: { keywordId: keyword.id } })).data;
    const beforeFailedProfile = calls;
    const failedProfile = await call(`/api/entities/${card.id}/refresh`, { method: 'POST', headers });
    assert.equal((await waitTask(failedProfile.body)).status, 'failed'); assert.equal(failedProfile.text.includes('test-only-key'), false);
    assert.equal(calls, beforeFailedProfile + 1, 'profile failures must not retry');
    assert.equal((await database.newsEntityProfile.findUnique({ where: { keywordId: keyword.id } })).data, stableProfile);
    const failedKeyword = (await call('/api/keywords', { method: 'POST', headers, body: JSON.stringify({ text: '失败档案' }) })).body;
    let failedInitialProfile;
    for (let attempt = 0; attempt < 50; attempt++) {
      failedInitialProfile = await database.newsEntityProfile.findUnique({ where: { keywordId: failedKeyword.id } });
      if (failedInitialProfile && JSON.parse(failedInitialProfile.data).generationStatus === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(JSON.parse(failedInitialProfile.data).generationStatus, 'failed');
    assert.equal(failedInitialProfile.data.includes('401'), true);
    assert.equal(failedInitialProfile.data.includes('test-only-key'), false);
    failModel = false;
    const beforeFilter = calls;
    await news.configureRules([{ id: 'hide', enabled: true, field: 'titleContains', value: '政策公布', sourceId: '' }]);
    assert.equal((await call('/api/hotspots')).body.data.some(item => item.newsItemId === fresh.id), false);
    assert.equal((await call('/api/curated?period=week')).body.total, 1);
    assert.equal((await call('/api/agent/search?q=政策公布')).body.length, 0);
    assert.equal(JSON.stringify((await call(`/api/digest/${day}`)).body).includes('政策公布'), false);
    assert.equal(JSON.stringify((await call(`/api/agent/digest?date=${day}`)).body).includes('政策公布'), false);
    assert.equal(calls, beforeFilter);
    await news.configureRules([]);
    const unchanged = await database.newsItem.findUnique({ where: { id: saved.id } });
    assert.equal(unchanged.saved, true); assert.equal(unchanged.firstSeenAt.getTime(), firstSeenAt.getTime());
    const copy = await database.newsItem.create({ data: { ...oldItem, title: fresh.title, sourceId: 'ap', url: 'https://apnews.com/duplicate', eventKey: fresh.eventKey, contentHash: 'duplicate', analysisKey: fresh.analysisKey, aiStatus: 'done', aiRelation: 'related' } });
    await database.$transaction(tx => bridge.sync(tx, copy.id));
    assert.equal(await database.hotspot.count({ where: { clusterKey: fresh.eventKey, isClusterMain: true } }), 1);
    await database.$transaction(async tx => {
      await tx.newsItem.update({ where: { id: copy.id }, data: { title: '编辑后的报道', eventKey: 'edited-title', visible: false } });
      await bridge.sync(tx, copy.id);
    });
    assert.equal(await database.hotspot.count({ where: { clusterKey: fresh.eventKey, isClusterMain: true } }), 1, 'editing a main must restore the previous title group');
    const manualInput = { title: '中国贸易政策手动报道', summary: '中国新增出口措施', body: '手动录入完整正文', url: 'https://unidentified.example/manual', publisher: '', publishedAt: yesterday.toISOString(), images: ['https://images.example/review.jpg'] };
    const createdManual = await call('/api/news/admin/items', { method: 'POST', body: JSON.stringify(manualInput) });
    assert.equal(createdManual.status, 201); const manual = createdManual.body.item;
    assert.equal(manual.publicationStatus, 'draft'); assert.equal((await call(`/api/news/items/${manual.id}`)).status, 404);
    const analyzedManual = await call(`/api/news/admin/items/${manual.id}/analyze`, { method: 'POST', body: '{}' });
    assert.equal((await waitTask(analyzedManual.body)).status, 'done');
    assert.equal((await call(`/api/news/items/${manual.id}`)).status, 404, 'analysis must not publish a draft');
    const beforePublish = calls;
    assert.equal((await call(`/api/news/admin/items/${manual.id}/publish`, { method: 'POST', body: '{}' })).status, 201);
    const publishedManual = (await call(`/api/news/items/${manual.id}`)).body;
    assert.equal(publishedManual.url, `/articles/${manual.id}`); assert.equal(publishedManual.originalPublisher, '管理员录入'); assert.equal(publishedManual.body, manualInput.body);
    assert.equal((await call('/api/news/admin/items', { method: 'POST', body: JSON.stringify(manualInput) })).body.item.id, manual.id);
    const manualNotices = await database.notification.count();
    await call(`/api/news/admin/items/${manual.id}/display`, { method: 'PATCH', body: JSON.stringify({ hiddenImages: true }) });
    assert.equal((await call(`/api/news/items/${manual.id}`)).body.images, '[]');
    assert.equal(JSON.stringify((await call('/api/curated?period=week')).body).includes('https://images.example/review.jpg'), false);
    assert.equal((await database.newsItem.findUniqueOrThrow({ where: { id: manual.id } })).images, JSON.stringify(manualInput.images));
    assert.equal(calls, beforePublish, 'publish, preview, duplicate and hide operations must not call a model');
    assert.equal((await waitTask((await call(`/api/digest/generate?date=${day}`, { method: 'POST' })).body)).status, 'done');
    await call(`/api/news/admin/items/${manual.id}/display`, { method: 'PATCH', body: JSON.stringify({ hiddenArticle: true }) });
    for (const route of ['/api/hotspots', '/api/curated?period=week', '/api/news/items', '/api/agent/curated?period=week', `/api/digest/${day}`]) {
      assert.equal(JSON.stringify((await call(route)).body).includes(manual.id), false, route);
    }
    assert.equal((await call(`/api/news/items/${manual.id}`)).status, 404);
    assert.equal((await call(`/api/digest/${day}`)).body.data.summary, '', 'digest overview using hidden material must be removed');
    await call(`/api/news/admin/items/${manual.id}/display`, { method: 'PATCH', body: JSON.stringify({ hiddenArticle: false, hiddenImages: false }) });
    await call(`/api/news/admin/items/${manual.id}/publish`, { method: 'POST', body: '{}' });
    assert.equal(await database.notification.count(), manualNotices, 'restoring must not replay an alert');
    assert.deepEqual((await call('/api/curated?period=week&source=manual')).body.items.map(item => item.newsItemId), [manual.id]);
    assert.deepEqual((await call('/api/agent/curated?period=week&source=manual')).body.map(item => item.newsItemId), [manual.id]);
    const logs = await call(`/api/news/admin/logs?date=${day}`);
    assert.equal(logs.status, 200); assert.ok(logs.body.total > 0); assert.equal(logs.body.quotaTimeZone, 'UTC');
    assert.equal(logs.text.includes('test-only-key'), false); assert.equal(logs.text.includes('review-only-password-123'), false); assert.equal(logs.text.includes(manualInput.body), false);
    const usageKey = `news-ai-usage-${new Date().toISOString().slice(0, 10)}`;
    await database.setting.upsert({ where: { key: usageKey }, create: { key: usageKey, value: '99' }, update: { value: '99' } });
    const quotaCalls = calls;
    await Promise.allSettled([runtime.requestJson('fixture', {}), runtime.requestJson('fixture', {}), runtime.requestJson('fixture', {})]);
    assert.equal(calls - quotaCalls, 1); assert.equal((await database.setting.findUnique({ where: { key: usageKey } })).value, '100');
    const fallbackNotices = await database.notification.count();
    const beforeLimited = calls;
    await news.store('reuters', { ...oldItem, title: '中国贸易规则兜底报道', summary: '中国贸易新闻', url: 'https://reuters.com/limited', eventKey: 'limited-title', contentHash: 'limited-content' });
    await news.enqueueAnalysis();
    const limitedTask = await database.aiTask.findFirstOrThrow({ where: { kind: 'news' }, orderBy: { createdAt: 'desc' } });
    await waitTask({ taskId: limitedTask.id });
    for (let attempt = 0; attempt < 250; attempt++) {
      if ((await database.aiTask.findUniqueOrThrow({ where: { id: limitedTask.id } })).failureHandled) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const limited = await database.newsItem.findFirst({ where: { url: 'https://reuters.com/limited' } });
    assert.equal(limited.aiStatus, 'failed'); assert.equal(limited.visible, true); assert.equal(calls, beforeLimited);
    assert.equal((await call('/api/hotspots')).body.data.find(item => item.newsItemId === limited.id).scoringStatus, 'rules');
    assert.equal(await database.notification.count(), fallbackNotices + 1, 'new fallback reports must notify once');
    await bridge.announce(limited.id);
    assert.equal(await database.notification.count(), fallbackNotices + 1);
    await call('/api/news/admin/auth/logout', { method: 'POST', body: '{}' });
    assert.equal((await call('/api/news/admin/config')).status, 401, 'logout must invalidate the stored session');
    cookie = (await call('/api/news/admin/auth/login', { method: 'POST', body: JSON.stringify({ username: 'review-admin', password: 'review-only-password-123' }) })).cookie.split(';')[0];
    await database.adminSession.updateMany({ data: { expiresAt: new Date(0) } });
    assert.equal((await call('/api/news/admin/config')).body.code, 'session_expired');
    for (let attempt = 0; attempt < 5; attempt++) assert.equal((await call('/api/news/admin/auth/login', { method: 'POST', body: JSON.stringify({ username: 'review-admin', password: 'wrong-review-password' }) })).status, 401);
    assert.equal((await call('/api/news/admin/auth/login', { method: 'POST', body: JSON.stringify({ username: 'review-admin', password: 'review-only-password-123' }) })).status, 429);
    await database.adminLoginAttempt.deleteMany();
    if (process.argv.includes('--serve')) {
      await database.newsSource.updateMany({ data: { enabled: false } });
      await database.setting.update({ where: { key: usageKey }, data: { value: '0' } });
      console.log(JSON.stringify({ ok: true, frontend: 'http://localhost:3420', backend: base, work, checks: ['safe upgrade', 'v1 cache', 'projection', 'keywords', 'all routes', 'quota', 'errors', 'data preservation'] }));
      await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); process.stdin.on('data', data => { if (data.toString().trim() === 'stop') resolve(); }); });
      process.stdin.removeAllListeners('data');
      process.stdin.pause();
    } else console.log(JSON.stringify({ ok: true, checks: ['safe upgrade', 'v1 cache reuse', 'no legacy data', 'no legacy scheduler', 'projection idempotence', 'multiple keywords', 'no reader calls', 'digest', 'profile', 'shared quota', 'error privacy', 'data preservation', 'manual draft/publish', 'article/image visibility', 'no replay notifications', 'logs privacy', 'session/logout/expiry/rate-limit'] }));
  } finally { await app.close(); await new Promise(resolve => model.close(resolve)); dns.lookup = lookup; }
})().catch(error => { console.error(error); model.close(); process.exitCode = 1; });
