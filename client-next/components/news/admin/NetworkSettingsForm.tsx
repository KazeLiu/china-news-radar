'use client';
import { useState } from 'react';
import { type NetworkSettings, type SaveSettings } from './admin-api';
import styles from './admin.module.css';

export function NetworkSettingsForm({ initial, busy, onSave }: { initial: NetworkSettings; busy: boolean; onSave: SaveSettings }) {
  const [mode, setMode] = useState(initial.mode);
  const [proxyUrl, setProxyUrl] = useState('');
  const [secureDns, setSecureDns] = useState(initial.secureDns);
  return <form className={`${styles.card} ${styles.networkSettings}`} onSubmit={async event => {
    event.preventDefault(); if (await onSave('admin/network', { mode, proxyUrl, secureDns })) setProxyUrl('');
  }}><h2>采集网络</h2><p>RSS、网页和通用 API 共用。AI 接口与 Telegram 接收不受影响。</p>
    <fieldset disabled={busy} className={styles.fields}>
      <label>连接方式<select value={mode} onChange={e => setMode(e.target.value as NetworkSettings['mode'])}><option value="direct">直连（服务器默认）</option><option value="proxy">HTTP(S) 代理</option></select></label>
      {mode === 'proxy' && <><label>代理地址<input type="password" autoComplete="new-password" maxLength={2000} value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} placeholder={initial.proxyConfigured ? '已保存；留空保留原地址' : 'http://127.0.0.1:7897'} required={!initial.proxyConfigured} /><small>填写后端所在电脑的地址。容器中的 127.0.0.1 指向容器自身。</small></label>
        <label className={styles.check}><input type="checkbox" checked={secureDns} onChange={e => setSecureDns(e.target.checked)} />通过代理使用安全 DNS<small>系统 DNS 返回错误地址时开启，使用 Cloudflare DNS over HTTPS。</small></label></>}
    </fieldset><button type="submit" className={styles.primary} disabled={busy}>保存采集网络</button><p className={styles.hint}>选择直连后不会再使用环境变量中的代理。修改网络会清除临时人工验证会话。</p></form>;
}
