// Integration check against a local development server. Restores the tested favorite.
const assert = require('node:assert/strict');
const base = new URL(process.env.RADAR_TEST_URL || 'http://127.0.0.1:3411');
const readOnly = process.env.RADAR_TEST_READ_ONLY === 'true';
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('This integration check is limited to localhost.');
async function call(path, init = {}) {
  const response = await fetch(new URL(`/api/news/${path}`, base), { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  return { status: response.status, body: await response.json() };
}
(async () => {
  assert.equal((await call('health')).body.mode, 'news');
  const sources = (await call('sources')).body;
  assert.ok(Array.isArray(sources));
  assert.ok(sources.every(s => s.feedUrl === undefined));
  assert.ok(sources.every(s => s.feedUrls === undefined && s.activeFeedUrl === undefined));
  assert.ok(sources.every(s => !Object.hasOwn(s, 'rsshubRoute') && !Object.hasOwn(s, 'rsshubEnabled')));
  const feed = (await call('items')).body;
  assert.ok(feed.items.length > 0, 'Wait for at least one successful RSS collection.');
  const item = feed.items[0];
  const keyword = item.title.split(/\s+/).find(word => word.length > 4) || item.title;
  const params = new URLSearchParams({ source: item.sourceId, q: keyword });
  const filtered = (await call(`items?${params}`)).body;
  assert.ok(filtered.items.some(record => record.id === item.id));
  assert.equal(filtered.items.every(record => record.sourceId === item.sourceId), true);
  assert.equal((await call('items?q=radar-no-match-9f54381ac')).body.total, 0);
  assert.equal((await call('telegram', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await call(`items/${item.id}/saved`, { method: 'PATCH', headers: { Origin: 'https://untrusted.example' }, body: JSON.stringify({ saved: !item.saved }) })).status, 403);
  assert.equal((await call(`items/${item.id}/saved`, { method: 'PATCH', body: '{"saved":"yes"}' })).status, 400);
  if (!readOnly) try {
    const saved = await call(`items/${item.id}/saved`, { method: 'PATCH', body: JSON.stringify({ saved: !item.saved }) });
    assert.equal(saved.status, 200); assert.equal(saved.body.saved, !item.saved);
    assert.equal(saved.body.updatedAt, item.updatedAt);
    assert.equal(saved.body.firstSeenAt, item.firstSeenAt);
  } finally {
    const restored = await call(`items/${item.id}/saved`, { method: 'PATCH', body: JSON.stringify({ saved: item.saved }) });
    assert.equal(restored.status, 200);
  }
  assert.equal((await call('items?q=Beijing%20-%20AP%20News')).body.items.some(record => record.title === 'Beijing - AP News'), false);
  console.log(JSON.stringify({ ok: true, readOnly, visibleReports: feed.total, configuredRss: sources.filter(s => s.configured && s.kind !== 'telegram').length, checks: ['health', 'filter', 'search', 'empty', 'collection hidden', 'ingest authentication', 'cross-site rejection', 'input validation', ...(!readOnly ? ['favorite persistence metadata'] : [])] }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
