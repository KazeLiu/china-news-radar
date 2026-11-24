'use client';
import { useEffect, useState } from 'react';
import { adminApi, type NetworkSettings, type SaveSettings } from './admin-api';
import styles from './admin.module.css';

export function NetworkSettingsForm({ initial, busy, onSave }: { initial: NetworkSettings; busy: boolean; onSave: SaveSettings }) {
  const [mode, setMode] = useState(initial.mode);
  const [proxyUrl, setProxyUrl] = useState('');
  const [secureDns, setSecureDns] = useState(initial.secureDns);
  const [telegramUseProxy, setTelegramUseProxy] = useState(initial.telegramUseProxy ?? false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    adminApi<{ proxyUrl: string }>('admin/network/private', '').then(value => { if (!cancelled) setProxyUrl(value.proxyUrl); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '代理地址读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return <form className={`${styles.card} ${styles.compact}`} onSubmit={event => {
    event.preventDefault(); void onSave('admin/network', { mode, proxyUrl, secureDns, telegramUseProxy });
  }}>
    <h2>共享代理</h2>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <fieldset disabled={busy || loading || !!error} className={styles.fields}>
      <label>共享代理<select value={mode} onChange={e => setMode(e.target.value as NetworkSettings['mode'])}><option value="direct">停用（全部直连）</option><option value="proxy">启用 HTTP(S) 代理</option></select></label>
      <label>代理地址<input type="text" autoComplete="off" maxLength={2000} value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} placeholder="http://127.0.0.1:7897" required={mode === 'proxy'} /><small>地址须能被采集服务访问；Docker 内的 127.0.0.1 指向容器。</small></label>
      <div><label className={styles.check}><input type="checkbox" checked={secureDns} onChange={e => setSecureDns(e.target.checked)} />通过代理使用安全 DNS</label><small className={styles.hint}>用于 RSS、网页和 API，不影响 Telegram。</small></div>
      <div><label className={styles.check}><input type="checkbox" checked={telegramUseProxy} onChange={e => setTelegramUseProxy(e.target.checked)} />Telegram 登录和采集使用代理</label><small className={styles.hint}>切换连接会中止正在进行的 Telegram 登录。</small></div>
    </fieldset>
    <div className={styles.formActions}><span>{mode === 'proxy' ? '仅用于选用代理的来源和 Telegram 账号。' : '所有来源直连，保留各来源的代理选择。'}</span><button type="submit" className={styles.primary} disabled={busy || loading || !!error}>{loading ? '读取中…' : busy ? '保存中…' : '保存代理设置'}</button></div>
  </form>;
}
