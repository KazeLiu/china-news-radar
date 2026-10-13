'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, ListFilter, Moon, Radio, Rss, Sun } from 'lucide-react';
import { useTheme } from '@/providers/ThemeProvider';
import { adminApi, type AdminSettings } from './admin-api';
import { AiSettingsForm } from './AiSettingsForm';
import { AiTestPanel } from './AiTestPanel';
import { SourceSettingsForm } from './SourceSettingsForm';
import { RulesSettingsForm } from './RulesSettingsForm';
import base from '../news.module.css';
import styles from './admin.module.css';

type Tab = 'ai' | 'sources' | 'rules';
const tabs = [{ id: 'ai' as const, label: 'AI 配置', Icon: Bot }, { id: 'sources' as const, label: '来源配置', Icon: Rss }, { id: 'rules' as const, label: '过滤规则', Icon: ListFilter }];
async function loadAdminSettings(token: string) {
  const [config, key] = await Promise.all([adminApi<AdminSettings>('admin/config', token), adminApi<{ apiKey: string }>('admin/ai/key', token)]);
  return { config, apiKey: key.apiKey };
}
export function AdminConsole() {
  const { theme, toggleTheme } = useTheme();
  const [config, setConfig] = useState<AdminSettings | null>(null);
  const [savedApiKey, setSavedApiKey] = useState('');
  const [tab, setTab] = useState<Tab>('ai');
  const token = '';
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [initialized, setInitialized] = useState(true);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const expired = (event: Event) => { setConfig(null); setSavedApiKey(''); setError((event as CustomEvent<string>).detail); };
    window.addEventListener('admin:expired', expired);
    const selected = new URLSearchParams(window.location.search).get('tab');
    queueMicrotask(() => { if (!cancelled && (selected === 'sources' || selected === 'rules')) setTab(selected); });
    adminApi<{ initialized: boolean; authenticated: boolean }>('admin/auth/session', '').then(async session => {
      if (cancelled) return;
      setInitialized(session.initialized);
      if (session.authenticated) { const data = await loadAdminSettings(''); if (!cancelled) { setConfig(data.config); setSavedApiKey(data.apiKey); setError(''); } }
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '无法读取会话'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; window.removeEventListener('admin:expired', expired); };
  }, []);
  async function login() {
    setLoading(true); setError('');
    try { await adminApi('admin/auth/login', '', { username, password }, 'POST'); setPassword(''); const data = await loadAdminSettings(''); setConfig(data.config); setSavedApiKey(data.apiKey); }
    catch (e) { setError(e instanceof Error ? e.message : '无法读取配置'); }
    finally { setLoading(false); }
  }
  async function logout() {
    try { await adminApi('admin/auth/logout', '', {}, 'POST'); setConfig(null); setSavedApiKey(''); setPassword(''); setNotice('已退出登录'); }
    catch (e) { setError(e instanceof Error ? e.message : '退出失败'); }
  }
  async function save(path: string, body: unknown, method = 'PUT') {
    setBusy(true); setError(''); setNotice('');
    try {
      if (path.startsWith('sources/')) {
        await adminApi(path, token, body, 'PATCH'); setConfig(await adminApi<AdminSettings>('admin/config', token));
      } else setConfig(await adminApi<AdminSettings>(path, token, body, method));
      if (path === 'admin/ai') {
        const key = (body as { apiKey?: string }).apiKey;
        if (key?.trim()) setSavedApiKey(key.trim());
      }
      setNotice(method === 'DELETE' ? '来源已删除，已停止采集，已有新闻和收藏已保留。' : path === 'admin/rules' ? '规则已保存，已有记录已重新筛选，收藏和时间已保留。' : '配置已保存并生效。');
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); return false; }
    finally { setBusy(false); }
  }
  return <div className={`${base.app} ${styles.console}`}>
    <header className={base.header}><Link href="/" className={styles.brand}><Radio size={24} /><span>CHINA <b>RADAR</b><small>管理工作台</small></span></Link><div className={base.headerRight}><Link href="/" className={styles.back}><ArrowLeft size={16} />返回资讯</Link>{config && <button className={styles.secondary} onClick={() => void logout()}>退出登录</button>}<button className={base.iconButton} onClick={toggleTheme} aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button></div></header>
    <main className={styles.main}><div className={styles.intro}><p>ADMIN CONSOLE</p><h1>把信息入口交给你。</h1><span>管理来源、排除噪音，统一配置 AI 分析与翻译。</span></div>
      {config && <div className={styles.metrics}><div><small>AI 状态</small><strong>{config.status.aiMode === 'enabled' ? '已开启' : config.status.aiMode === 'missing-key' ? '待填密钥' : '规则兜底'}</strong></div><div><small>今日调用 / UTC</small><strong>{config.status.aiDailyUsed} / {config.status.aiDailyLimit}</strong></div><div><small>待分析 / 失败</small><strong>{config.status.aiPending} / {config.status.aiFailed}</strong></div><div><small>会话有效期</small><strong>8 小时</strong></div></div>}
      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice} role="status">{notice}</div>}
      {loading ? <div className={styles.card} role="status">正在读取后台配置…</div> : !config ? <form className={styles.card} onSubmit={event => { event.preventDefault(); void login(); }}><h2>管理员登录</h2>{!initialized ? <p>尚未设置管理员。请在服务器交互终端运行 <code>pnpm --filter ai-hot-radar-server admin:init</code>，预览副本需指定 DATABASE_URL。</p> : <><label className={styles.fullField}>账号<input autoComplete="username" required maxLength={80} value={username} onChange={e => setUsername(e.target.value)} /></label><label className={styles.fullField}>密码<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={e => setPassword(e.target.value)} /></label><button className={styles.primary} type="submit">进入后台</button></>}</form> : <>
        <nav className={styles.tabs} aria-label="后台配置导航">{tabs.map(({ id, label, Icon }) => <button key={id} aria-pressed={tab === id} className={tab === id ? styles.activeTab : ''} disabled={busy} onClick={() => { setTab(id); setNotice(''); window.history.replaceState(null, '', `/admin?tab=${id}`); }}><Icon size={18} />{label}</button>)}</nav>
        <div hidden={tab !== 'ai'}><AiSettingsForm initial={config.ai} savedApiKey={savedApiKey} busy={busy} onSave={save} /><AiTestPanel token={token} busy={busy} keyConfigured={config.ai.keyConfigured} onUsage={usage => setConfig(current => current ? { ...current, status: { ...current.status, aiDailyUsed: usage.used, aiDailyLimit: usage.limit } } : current)} /></div>
        <div hidden={tab !== 'sources'}><SourceSettingsForm sources={config.sources} token={token} busy={busy} onSave={save} /></div>
        <div hidden={tab !== 'rules'}><RulesSettingsForm initial={config.rules} sources={config.sources} token={token} busy={busy} onSave={save} /></div>
        <p className={styles.footnote}>配置和会话保存在本站数据库。账号初始化或重置后，旧会话立即失效。</p>
      </>}
    </main>
  </div>;
}
