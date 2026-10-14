'use client';

import { useEffect, useState } from 'react';
import { adminApi, type SourceSettings } from './admin-api';
import styles from './admin.module.css';

interface TelegramStatus {
  apiIdConfigured: boolean; apiHashConfigured: boolean; collectorCredentialsConfigured: boolean; collectorOnline: boolean;
  session: 'authorized' | 'unauthorized' | 'missing' | 'disconnected' | 'unknown'; checkedAt: string | null;
  channels: { sourceId: string; channel: string; subscribed: boolean }[];
}
const sessionLabels = { authorized: '已授权', unauthorized: '授权已失效，请在交互终端重新登录', missing: '未找到 session，请在交互终端登录', disconnected: '已断开连接', unknown: '尚未确认，等待采集器上报' };

export function TelegramAccountPanel({ sources }: { sources: SourceSettings[] }) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [apiId, setApiId] = useState(''); const [apiHash, setApiHash] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => { void adminApi<TelegramStatus>('admin/telegram', '').then(value => { if (active) { setStatus(value); setError(''); } }).catch(e => { if (active) setError(e instanceof Error ? e.message : '无法读取 Telegram 状态'); }); };
    refresh(); const timer = setInterval(refresh, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <form className={styles.card} onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { setStatus(await adminApi<TelegramStatus>('admin/telegram', '', { apiId, apiHash })); setApiId(''); setApiHash(''); setNotice('配置已保存。采集器每分钟读取更新；API 凭据不会自动完成账号授权。'); }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(false); }
  }}>
    <div className={styles.sectionTitle}><div><h2>Telegram 账号配置</h2><p>此账号的所有 Telegram 来源共享 API 凭据，不在来源中重复填写。</p></div></div>
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    <div className={styles.fields}>
      <label>TG_API_ID · {status ? status.apiIdConfigured ? '已配置' : '未配置' : '读取中'}<input type="password" autoComplete="new-password" maxLength={10} value={apiId} onChange={e => setApiId(e.target.value)} placeholder="留空保持原值" /></label>
      <label>TG_API_HASH · {status ? status.apiHashConfigured ? '已配置' : '未配置' : '读取中'}<input type="password" autoComplete="new-password" maxLength={32} value={apiHash} onChange={e => setApiHash(e.target.value)} placeholder="留空保持原值" /></label>
    </div>
    <p className={styles.hint}>密钥不能从后台读回。保存后输入框清空，部署环境变量仍可使用；数据库中保存的新值优先。</p>
    <div className={styles.actions}><button className={styles.primary} disabled={busy} type="submit">{busy ? '保存中…' : '保存 Telegram 凭据'}</button></div>
    <h3>账号授权与频道匹配</h3>
    <p>采集器：{status?.collectorOnline ? '在线' : '未在线或未收到心跳'}　Telegram session：{status ? sessionLabels[status.session] : '读取中'}</p>
    {status?.collectorCredentialsConfigured && (!status.apiIdConfigured || !status.apiHashConfigured) && <p className={styles.hint}>采集器环境中已配置 API 凭据；上方状态只表示本站服务器保存或配置的凭据。</p>}
    <p className={styles.hint}>在采集器的交互终端运行 <code>python login.py</code> 完成 Telethon 登录。验证码和两步验证密码仅在该终端输入，不在网页传递。session 保留在采集器的持久目录中。</p>
    <p className={styles.hint}>在“来源配置”填写展示名称和公开频道用户名，并启用来源；账号须先在 Telegram 客户端订阅该频道。采集器每 60 秒刷新匹配，无需重启项目；不会自动加入频道或读取私聊。</p>
    <ul>{sources.filter(source => source.kind === 'telegram').map(source => {
      const channel = status?.channels.find(row => row.sourceId === source.id && row.channel.toLowerCase() === source.channel?.toLowerCase());
      return <li key={source.id}>{source.name} · @{source.channel}：{!source.state?.enabled ? '来源未启用' : channel ? channel.subscribed ? '频道已匹配' : '未订阅或公开用户名不匹配' : '等待采集器刷新匹配'}</li>;
    })}</ul>
  </form>;
}
