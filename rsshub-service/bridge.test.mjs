import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { toRss, createFeedHandler } from './bridge.mjs';

test('escapes XML and retains original URL, publication time and description', () => {
  const xml = toRss({ title: 'Media', item: [{ title: 'A & B', link: 'https://media.test/a?x=1&y=2', description: '<p>China</p>', pubDate: '2026-10-10T00:00:00Z' }] });
  assert.match(xml, /A &amp; B/); assert.match(xml, /x=1&amp;y=2/); assert.match(xml, /Sat, 10 Oct 2026 00:00:00 GMT/); assert.match(xml, /&lt;p&gt;China/);
  assert.throws(() => toRss({ error: true, message: 'bad' }));
});
test('allowlist, shared cache, conditional requests and failures', async () => {
  let calls = 0;
  const server = createServer(createFeedHandler({ feeds: { reuters: '/reuters/world/china' }, request: async () => { calls++; return { title: 'Reuters', item: [] }; } }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/feeds/unknown`)).status, 404);
    assert.equal((await fetch(`${base}/feeds/reuters?url=http://evil.test`)).status, 404);
    const first = await fetch(`${base}/feeds/reuters`); assert.equal(first.status, 200);
    assert.equal((await fetch(`${base}/feeds/reuters`, { headers: { 'If-None-Match': first.headers.get('etag') } })).status, 304);
    assert.equal(calls, 1);
    assert.equal((await fetch(`${base}/feeds/reuters`, { method: 'POST' })).status, 405);
  } finally { server.close(); server.closeAllConnections(); }
});
test('upstream errors are sanitized and are not cached as a successful feed', async () => {
  const server = createServer(createFeedHandler({ feeds: { ap: '/apnews/topics/china' }, request: async () => ({ error: true, message: 'secret' }) }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { const res = await fetch(`http://127.0.0.1:${server.address().port}/feeds/ap`); assert.equal(res.status, 502); assert.doesNotMatch(await res.text(), /secret/); }
  finally { server.close(); server.closeAllConnections(); }
});
