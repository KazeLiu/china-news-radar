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
  return <section className={styles.card}>
    <div className={styles.sectionTitle}><div><h2>Telegram 账号配置</h2><p>保存一次账号资料，再在本页完成登录。所有 Telegram 来源共用此账号。</p></div></div>
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    <form aria-label="Telegram 账号配置" onSubmit={async event => {
      event.preventDefault(); if (busy || authorizing || !status?.control) return;
      setBusy(true); setError(''); setNotice('');
      try {
        setStatus(await adminApi<TelegramStatus>('admin/telegram', '', { apiId, apiHash, phone: phone ?? status.phone }));
        setApiId(''); setApiHash(''); setPhone(null); setNotice('账号配置已保存。下一步点击“开始登录”；已有有效登录时可直接启动采集。');
      } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
      finally { setBusy(false); }
    }}>
      <div className={styles.fields}>
        <label>TG_API_ID · {status ? status.apiIdConfigured ? '已配置' : '未配置' : '读取中'}<input type="password" autoComplete="new-password" maxLength={10} value={apiId} onChange={e => setApiId(e.target.value)} placeholder="留空保持原值" disabled={busy || authorizing} /></label>
        <label>TG_API_HASH · {status ? status.apiHashConfigured ? '已配置' : '未配置' : '读取中'}<input type="password" autoComplete="new-password" maxLength={32} value={apiHash} onChange={e => setApiHash(e.target.value)} placeholder="留空保持原值" disabled={busy || authorizing} /></label>
        <label>Telegram 注册手机号<input type="tel" inputMode="tel" autoComplete="off" required maxLength={32} pattern={'\\+[1-9][0-9]{1,14}'} title="请填写 +国家区号和完整手机号，例如 +86 后接中国大陆手机号。" value={phone ?? status?.phone ?? ''} onChange={e => setPhone(e.target.value.replace(/[\s()-]/g, ''))} placeholder="+国家区号和完整手机号" disabled={busy || authorizing} /></label>
      </div>
      <p className={styles.hint}>API ID / Hash 标识应用，不是账号登录凭据；留空保留原值。手机号保存到本站后台，仅管理员可见；例如中国大陆号码填写 +86 后接完整手机号。</p>
      <div className={styles.actions}><button type="submit" disabled={busy || authorizing || !status?.control} className={dirty || !status?.phone ? styles.primary : undefined}>保存账号配置</button></div>
    </form>
    {loadError && <p className={styles.error} role="alert">状态读取失败：{loadError}。页面暂时保留上次结果。</p>}
    <TelegramConnectionPanel status={status} sources={sources} busy={busy} unsaved={dirty} onAction={act} />
  </section>;
}
