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
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-restored-'));
const filename = path.join(work, 'fixture.db');
const databaseUrl = `file:${filename.replaceAll('\\', '/')}`;
const adminToken = 'radar-integration-token-only-00000000';
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
  if (failModel) { res.writeHead(500); res.end('provider body must never be returned: test-only-key'); return; }
  const body = JSON.parse(text); const prompt = body.messages[0].content; const input = JSON.parse(body.messages[1].content);
  let result;
  if (prompt.includes('涉华新闻编辑')) result = { summary: '模拟涉华日报', highlights: input.items.slice(0, 1).map(item => ({ newsId: item.id, summary: '贸易政策报道', whyImportant: '涉及贸易', affects: ['企业'] })), sections: [{ key: 'policy', items: input.items.map(item => ({ newsId: item.id, summary: item.summary })) }] };
  else if (prompt.includes('为关注词创建')) result = { type: 'topic', summary: '贸易关注档案', aliases: profileAliases, relatedCountries: ['中国'], relatedOrganizations: [], relatedCompanies: [], relatedPeople: [], tags: ['贸易'] };
  else result = { version: 2, relation: 'related', topics: ['policy', 'economy'], type: 'report', language: 'zh-Hans', reason: '涉及中国贸易', translation: null,
    scoring: { relevance: 9, novelty: 8, audience: 8, quality: 8, importance: 'high', tags: ['贸易'] } };
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(result) } }] }));
});

function runNode(args, env) {
  const result = spawnSync(process.execPath, args, { cwd: serverDir, env: { ...process.env, DATABASE_URL: databaseUrl, ...env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

(async () => {
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, { DATABASE_URL: databaseUrl, RADAR_MODE: 'news', COLLECTOR_ENABLED: 'false', ADMIN_TOKEN: adminToken,
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
  const { analysisKey } = require('../server/dist/news/analysis');
  const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const yesterday = new Date(`${day}T12:00:00+08:00`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const firstSeenAt = new Date(Date.now() - 3600_000);
  const source = await db.newsSource.create({ data: { id: 'reuters' } });
  const keyword = await db.keyword.create({ data: { text: '贸易' } });
  await db.keyword.create({ data: { text: '中国' } });
  await db.entityCard.create({ data: { keywordId: keyword.id, name: keyword.text, summary: '旧档案', relatedData: '{}' } });
  await db.dailyDigest.create({ data: { date: day, data: '{"summary":"旧 AI 日报"}' } });
  await db.$executeRawUnsafe(`INSERT INTO "Hotspot" ("id","title","content","url","source","qualityScore","isCurated") VALUES ('legacy','旧 AI 行业消息','旧内容','https://example.org/legacy','rss_openai',90,true)`);
  const oldItem = { title: '中国贸易政策旧缓存', summary: '中国贸易新措施', url: 'https://reuters.com/old', originalPublisher: 'Reuters', originalUrl: null, author: null, topic: 'policy', eventKey: 'old-title', contentHash: 'old-content', publishedAt: yesterday };
  const oldKey = analysisKey(oldItem, 1);
  await db.newsAnalysis.create({ data: { key: oldKey, status: 'done', inputJson: JSON.stringify(oldItem), resultJson: JSON.stringify({ version: 1, relation: 'related', topics: ['policy'], type: 'report', language: 'zh-Hans', reason: '涉华', translation: null }), analyzedAt: firstSeenAt } });
  const saved = await db.newsItem.create({ data: { ...oldItem, sourceId: source.id, analysisKey: oldKey, aiStatus: 'done', aiRelation: 'related', saved: true, firstSeenAt } });
  await db.$disconnect();
  runNode([path.join(root, 'scripts/init-db.cjs')]);
  assert.equal(fs.readdirSync(work).filter(name => name.includes('.backup-')).length, 1);
  runNode([path.join(root, 'scripts/init-db.cjs')]);
  assert.equal(fs.readdirSync(work).filter(name => name.includes('.backup-')).length, 1);
  const { NestFactory } = require('../server/node_modules/@nestjs/core');
  const { AppModule } = require('../server/dist/app.module');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.listen(process.argv.includes('--serve') ? 3421 : 0, '127.0.0.1');
  const { NewsService } = require('../server/dist/news/news.service');
  const news = app.get(NewsService); news.onModuleDestroy();
  assert.throws(() => app.get(require('../server/dist/scheduler/hotspot.scheduler').HotspotScheduler), 'news mode must not register legacy scheduler');
  const { NewsBridgeService } = require('../server/dist/news/news-bridge.service');
  const bridge = app.get(NewsBridgeService);
  const database = app.get(require('../server/dist/prisma/prisma.service').PrismaService);
  const base = await app.getUrl();
  const call = async (route, options = {}) => {
    const response = await fetch(`${base}${route}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
    const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null, text };
  };
  try {
    assert.equal(calls, 0, 'startup must not reanalyze completed v1 caches');
    assert.equal((await database.newsItem.findUnique({ where: { id: saved.id } })).saved, true);
    assert.equal((await database.dailyDigest.findUnique({ where: { date: day } })).data, '{"summary":"旧 AI 日报"}');
    assert.equal((await call('/api/hotspots')).body.data.some(item => item.id === 'legacy'), false);
    assert.equal((await call('/api/settings')).status, 404);
    assert.equal((await call('/api/digest/generate', { method: 'POST' })).status, 401);
    await news.store('reuters', { ...oldItem, title: '中国贸易政策公布', url: 'https://reuters.com/new', eventKey: 'new-title', contentHash: 'new-content' });
    await news.analyzeNext();
    const fresh = await database.newsItem.findFirst({ where: { url: 'https://reuters.com/new' } });
    assert.equal(fresh.aiStatus, 'done');
    assert.equal((await call('/api/hotspots')).body.data.find(item => item.newsItemId === fresh.id).relevance, 90);
    const scoringStates = (await call('/api/hotspots')).body.data;
    assert.equal(scoringStates.find(item => item.newsItemId === fresh.id).scoringStatus, 'scored');
    assert.equal(scoringStates.find(item => item.newsItemId === saved.id).scoringStatus, 'unscored');
    assert.equal(await database.newsKeywordMatch.count({ where: { newsItemId: fresh.id } }), 2);
    assert.equal((await call('/api/curated?period=week')).body.items.length, 1);
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
    const headers = { 'X-Admin-Token': adminToken };
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
    assert.equal((await call('/api/digest/generate?date=2026-99-99', { method: 'POST', headers })).status, 400);
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
    assert.equal((await call(`/api/entities/${addedCard.id}/refresh`, { method: 'POST', headers })).status, 200);
    assert.equal(await database.newsKeywordMatch.count({ where: { keywordId: added.id } }), 2, 'updated profile aliases must rebuild historical matches');
    assert.equal(await database.notification.count(), notices, 'historical alias matches must not notify');
    profileAliases = ['trade'];
    assert.equal((await call(`/api/digest/generate?date=${day}`, { method: 'POST', headers })).status, 201);
    const digest = (await call(`/api/digest/${day}`)).body; assert.equal(digest.data.version, 2); assert.equal(digest.data.generationStatus, 'ai');
    const beforeSchedule = calls; await app.get(require('../server/dist/digest/digest.service').DigestService).generateDigest(day, false); assert.equal(calls, beforeSchedule);
    const card = await database.entityCard.findUnique({ where: { keywordId: keyword.id } });
    assert.equal((await call(`/api/entities/${card.id}/refresh`, { method: 'POST', headers })).status, 200);
    assert.equal((await call(`/api/entities/${card.id}`)).body.relatedData.includes('relatedCountries'), true);
    const stable = (await database.newsDigest.findUnique({ where: { date: day } })).data;
    failModel = true;
    const failed = await call(`/api/digest/generate?date=${day}`, { method: 'POST', headers });
    assert.equal(failed.status, 400); assert.equal(failed.text.includes('test-only-key'), false);
    assert.equal((await database.newsDigest.findUnique({ where: { date: day } })).data, stable);
    const stableProfile = (await database.newsEntityProfile.findUnique({ where: { keywordId: keyword.id } })).data;
    const beforeFailedProfile = calls;
    const failedProfile = await call(`/api/entities/${card.id}/refresh`, { method: 'POST', headers });
    assert.equal(failedProfile.status, 400); assert.equal(failedProfile.text.includes('test-only-key'), false);
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
    assert.equal(failedInitialProfile.data.includes('提供商服务出错'), true);
    assert.equal(failedInitialProfile.data.includes('test-only-key'), false);
    failModel = false;
    const beforeFilter = calls;
    await news.configureRules([{ id: 'hide', enabled: true, field: 'titleContains', value: '政策公布', sourceId: '' }]);
    assert.equal((await call('/api/hotspots')).body.data.some(item => item.newsItemId === fresh.id), false);
    assert.equal((await call('/api/curated?period=week')).body.total, 0);
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
    const usageKey = `news-ai-usage-${new Date().toISOString().slice(0, 10)}`;
    await database.setting.upsert({ where: { key: usageKey }, create: { key: usageKey, value: '99' }, update: { value: '99' } });
    const runtime = app.get(require('../server/dist/news/ai-runtime.service').AiRuntimeService);
    const quotaCalls = calls;
    await Promise.allSettled([runtime.requestJson('fixture', {}), runtime.requestJson('fixture', {}), runtime.requestJson('fixture', {})]);
    assert.equal(calls - quotaCalls, 1); assert.equal((await database.setting.findUnique({ where: { key: usageKey } })).value, '100');
    const fallbackNotices = await database.notification.count();
    const beforeLimited = calls;
    await news.store('reuters', { ...oldItem, title: '中国贸易规则兜底报道', summary: '中国贸易新闻', url: 'https://reuters.com/limited', eventKey: 'limited-title', contentHash: 'limited-content' });
    await news.analyzeNext();
    const limited = await database.newsItem.findFirst({ where: { url: 'https://reuters.com/limited' } });
    assert.equal(limited.aiStatus, 'limited'); assert.equal(limited.visible, true); assert.equal(calls, beforeLimited);
    assert.equal((await call('/api/hotspots')).body.data.find(item => item.newsItemId === limited.id).scoringStatus, 'rules');
    assert.equal(await database.notification.count(), fallbackNotices + 1, 'new fallback reports must notify once');
    await bridge.announce(limited.id);
    assert.equal(await database.notification.count(), fallbackNotices + 1);
    if (process.argv.includes('--serve')) {
      await database.newsSource.updateMany({ data: { enabled: false } });
      await database.setting.update({ where: { key: usageKey }, data: { value: '0' } });
      console.log(JSON.stringify({ ok: true, frontend: 'http://localhost:3420', backend: base, work, adminToken, checks: ['safe upgrade', 'v1 cache', 'projection', 'keywords', 'all routes', 'quota', 'errors', 'data preservation'] }));
      await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); process.stdin.on('data', data => { if (data.toString().trim() === 'stop') resolve(); }); });
      process.stdin.removeAllListeners('data');
      process.stdin.pause();
    } else console.log(JSON.stringify({ ok: true, checks: ['safe upgrade', 'v1 cache reuse', 'no legacy data', 'no legacy scheduler', 'projection idempotence', 'multiple keywords', 'no reader calls', 'digest', 'profile', 'shared quota', 'error privacy', 'data preservation'] }));
  } finally { await app.close(); await new Promise(resolve => model.close(resolve)); dns.lookup = lookup; }
})().catch(error => { console.error(error); model.close(); process.exitCode = 1; });
