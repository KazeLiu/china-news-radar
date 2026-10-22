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
  return <section className={styles.card}><h2>代理设置</h2><p>在这里保存共享代理地址，再到各来源勾选“使用代理”。未勾选的来源直连。</p><form onSubmit={event => {
    event.preventDefault(); void onSave('admin/network', { mode, proxyUrl, secureDns, telegramUseProxy });
  }}>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <fieldset disabled={busy || loading || !!error} className={styles.fields}>
      <label>共享代理<select value={mode} onChange={e => setMode(e.target.value as NetworkSettings['mode'])}><option value="direct">停用（全部直连）</option><option value="proxy">启用 HTTP(S) 代理</option></select></label>
      <label>代理地址<input type="text" autoComplete="off" maxLength={2000} value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} placeholder="http://127.0.0.1:7897" required={mode === 'proxy'} /><small>地址须能被后端和 Telegram 采集器访问。Windows 本地预览可填本机代理；Docker 中的 127.0.0.1 指向容器自身。</small></label>
      <div className={styles.wide}><label className={styles.check}><input type="checkbox" checked={secureDns} onChange={e => setSecureDns(e.target.checked)} />通过代理使用安全 DNS</label><p className={styles.hint}>RSS、网页与 API 的系统 DNS 解析异常时开启；Telegram 直接连接数据中心 IP，不使用此选项。</p></div>
      <div className={styles.wide}><label className={styles.check}><input type="checkbox" checked={telegramUseProxy} onChange={e => setTelegramUseProxy(e.target.checked)} />Telegram 账号使用代理（登录和采集）</label><p className={styles.hint}>所有频道共用同一个账号连接，此开关与 Telegram 来源中的开关同步。后台服务约两秒检查配置，更改后重新连接采集；进行中的授权会取消，请在账号页重新开始登录。</p></div>
    </fieldset><p className={styles.hint}>{mode === 'proxy' ? '代理仅用于已勾选的来源和 Telegram 账号；共享代理连接失败会报告错误，不会自动改为直连。' : '共享代理已停用；所有来源和 Telegram 均直连，保留各来源的勾选状态。'}</p><button type="submit" className={styles.primary} disabled={busy || loading || !!error}>{loading ? '正在读取代理配置…' : '保存代理设置'}</button><p className={styles.hint}>本站采集接收接口和内部 RSSHub 地址始终直连。AI 接口不使用这项代理配置。</p></form></section>;
}
