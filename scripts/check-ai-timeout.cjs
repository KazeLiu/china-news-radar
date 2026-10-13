const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');

// Exercise the actual SDK and Next.js proxy against local fixtures only.
process.env.AI_ANALYSIS_ENABLED = 'false';
process.env.OPENAI_API_KEY = 'local-timeout-fixture-key';
const root = path.resolve(__dirname, '..');
const clientRoot = path.join(root, 'client-next');
const clientRequire = createRequire(path.join(clientRoot, 'package.json'));
const loadConfig = clientRequire('next/dist/server/config').default;
const { PHASE_PRODUCTION_SERVER } = clientRequire('next/constants');
const { proxyRequest } = clientRequire('next/dist/server/lib/router-utils/proxy-request');
const { NewsService } = require(path.join(root, 'server/dist/news/news.service'));
const { AI_TIMEOUT_MS } = require(path.join(root, 'server/dist/news/ai-errors'));
const servers = []; const timers = new Set();

async function listen(handler) {
  const server = http.createServer(handler); servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function jsonBody(request) {
  let body = ''; for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}
async function main() {
  const config = await loadConfig(PHASE_PRODUCTION_SERVER, clientRoot);
  assert.ok(config.experimental.proxyTimeout > AI_TIMEOUT_MS);
  let providerCalls = 0;
  const provider = await listen(async (request, response) => {
    const input = await jsonBody(request); providerCalls++;
    assert.equal(input.model, 'local-fixture-model');
    assert.equal(request.headers.authorization, 'Bearer local-timeout-fixture-key');
    const timer = setTimeout(() => {
      timers.delete(timer);
      response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req-delayed-local-fixture' });
      response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        version: 2, scoring: { relevance: 8, novelty: 7, audience: 8, quality: 7, importance: 'high', tags: ['贸易'] }, relation: 'related', topics: ['policy'], type: 'report', language: 'en', reason: '涉及中国政策',
        translation: { title: '中国公布新政策', summary: '新的贸易规则。' },
      }) } }] }));
    }, 32_000);
    timers.add(timer);
  });
  const settings = new Map();
  const db = { setting: {
    findUnique: async ({ where }) => settings.has(where.key) ? { value: settings.get(where.key) } : null,
    upsert: async ({ where, create, update }) => settings.set(where.key, settings.has(where.key) ? update.value : create.value),
  } };
  db.$transaction = callback => callback(db);
  const service = new NewsService(db);
  service.config.ai = { ...service.config.ai, enabled: false, apiKey: 'local-timeout-fixture-key', baseUrl: `${provider}/v1`, model: 'local-fixture-model', dailyLimit: 5 };
  const backend = await listen(async (request, response) => {
    try {
      const result = await service.testAi(await jsonBody(request));
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(result));
    } catch { response.writeHead(500); response.end(); }
  });
  const target = new URL(backend);
  const proxy = await listen(async (request, response) => {
    try {
      await proxyRequest(request, response, { protocol: target.protocol, hostname: target.hostname, port: target.port, pathname: request.url, query: {} }, undefined, undefined, config.experimental.proxyTimeout);
    } catch { if (!response.headersSent) response.writeHead(502); response.end(); }
  });
  const start = Date.now();
  const response = await fetch(`${proxy}/api/news/admin/ai/test`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'China announces new policy', summary: 'New trade rules.' }), signal: AbortSignal.timeout(45_000) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true); assert.ok(result.elapsedMs >= 32_000);
  assert.equal(providerCalls, 1); assert.equal(result.usage.used, 1); assert.equal(settings.size, 1);
  console.log(JSON.stringify({ ok: true, elapsedMs: Date.now() - start, modelTimeoutMs: AI_TIMEOUT_MS, proxyTimeoutMs: config.experimental.proxyTimeout, providerCalls, paidCalls: 0, checks: ['32-second SDK response', 'Next.js proxy survives 30 seconds', 'single call and quota reservation'] }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  for (const timer of timers) clearTimeout(timer);
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
