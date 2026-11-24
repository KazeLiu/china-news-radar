'use client';

import { useEffect, useState } from 'react';
import { adminApi, type SourceSettings } from './admin-api';
import styles from './admin.module.css';
import { TelegramConnectionPanel, type TelegramStatus } from './TelegramConnectionPanel';

export function TelegramAccountPanel({ sources }: { sources: SourceSettings[] }) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [apiId, setApiId] = useState(''); const [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [loadError, setLoadError] = useState('');
  useEffect(() => {
    if (busy) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try { const value = await adminApi<TelegramStatus>('admin/telegram', ''); if (active) { setStatus(value); setLoadError(''); } }
      catch (e) { if (active) setLoadError(e instanceof Error ? e.message : '无法读取 Telegram 状态'); }
      finally { if (active) timer = setTimeout(refresh, 2_000); }
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [busy]);
  async function act(route: string, body: object = {}, message = '') {
    setBusy(true); setError(''); setNotice('');
    try { setStatus(await adminApi<TelegramStatus>(`admin/telegram/${route}`, '', body, 'POST')); setNotice(message); return true; }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败'); return false; }
    finally { setBusy(false); }
  }
  const authorizing = !!status?.control?.auth && !['authorized', 'failed', 'cancelled'].includes(status.control.auth.phase);
  const dirty = !!apiId || !!apiHash || phone !== null && phone !== status?.phone;
  return <div className={`${styles.stack} ${styles.compact}`}>
    <form className={styles.card} aria-label="Telegram 账号配置" onSubmit={async event => {
      event.preventDefault(); if (busy || authorizing || !status?.control) return;
      setBusy(true); setError(''); setNotice('');
      try {
        setStatus(await adminApi<TelegramStatus>('admin/telegram', '', { apiId, apiHash, phone: phone ?? status.phone }));
        setApiId(''); setApiHash(''); setPhone(null); setNotice('账号配置已保存。下一步点击“开始登录”；已有有效登录时可直接启动采集。');
      } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
      finally { setBusy(false); }
    }}>
      <h2>账号资料</h2>
      <div className={styles.fields}>
        <label>TG_API_ID · {status ? status.apiIdConfigured ? '已配置' : '未配置' : '读取中'}<input type="password" autoComplete="new-password" maxLength={10} value={apiId} onChange={e => setApiId(e.target.value)} placeholder="留空保持原值" disabled={busy || authorizing} /></label>
        <label>TG_API_HASH · {status ? status.apiHashConfigured ? '已配置' : '未配置' : '读取中'}<input type="password" autoComplete="new-password" maxLength={32} value={apiHash} onChange={e => setApiHash(e.target.value)} placeholder="留空保持原值" disabled={busy || authorizing} /></label>
        <label>Telegram 注册手机号<input type="tel" inputMode="tel" autoComplete="off" required maxLength={32} pattern={'\\+[1-9][0-9]{1,14}'} title="请填写 +国家区号和完整手机号，例如 +86 后接中国大陆手机号。" value={phone ?? status?.phone ?? ''} onChange={e => setPhone(e.target.value.replace(/[\s()-]/g, ''))} placeholder="+国家区号和完整手机号" disabled={busy || authorizing} /></label>
      </div>
      <div className={styles.formActions}><span>所有 Telegram 来源共用此账号。</span><button type="submit" disabled={busy || authorizing || !status?.control} className={dirty || !status?.phone ? styles.primary : undefined}>保存账号配置</button></div>
    </form>
    <section className={styles.card}>
      <h2>登录与采集</h2>
      {loadError && <p className={styles.error} role="alert">状态读取失败：{loadError}。当前显示上次结果。</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
      <TelegramConnectionPanel status={status} sources={sources} busy={busy} unsaved={dirty} onAction={act} />
    </section>
  </div>;
}
