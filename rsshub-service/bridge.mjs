import { createHash } from 'node:crypto';

const escapeXml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const element = (name, value) => `<${name}>${escapeXml(value)}</${name}>`;
export function toRss(data) {
  // request() can return an error JSON instead of throwing. Never turn that into a healthy empty feed.
  if (!data || typeof data.title !== 'string' || !Array.isArray(data.item)) throw new Error('Invalid RSSHub result');
  const items = data.item.slice(0, 50).map(item => {
    if (!item || typeof item.title !== 'string' || typeof item.link !== 'string') throw new Error('Invalid RSSHub item');
    const date = item.pubDate ? new Date(item.pubDate) : null;
    return `<item>${element('title', item.title.slice(0, 600))}${element('link', item.link)}${element('description', String(item.description ?? '').slice(0, 12000))}${element('author', item.author ?? '')}${date && Number.isFinite(date.getTime()) ? element('pubDate', date.toUTCString()) : ''}</item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>${element('title', data.title)}${element('link', data.link)}${element('description', 'RSSHub media adapter')}${items}</channel></rss>`;
}

export function createFeedHandler({ feeds, request, ttlMs = 120000, timeoutMs = 12000 }) {
  const cache = new Map(); const running = new Map();
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return; }
    if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return; }
    const id = url.pathname.match(/^\/feeds\/([a-z]+)$/)?.[1];
    if (!id || !Object.hasOwn(feeds, id) || url.search) { res.writeHead(404); res.end(); return; }
    try {
      let result = cache.get(id);
      if (!result || result.until <= Date.now()) {
        if (!running.has(id)) {
          if (running.size >= 2) { res.writeHead(503, { 'Retry-After': '30' }); res.end(); return; }
          const job = Promise.resolve().then(() => request(feeds[id])).then(data => {
            const xml = toRss(data); const value = { xml, etag: `"${createHash('sha256').update(xml).digest('hex')}"`, until: Date.now() + ttlMs };
            cache.set(id, value); return value;
          }).finally(() => running.delete(id));
          running.set(id, job);
        }
        let timer;
        try { result = await Promise.race([running.get(id), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs); })]); }
        finally { clearTimeout(timer); }
      }
      res.writeHead(req.headers['if-none-match'] === result.etag ? 304 : 200, { 'Content-Type': 'application/rss+xml; charset=utf-8', ETag: result.etag, 'Cache-Control': 'private, max-age=120' });
      res.end(req.headers['if-none-match'] === result.etag ? undefined : result.xml);
    } catch {
      // RSSHub errors can contain upstream response bodies or credential-bearing URLs.
      res.writeHead(502, { 'Content-Type': 'application/json', 'Retry-After': '300' }); res.end('{"error":"RSSHub route unavailable"}');
    }
  };
}
