// Read-only route diagnostics. No database writes, credentials or raw upstream error output.
const { NEWS_SOURCES } = require('../server/dist/news/sources');
const { parseFeed } = require('../server/dist/news/collector');
const feeds = require('../rsshub-service/feeds.json');
const base = new URL(process.env.RSSHUB_TEST_URL || 'http://127.0.0.1:3412');
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Diagnostics are limited to the local adapter.');
(async () => {
  for (const source of NEWS_SOURCES.filter(s => feeds[s.id])) {
    const started = Date.now();
    try {
      const response = await fetch(new URL(`/feeds/${source.id}`, base), { signal: AbortSignal.timeout(14000) });
      const items = response.ok ? await parseFeed(await response.text(), { ...source, kind: 'rss' }, new Date(), false) : [];
      console.log(JSON.stringify({ source: source.id, status: response.status, ms: Date.now() - started, publisherVerifiedItems: items.length }));
      if (!response.ok) process.exitCode = 1;
    } catch (error) { console.log(JSON.stringify({ source: source.id, error: error.name })); process.exitCode = 1; }
  }
})().catch(() => { process.exitCode = 1; });
