const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { StringSession } = require('teleproto/sessions');
const { state, sessionFile, backendRequest, CollectorError } = require('./account.cjs');
const { Outbox } = require('./common.cjs');

const markerFile = path.join(state, 'migration-active.json');
const outboxFile = path.join(state, 'outbox.db');
const limit = 32 * 1024 * 1024;
const fail = () => { throw new CollectorError('migration-state-invalid', 'Telegram 迁移状态无效或存在不同账号的未投递消息，请保留备份并检查状态目录。'); };
function atomic(file, value) {
  fs.writeFileSync(`${file}.tmp`, value, { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file);
}
function marker() {
  if (!fs.existsSync(markerFile)) return null;
  const value = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  if (!/^[a-f0-9-]{36}$/.test(value.id)) fail();
  return value;
}
function pending(file) {
  if (!fs.existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (Number(db.prepare('SELECT COUNT(*) AS total FROM pending').get().total) > 10_000) fail();
    return db.prepare('SELECT key,payload,retry_at AS retryAt,attempts FROM pending ORDER BY key').all();
  } finally { db.close(); }
}
function snapshot() {
  const result = { session: fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, 'utf8') : '', pending: pending(outboxFile) };
  validate(result); return result;
}
function validate(value) {
  if (!value || typeof value.session !== 'string' || value.session.length > 10_000 || !Array.isArray(value.pending) || value.pending.length > 10_000 || Buffer.byteLength(JSON.stringify(value)) > limit - 4096) fail();
  if (value.session) new StringSession(value.session);
  const keys = new Set();
  for (const row of value.pending) {
    if (!row || typeof row.payload !== 'string' || row.payload.length > 100_000 || typeof row.key !== 'string' || keys.has(row.key)) fail();
    const message = JSON.parse(row.payload);
    if (!message || !/^[a-z][a-z\d_]{3,99}$/i.test(message.channel) || !Number.isSafeInteger(message.messageId) || message.messageId < 1 || row.key !== `${message.channel}:${message.messageId}` ||
      typeof message.text !== 'string' || !message.text || message.text.length > 20_000 || typeof message.publishedAt !== 'string' || !Number.isFinite(Date.parse(message.publishedAt)) ||
      !Array.isArray(message.links) || message.links.length > 30 || message.links.some(link => typeof link !== 'string' || link.length > 4000) ||
      typeof row.retryAt !== 'number' || !Number.isFinite(row.retryAt) || row.retryAt < 0 || !Number.isSafeInteger(row.attempts) || row.attempts < 0) fail();
    keys.add(row.key);
  }
}
function prepare(id, value) {
  validate(value);
  const existing = marker();
  if (existing) { if (existing.id === id) return; fail(); }
  const old = snapshot();
  if (old.pending.length && old.session !== value.session) throw new CollectorError('migration-queue-conflict', '本站有另一个 Telegram session 的未投递消息，不能与导入账号混用。');
  const merged = new Map(old.pending.map(row => [row.key, row]));
  for (const row of value.pending) {
    const before = merged.get(row.key);
    const messageValues = payload => { const item = JSON.parse(payload); return JSON.stringify([item.channel, item.messageId, item.text, item.publishedAt, item.links, !!item.backfill]); };
    if (before && messageValues(before.payload) !== messageValues(row.payload)) throw new CollectorError('migration-queue-conflict', '本站与迁移包的同一消息内容冲突，原队列已保留。');
    if (!before) merged.set(row.key, row);
  }
  const next = { session: value.session, pending: [...merged.values()] }; validate(next);
  const directory = path.join(state, `migration-${id}`);
  fs.mkdirSync(directory, { mode: 0o700 });
  // The collector has closed both files before this point; backups never copy an open SQLite database.
  if (fs.existsSync(sessionFile)) { fs.copyFileSync(sessionFile, path.join(directory, 'previous.session')); fs.chmodSync(path.join(directory, 'previous.session'), 0o600); }
  if (fs.existsSync(outboxFile)) { fs.copyFileSync(outboxFile, path.join(directory, 'previous.outbox.db')); fs.chmodSync(path.join(directory, 'previous.outbox.db'), 0o600); }
  fs.writeFileSync(path.join(directory, 'next.session'), next.session, { mode: 0o600 });
  const outbox = new Outbox(path.join(directory, 'next.outbox.db'));
  try {
    const insert = outbox.db.prepare('INSERT INTO pending(key,payload,retry_at,attempts) VALUES (?,?,?,?)');
    outbox.db.exec('BEGIN');
    for (const row of next.pending) insert.run(row.key, row.payload, row.retryAt, row.attempts);
    outbox.db.exec('COMMIT');
  } finally { outbox.close(); }
  atomic(markerFile, JSON.stringify({ id, previousSession: fs.existsSync(sessionFile), previousOutbox: fs.existsSync(outboxFile) }));
}
function install(file, source) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(source, `${file}.migration-tmp`); fs.chmodSync(`${file}.migration-tmp`, 0o600); fs.renameSync(`${file}.migration-tmp`, file);
}
async function recover(workerId) {
  const saved = marker(); if (!saved) return true;
  const decision = await backendRequest('migration/recovery', { workerId, id: saved.id });
  if (decision.action === 'wait') return false;
  const directory = path.join(state, `migration-${saved.id}`);
  if (!['commit', 'rollback'].includes(decision.action)) fail();
  // Replaying these copies after a crash is safe; staged files and old backups are retained.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const file = `${outboxFile}${suffix}`; if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  if (decision.action === 'commit') {
    install(sessionFile, path.join(directory, 'next.session')); install(outboxFile, path.join(directory, 'next.outbox.db'));
    await backendRequest('migration/complete', { workerId, id: saved.id });
  } else {
    if (saved.previousSession) install(sessionFile, path.join(directory, 'previous.session')); else if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
    if (saved.previousOutbox) install(outboxFile, path.join(directory, 'previous.outbox.db')); else if (fs.existsSync(outboxFile)) fs.unlinkSync(outboxFile);
  }
  fs.unlinkSync(markerFile); return true;
}
async function hold(workerId, transfer, shutdown) {
  const { setTimeout: delay } = require('node:timers/promises');
  let completed;
  while (!shutdown.aborted) {
    const result = await backendRequest('migration/control', { workerId, id: transfer.id });
    if (result.released) return;
    const command = result.command;
    if (command) {
      if (!completed || completed.commandId !== command.id) {
        completed = { workerId, id: transfer.id, commandId: command.id, ok: true };
        try {
          if (command.action === 'snapshot') completed.data = snapshot();
          else if (command.action === 'prepare') { prepare(transfer.id, command.data); completed.data = { prepared: true }; }
          else fail();
        } catch (error) { completed.ok = false; completed.errorCode = error instanceof CollectorError ? error.code : 'migration-state-invalid'; }
      }
      // This private binary body is bounded on the server and is never passed to an audit logger.
      await backendRequest('migration/report', Buffer.from(JSON.stringify(completed)));
    }
    await delay(500, undefined, { signal: shutdown }).catch(() => {});
  }
}
module.exports = { recover, hold };
