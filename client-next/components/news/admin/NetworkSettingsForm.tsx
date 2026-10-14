'use client';
import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { adminApi, type NetworkSettings, type SaveSettings } from './admin-api';
import styles from './admin.module.css';

export function NetworkSettingsForm({ initial, busy, onSave }: { initial: NetworkSettings; busy: boolean; onSave: SaveSettings }) {
  const [mode, setMode] = useState(initial.mode);
  const [proxyUrl, setProxyUrl] = useState('');
  const [secureDns, setSecureDns] = useState(initial.secureDns);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    adminApi<{ proxyUrl: string }>('admin/network/private', '').then(value => { if (!cancelled) setProxyUrl(value.proxyUrl); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '代理地址读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return <details className={`${styles.card} ${styles.networkSettings}`}><summary><span><strong>采集网络</strong><small>{error ? '配置读取失败，展开查看' : mode === 'proxy' ? 'HTTP(S) 代理' : '直连'}</small></span><ChevronDown size={18} aria-hidden="true" /></summary><form onSubmit={event => {
    event.preventDefault(); void onSave('admin/network', { mode, proxyUrl, secureDns });
  }}><p>RSS、网页和通用 API 共用。AI 接口与 Telegram 接收不受影响。</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <fieldset disabled={busy || loading || !!error} className={styles.fields}>
      <label>连接方式<select value={mode} onChange={e => setMode(e.target.value as NetworkSettings['mode'])}><option value="direct">直连（服务器默认）</option><option value="proxy">HTTP(S) 代理</option></select></label>
      {mode === 'proxy' && <><label>代理地址<input type="text" autoComplete="off" maxLength={2000} value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} placeholder="http://127.0.0.1:7897" required /><small>填写后端所在电脑的地址。容器中的 127.0.0.1 指向容器自身。</small></label>
        <label className={styles.check}><input type="checkbox" checked={secureDns} onChange={e => setSecureDns(e.target.checked)} />通过代理使用安全 DNS<small>系统 DNS 返回错误地址时开启，使用 Cloudflare DNS over HTTPS。</small></label></>}
    </fieldset><button type="submit" className={styles.primary} disabled={busy || loading || !!error}>{loading ? '正在读取网络配置…' : '保存采集网络'}</button><p className={styles.hint}>选择直连后不会再使用环境变量中的代理。</p></form></details>;
}
