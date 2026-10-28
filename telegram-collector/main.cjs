const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { state, sessionFile, CollectorError, backendRequest, failure, reportStatus } = require('./account.cjs');
const { runCollector } = require('./collection.cjs');
const { Authorization } = require('./authorization.cjs');
const migration = require('./migration.cjs');

const sameAccount = (a, b) => a && b && ['revision', 'apiId', 'apiHash', 'phone', 'proxyUrl'].every(key => a[key] === b[key]);
async function main() {
  if (process.env.TELEGRAM_ENABLED !== 'true' || process.env.TG_USE_CONFIRMED !== 'true') throw new CollectorError('collector-disabled', '请在部署配置中启用 TELEGRAM_ENABLED 和 TG_USE_CONFIRMED。');
  if ((process.env.COLLECTOR_TOKEN || '').length < 32) throw new CollectorError('collector-auth-failed', '内部通信令牌缺失或无效，请核对 COLLECTOR_TOKEN。');
  fs.mkdirSync(state, { recursive: true });
  const shutdown = new AbortController(); const workerId = randomUUID();
  const stop = () => shutdown.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  process.on('message', message => { if (message?.type === 'shutdown') stop(); });
  if (process.connected) process.once('disconnect', stop);
  let job; let current; let blocked; let collectionRevision; let idleAt = 0; let abandoned; let connectionError;
  let idle = { session: 'missing', phase: 'idle' };
  async function stopJob() {
    if (!job) return;
    if (job.auth) await job.auth.cancel(); else job.controller.abort();
    await job.promise; job = undefined;
  }
  try {
    while (!shutdown.signal.aborted) {
      let control;
      try {
        if (!await migration.recover(workerId)) { await delay(2_000); continue; }
        control = await backendRequest('control', { workerId, migrationVersion: 1 });
        if (control.migration) {
          await stopJob();
          if (current) await reportStatus('disconnected', current, { phase: 'stopped' });
          await migration.hold(workerId, control.migration, shutdown.signal);
          current = undefined; blocked = undefined; continue;
        }
        if (control.pendingMigration) throw new CollectorError('migration-state-missing', '迁移等待恢复，但本机缺少暂存状态；请保留备份并检查采集器的持久卷。');
      }
      catch (error) {
        if (error.code === 'collector-auth-failed' || error.status === 409) throw error;
        const detail = failure(error); const signature = `${detail.code}:${error.status || ''}`;
        if (connectionError !== signature) console.log(`RADAR_FAILURE ${detail.code}: ${detail.message}`);
        connectionError = signature;
        // Collection retains the durable outbox during a backend outage; authorization cannot safely accept input.
        if (job?.auth) { abandoned = { id: job.auth.id, error: { code: 'authorization-interrupted', message: '授权时无法连接本站后端，本次输入已作废，请重新开始登录。' } }; blocked = current; await stopJob(); }
        await delay(2_000, undefined, { signal: shutdown.signal }).catch(() => {}); continue;
      }
      if (shutdown.signal.aborted) break;
      if (connectionError) { console.log('RADAR_READY'); connectionError = undefined; }
      if (!sameAccount(current, control.credentials) || collectionRevision !== control.collectionRevision) {
        await stopJob(); current = control.credentials; collectionRevision = control.collectionRevision; blocked = undefined; idleAt = 0;
        idle = { session: fs.existsSync(sessionFile) ? 'disconnected' : 'missing', phase: 'idle' };
      }
      if (abandoned && control.auth?.id === abandoned.id) {
        try { await backendRequest('auth/report', { workerId, id: abandoned.id, phase: 'failed', error: abandoned.error }); control.auth = null; abandoned = undefined; }
        catch (error) { if (error.code === 'collector-auth-failed') throw error; await delay(2_000); continue; }
      } else abandoned = undefined;
      if (job?.auth && control.auth?.id !== job.auth.id) { blocked = current; await stopJob(); }
      if (control.auth) {
        if (!job?.auth) {
          await stopJob(); blocked = current;
          const auth = new Authorization(workerId, control.auth.id, current);
          job = { auth, done: false }; const owned = job;
          owned.promise = auth.run().catch(error => { owned.error = failure(error, current); }).finally(() => { owned.done = true; });
        }
        job.auth.deliver(control.auth);
        if (job.done && job.auth.pendingFailure) {
          try { await job.auth.report('failed', { error: job.auth.pendingFailure }); job.auth.pendingFailure = undefined; }
          catch (error) { if (error.code === 'collector-auth-failed') throw error; }
        }
      } else {
        if (job?.done) {
          if (job.error) { blocked = current; idle = { session: 'disconnected', phase: 'failed', error: job.error }; await reportStatus(idle.session, current, idle); idleAt = Date.now(); }
          job = undefined;
        }
        if (!current.enabled && job) { await stopJob(); idleAt = 0; }
        if (!job && current.enabled && !sameAccount(blocked, current)) {
          blocked = current;
          if (current.apiId && current.apiHash && fs.existsSync(sessionFile)) {
            const controller = new AbortController(); const owned = job = { controller, done: false };
            owned.promise = runCollector(current, controller.signal).catch(error => { owned.error = failure(error, current); }).finally(() => { owned.done = true; });
          } else {
            idle = { session: 'missing', phase: 'idle' }; await reportStatus(idle.session, current, idle); idleAt = Date.now();
          }
        }
        if (!job && Date.now() - idleAt > 60_000) { await reportStatus(idle.session, current, idle); idleAt = Date.now(); }
      }
      // Never retain an authorization input in the polling snapshot beyond this iteration.
      if (control.auth) control.auth.input = undefined;
      await delay(2_000, undefined, { signal: shutdown.signal }).catch(() => {});
    }
  } finally { await stopJob(); if (current) await reportStatus('disconnected', current, { phase: 'stopped' }); }
}
main().catch(error => { const detail = failure(error); console.log(`RADAR_FAILURE ${detail.code}: ${detail.message}`); process.exitCode = 1; }).finally(() => { if (process.connected) process.disconnect(); });
