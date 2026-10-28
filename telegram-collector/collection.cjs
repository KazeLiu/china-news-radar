const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { Api } = require('teleproto');
const { NewMessage, EditedMessage } = require('teleproto/events');
const { FloodWaitError } = require('teleproto/errors');
const { Outbox, messagePayload } = require('./common.cjs');
const { state, sessionFile, CollectorError, backendRequest, requireCredentials, failure, reportStatus, createClient, saveSession } = require('./account.cjs');

async function runCollector(current, shutdown) {
  requireCredentials(current);
  if (!fs.existsSync(sessionFile)) throw new CollectorError('session-missing', '尚未登录，请在账号配置中点击“开始登录”。');
  const client = createClient(current, fs.readFileSync(sessionFile, 'utf8'));
  const outbox = new Outbox(path.join(state, 'outbox.db'));
  const controller = new AbortController();
  let closing;
  const close = () => closing ??= client.destroy();
  const stop = () => { controller.abort(); void close().catch(() => {}); };
  shutdown.addEventListener('abort', stop, { once: true });
  const selected = new Map();
  let matches = []; let eventError; let errorDetail; let tasks = [];
  async function report(session = 'authorized', phase = 'listening', error) { await reportStatus(session, current, { phase, error, channels: matches }); }
  async function refreshSources() {
    const sources = await backendRequest('sources');
    const subscribed = new Map();
    for await (const dialog of client.iterDialogs({})) {
      const entity = dialog.entity;
      if (!(entity instanceof Api.Channel) || !entity.broadcast) continue;
      if (entity.username) subscribed.set(entity.username.toLowerCase(), entity);
      for (const alias of entity.usernames || []) {
        if (alias.active) subscribed.set(alias.username.toLowerCase(), entity);
      }
    }
    selected.clear();
    matches = sources.map(source => {
      const entity = subscribed.get(source.channel.toLowerCase());
      if (entity) selected.set(entity.id.toString(), { channel: source.channel, entity });
      return { ...source, subscribed: !!entity };
    });
    await report();
  }
  function receive(event) {
    const peer = event.message.peerId;
    if (!(peer instanceof Api.PeerChannel)) return;
    const source = selected.get(peer.channelId.toString());
    if (!source) return;
    const payload = messagePayload(source.channel, event.message);
    if (payload) { try { outbox.put(payload); } catch (error) { eventError = error; } }
  }
  async function backfill() {
    const cutoff = Math.floor(Date.now() / 1_000) - 86_400;
    for (const { channel, entity } of selected.values()) {
      if (controller.signal.aborted) return;
      try {
        for await (const message of client.iterMessages(entity, { limit: 25 })) {
          if (message.date < cutoff) break;
          const payload = messagePayload(channel, message);
          if (payload) outbox.put({ ...payload, backfill: true });
        }
        await delay(2_000, undefined, { signal: controller.signal });
      } catch (error) {
        if (!(error instanceof FloodWaitError)) throw error;
        await report('authorized', 'listening', failure(error)); return;
      }
    }
  }
  async function collect() {
    let nextRefresh = Date.now() + 60_000;
    while (!controller.signal.aborted) {
      if (eventError) throw eventError;
      if (Date.now() >= nextRefresh) {
        try { await refreshSources(); }
        catch (error) {
          if (controller.signal.aborted) return;
          if (!(error instanceof CollectorError) || error.code === 'collector-auth-failed') throw error;
          await report('authorized', 'listening', failure(error));
        }
        nextRefresh = Date.now() + 60_000;
      }
      const record = outbox.next();
      if (record) {
        try { await backendRequest('', record.payload); outbox.acknowledge(record); if (controller.signal.aborted) return; await report(); }
        catch (error) {
          if (controller.signal.aborted) return;
          if (!(error instanceof CollectorError) || error.code === 'collector-auth-failed') throw error;
          outbox.retry(record); await report('authorized', 'listening', failure(error));
        }
      }
      await delay(1_000, undefined, { signal: controller.signal });
    }
  }
  try {
    shutdown.throwIfAborted();
    await report('connecting', 'connecting');
    shutdown.throwIfAborted();
    await client.start();
    const me = await client.getMe();
    shutdown.throwIfAborted();
    if (current.phone && me.phone !== current.phone.slice(1)) throw new CollectorError('session-account-mismatch', '已保存的登录与当前手机号不一致，请点击“重新登录”验证此手机号。');
    saveSession(client);
    await report('authorized', 'matching'); await refreshSources();
    client.addEventHandler(receive, new NewMessage({})); client.addEventHandler(receive, new EditedMessage({}));
    tasks = [backfill(), collect()]; await Promise.all(tasks);
  } catch (error) {
    if (shutdown.aborted) return;
    errorDetail = failure(error, current); throw error;
  } finally {
    controller.abort(); await close(); await Promise.allSettled(tasks); outbox.close();
    shutdown.removeEventListener('abort', stop);
    if (!shutdown.aborted) await report('disconnected', errorDetail ? 'failed' : 'stopped', errorDetail);
  }
}
module.exports = { runCollector };
