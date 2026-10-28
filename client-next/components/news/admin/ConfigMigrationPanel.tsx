'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Upload, RefreshCw } from 'lucide-react';
import { adminApi } from './admin-api';
import styles from './admin.module.css';

interface MigrationStatus { workerReady: boolean; collectorEnabled: boolean; telegramEnabled: boolean; tokenConfigured: boolean; pending: { id: string; backup: string } | null }
interface Preview {
  id: string; exportedAt: string; expiresAt: string; rules: number; keywords: number; logos: number; telegramSession: boolean; pendingMessages: number;
  sources: { name: string; kind: string; enabled: boolean; action: string }[]; removedSources: string[]; warnings: string[];
}
async function binaryRequest(path: string, body: BodyInit, contentType: string) {
  const response = await fetch(`/api/news/admin/migration/${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': contentType }, body });
  if (!response.ok) {
    let message = response.status === 413 ? '代理拒绝了文件大小，请按部署说明将迁移上传路径限制调整为 32 MiB' : `迁移请求失败（HTTP ${response.status}）`;
    const result = await response.json().catch(() => null);
    if (typeof result?.message === 'string') message = result.message;
    if (response.status === 401) window.dispatchEvent(new CustomEvent('admin:expired', { detail: message }));
    throw new Error(message);
  }
  return response;
}
export function ConfigMigrationPanel({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [operation, setOperation] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [exportPassword, setExportPassword] = useState(''); const [repeat, setRepeat] = useState(''); const [stopConfirmed, setStopConfirmed] = useState(false);
  const [file, setFile] = useState<File | null>(null); const [importPassword, setImportPassword] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null); const [oldStopped, setOldStopped] = useState(false); const [replace, setReplace] = useState(false);
  const [imported, setImported] = useState(false);
  const loadStatus = useCallback(async () => {
    const next = await adminApi<MigrationStatus>('admin/migration/status', ''); setStatus(next); return next;
  }, []);
  useEffect(() => {
    let cancelled = false;
    adminApi<MigrationStatus>('admin/migration/status', '').then(next => { if (!cancelled) setStatus(next); }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : '无法读取迁移状态'); });
    return () => { cancelled = true; };
  }, []);
  const pendingId = status?.pending?.id;
  useEffect(() => {
    if (!pendingId) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await adminApi<MigrationStatus>('admin/migration/status', '');
        if (cancelled) return;
        setStatus(next); setError('');
        if (!next.pending) { setImported(true); setNotice('迁移完成，已恢复包内的来源和 Telegram 采集开关。'); return; }
      } catch (error) { if (!cancelled) setError(error instanceof Error ? error.message : '恢复状态读取失败'); }
      if (!cancelled) timer = setTimeout(() => void refresh(), 3000);
    }
    timer = setTimeout(() => void refresh(), 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pendingId]);
  const busy = !!operation || !!pendingId;
  const ready = status?.workerReady && status.telegramEnabled && status.tokenConfigured;
  function start(name: string) { setOperation(name); onBusy(true); setError(''); setNotice(''); }
  function finish() { setOperation(''); onBusy(false); }
  async function exportAll() {
    if (!stopConfirmed || exportPassword !== repeat || exportPassword.length < 12) { setError('请确认暂停 Telegram，并输入两次相同的迁移密码（至少 12 个字符）'); return; }
    start('export');
    try {
      const response = await binaryRequest('export', JSON.stringify({ password: exportPassword }), 'application/json');
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
      link.href = url; link.download = `china-radar-${new Date().toISOString().slice(0, 10)}.radar`; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setExportPassword(''); setRepeat('');
      setNotice('加密包已下载。旧服务器 Telegram 已暂停，重启也不会自动连接；请将迁移密码另行保存。');
    } catch (error) { setError(`${error instanceof Error ? error.message : '导出失败'}。如果已经开始保存 Telegram 状态，采集可能已暂停；需要继续旧服务器时请到 Telegram 账号页启动采集。`); }
    finally { finish(); void loadStatus().catch(() => {}); }
  }
  async function inspect() {
    if (!file || file.size > 32 * 1024 * 1024) { setError('请选择不超过 32 MiB 的 .radar 迁移包'); return; }
    start('preview'); setPreview(null); setOldStopped(false); setReplace(false);
    try {
      const uploaded = await (await binaryRequest('upload', file, 'application/octet-stream')).json() as { id: string };
      setPreview(await adminApi<Preview>('admin/migration/preview', '', { id: uploaded.id, password: importPassword }, 'POST'));
      setImportPassword('');
    } catch (error) { setError(error instanceof Error ? error.message : '迁移包预览失败'); }
    finally { finish(); }
  }
  async function confirmImport() {
    if (!preview) return;
    start('import');
    try {
      const result = await adminApi<{ pending: boolean; backup: string; message: string }>('admin/migration/import', '', { id: preview.id, oldCollectorStopped: oldStopped, replaceConfirmed: replace }, 'POST');
      setPreview(null); setFile(null); setNotice(result.message);
      const next = await loadStatus();
      if (!next.pending) { setImported(true); setNotice('迁移完成，已恢复包内的来源和 Telegram 采集开关。'); }
    } catch (error) { setError(error instanceof Error ? error.message : '导入失败'); await loadStatus().catch(() => {}); }
    finally { finish(); }
  }
  return <div className={styles.stack}>
    <section className={styles.card} aria-label="迁移服务状态">
      <div className={styles.sectionTitle}><div><h2>配置迁移</h2><p>加密迁移采集设置、密钥、Logo、关注列表，以及 Telegram 登录和未投递队列。</p></div><button type="button" disabled={!!operation} onClick={() => { setError(''); void loadStatus().catch(error => setError(error instanceof Error ? error.message : '状态读取失败')); }}><RefreshCw size={16} />刷新状态</button></div>
      {!status ? <p role="status">正在读取服务状态…</p> : pendingId ? <div role="status"><p>正在恢复 Telegram 状态，来源暂未启动。请保持采集器运行，重启后也会继续恢复。</p><p>数据库备份：<code className={styles.migrationPath}>{status.pending!.backup}</code></p></div> : <p>{ready ? '迁移采集器已连接，可以导出或导入。' : '请先更新并启动新版 Telegram 采集器，再刷新状态。后端需启用 TELEGRAM_ENABLED=true，采集器需启用 TG_USE_CONFIRMED=true，双方需使用同一个有效 COLLECTOR_TOKEN。'}{!status.collectorEnabled && ' 当前定时采集已被部署环境关闭，需设置 COLLECTOR_ENABLED=true 并重建后端。'}</p>}
      {error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
      {imported && <div className={styles.actions}><button type="button" className={styles.primary} onClick={() => window.location.reload()}>刷新后台，载入新配置</button></div>}
    </section>
    <section className={styles.card}><h2>从旧服务器导出</h2><p>密钥、session 和队列只放入密码加密的 .radar 文件。请将文件和密码分开保管，密码遗失后无法恢复。</p>
      <form onSubmit={event => { event.preventDefault(); void exportAll(); }}>
        <fieldset className={styles.fields} disabled={busy || !ready}><label>迁移密码<input type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={exportPassword} onChange={event => setExportPassword(event.target.value)} /></label><label>再次输入密码<input type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={repeat} onChange={event => setRepeat(event.target.value)} /></label></fieldset>
        <label className={styles.check}><input type="checkbox" disabled={busy || !ready} checked={stopConfirmed} onChange={event => setStopConfirmed(event.target.checked)} />导出时停止旧服务器 Telegram 采集，并保持暂停，避免两台服务器同时使用 session。</label>
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy || !ready || !stopConfirmed}><Download size={16} />{operation === 'export' ? '正在停止采集并加密…' : '暂停 Telegram 并导出'}</button></div>
      </form>
    </section>
    <section className={styles.card}><h2>导入到这台服务器</h2><p>先在新服务器部署相同版本，并初始化本站管理员账号。导入只替换应用设置，保留本站管理员、新闻和收藏；域名、TLS、Docker 路径和内部令牌沿用本站部署配置。</p>
      {!preview ? <form onSubmit={event => { event.preventDefault(); void inspect(); }}><fieldset className={styles.fields} disabled={busy || !ready}>
        <label>加密迁移包<input type="file" accept=".radar,application/octet-stream" required onChange={event => { setFile(event.target.files?.[0] || null); setError(''); }} /></label>
        <label>迁移密码<input type="password" autoComplete="off" required minLength={12} maxLength={256} value={importPassword} onChange={event => setImportPassword(event.target.value)} /></label>
      </fieldset><div className={styles.actions}><button type="submit" disabled={busy || !ready || !file}><Upload size={16} />{operation === 'preview' ? '正在解密和校验…' : '上传并预览'}</button></div></form> : <div>
        <p>导出时间：{new Date(preview.exportedAt).toLocaleString()} · 预览有效至 {new Date(preview.expiresAt).toLocaleTimeString()}</p>
        <p>{preview.sources.length} 个来源 · {preview.rules} 条过滤规则 · {preview.keywords} 个关注项 · {preview.logos} 个 Logo · Telegram {preview.telegramSession ? '含登录 session' : '未登录'} · {preview.pendingMessages} 条待投递消息</p>
        <ul className={styles.sourceImportList}>{preview.sources.map((source, index) => <li key={index}>{source.action} · {source.name}<small>{source.kind} · {source.enabled ? '恢复启用' : '保持暂停'}</small></li>)}</ul>
        {!!preview.removedSources.length && <p>本站不在包内的来源将停止采集：{preview.removedSources.join('、')}。已有新闻仍保留。</p>}
        <ul className={styles.migrationWarnings}>{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        <div className={styles.stack}><label className={styles.check}><input type="checkbox" disabled={busy} checked={oldStopped} onChange={event => setOldStopped(event.target.checked)} />已确认旧服务器 Telegram 采集器停止，不会再使用此 session。</label>
          <label className={styles.check}><input type="checkbox" disabled={busy} checked={replace} onChange={event => setReplace(event.target.checked)} />确认替换本站全部应用设置和关注列表；恢复完成后按包内开关自动采集。</label></div>
        <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || !ready || !oldStopped || !replace} onClick={() => void confirmImport()}>{operation === 'import' ? '正在备份并导入…' : '备份本站并确认导入'}</button><button type="button" disabled={busy} onClick={() => setPreview(null)}>取消</button></div>
      </div>}
    </section>
  </div>;
}
