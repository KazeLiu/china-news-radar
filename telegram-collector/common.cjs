const { DatabaseSync } = require('node:sqlite');
const { Api } = require('teleproto');

function messagePayload(channel, message) {
  const text = message.message || '';
  if (!text || text.length > 20_000) return null;
  const links = [];
  for (const entity of message.entities || []) {
    if (entity instanceof Api.MessageEntityTextUrl) links.push({ offset: entity.offset, url: entity.url });
    else if (entity instanceof Api.MessageEntityUrl) links.push({ offset: entity.offset, url: text.slice(entity.offset, entity.offset + entity.length) });
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>]+/g)) links.push({ offset: match.index, url: match[0] });
  links.sort((a, b) => a.offset - b.offset);
  if (message.media instanceof Api.MessageMediaWebPage && message.media.webpage instanceof Api.WebPage) links.push({ url: message.media.webpage.url });
  return { channel, messageId: message.id, text, publishedAt: new Date(message.date * 1_000).toISOString(), links: [...new Set(links.map(link => link.url))].slice(0, 30) };
}

class Outbox {
  constructor(file) {
    // Keep the existing SQLite schema so pending Python-worker deliveries remain readable.
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('CREATE TABLE IF NOT EXISTS pending (key TEXT PRIMARY KEY, payload TEXT NOT NULL, retry_at REAL NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0)');
    this.putStatement = this.db.prepare('INSERT INTO pending(key,payload) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,retry_at=0,attempts=0');
    this.nextStatement = this.db.prepare('SELECT key,payload,attempts FROM pending WHERE retry_at<=? ORDER BY retry_at,key LIMIT 1');
    this.acknowledgeStatement = this.db.prepare('DELETE FROM pending WHERE key=? AND payload=?');
    this.retryStatement = this.db.prepare('UPDATE pending SET retry_at=?,attempts=? WHERE key=?');
  }
  put(payload) { this.putStatement.run(`${payload.channel}:${payload.messageId}`, JSON.stringify(payload)); }
  next() {
    const row = this.nextStatement.get(Date.now() / 1_000);
    return row ? { ...row, serialized: row.payload, payload: JSON.parse(row.payload) } : null;
  }
  acknowledge(record) { this.acknowledgeStatement.run(record.key, record.serialized); }
  retry(record) { this.retryStatement.run(Date.now() / 1_000 + Math.min(300, 5 * 2 ** Math.min(record.attempts, 6)), record.attempts + 1, record.key); }
  close() { this.db.close(); }
}

module.exports = { messagePayload, Outbox };
