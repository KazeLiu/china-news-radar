// Read-only diagnostics: public feed URLs only; do not print request objects or credentials.
const { NEWS_SOURCES } = require('../server/dist/news/sources');
const { requestFeed, parseFeed } = require('../server/dist/news/collector');
(async () => {
  for (const source of NEWS_SOURCES.filter(s => s.feedUrl)) {
    let stage = 'request';
    try {
      const result = await requestFeed(source);
      stage = 'parse';
      const items = await parseFeed(result.data, source);
      console.log(JSON.stringify({ source: source.id, status: result.status, retained: items.length, latest: items[0]?.title }));
    } catch (error) { console.log(JSON.stringify({ source: source.id, stage, name: error.name, code: error.code, message: error.message })); process.exitCode = 1; }
  }
})();
