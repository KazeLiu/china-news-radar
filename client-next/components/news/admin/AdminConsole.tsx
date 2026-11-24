'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, Bookmark, FileText, Globe, History, ListFilter, Radio, Rss, Network, Archive, X } from 'lucide-react';
import { adminApi, type AdminSettings } from './admin-api';
import { AiSettingsForm } from './AiSettingsForm';
import { AiTestPanel } from './AiTestPanel';
import { AiQueuePanel } from './AiQueuePanel';
import { SourceSettingsForm } from './SourceSettingsForm';
import { NetworkSettingsForm } from './NetworkSettingsForm';
import { BrowserSettingsForm } from './BrowserSettingsForm';
import { RulesSettingsForm } from './RulesSettingsForm';
import { NewsManagementPanel } from './NewsManagementPanel';
import { LogsPanel } from './LogsPanel';
import { TelegramAccountPanel } from './TelegramAccountPanel';
import { FollowSettingsPanel } from './FollowSettingsPanel';
import { ConfigMigrationPanel } from './ConfigMigrationPanel';
import styles from './admin.module.css';

const navigation = [
  { label: '采集', items: [
    { id: 'sources', label: '来源配置', Icon: Rss },
    { id: 'telegram', label: 'Telegram 账号', Icon: Radio },
    { id: 'network', label: '代理设置', Icon: Network },
    { id: 'browser', label: '采集浏览器', Icon: Globe },
  ] },
  { label: '内容', items: [
    { id: 'ai', label: 'AI 配置', Icon: Bot },
    { id: 'rules', label: '排除规则', Icon: ListFilter },
    { id: 'news', label: '新闻管理', Icon: FileText },
    { id: 'follows', label: '关注管理', Icon: Bookmark },
  ] },
  { label: '运维', items: [
    { id: 'logs', label: '日志统计', Icon: History },
    { id: 'migration', label: '配置迁移', Icon: Archive },
  ] },
] as const;
const tabs = navigation.flatMap<(typeof navigation)[number]['items'][number]>(group => group.items);
type Tab = (typeof tabs)[number]['id'];
const aiViews = [{ id: 'settings', label: '模型与额度' }, { id: 'test', label: '调用测试' }, { id: 'queue', label: '队列与请求' }] as const;
async function loadAdminSettings(token: string) {
  return adminApi<AdminSettings>('admin/config', token);
}
export function AdminConsole() {
  const [config, setConfig] = useState<AdminSettings | null>(null);
  const [tab, setTab] = useState<Tab>('ai');
  const [aiView, setAiView] = useState<(typeof aiViews)[number]['id']>('settings');
  const token = '';
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [initialized, setInitialized] = useState(true);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const expired = (event: Event) => { setConfig(null); setError((event as CustomEvent<string>).detail); };
    window.addEventListener('admin:expired', expired);
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    const selected = tabs.find(item => item.id === requestedTab);
    queueMicrotask(() => { if (!cancelled && selected) setTab(selected.id); });
    adminApi<{ initialized: boolean; authenticated: boolean }>('admin/auth/session', '').then(async session => {
      if (cancelled) return;
      setInitialized(session.initialized);
      if (session.authenticated) { const data = await loadAdminSettings(''); if (!cancelled) { setConfig(data); setError(''); } }
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '无法读取会话'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; window.removeEventListener('admin:expired', expired); };
  }, []);
  async function login() {
    setLoading(true); setError(''); setNotice('');
    try { await adminApi('admin/auth/login', '', { username, password }, 'POST'); setPassword(''); setConfig(await loadAdminSettings('')); }
    catch (e) { setError(e instanceof Error ? e.message : '无法读取配置'); }
    finally { setLoading(false); }
  }
  async function logout() {
    try { await adminApi('admin/auth/logout', '', {}, 'POST'); setConfig(null); setPassword(''); setError(''); setNotice('已退出登录'); }
    catch (e) { setError(e instanceof Error ? e.message : '退出失败'); }
  }
  async function save(path: string, body: unknown, method = 'PUT') {
    setBusy(true); setError(''); setNotice('');
    try {
      let next: AdminSettings;
      if (path.startsWith('sources/')) {
        await adminApi(path, token, body, 'PATCH'); next = await adminApi<AdminSettings>('admin/config', token);
      } else next = await adminApi<AdminSettings>(path, token, body, method);
      setConfig(next);
      if (!next.collectedSourceId && !next.importedSources) setNotice(method === 'DELETE' ? '来源已删除' : path === 'admin/rules' ? '规则已保存，已有新闻已重新筛选' : '设置已保存');
      return next;
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); return false; }
    finally { setBusy(false); }
  }
  function navigate(id: Tab) {
    if (busy || id === tab) return;
    setTab(id);
    setNotice('');
    setError('');
    window.history.replaceState(null, '', `/admin?tab=${id}`);
    window.scrollTo(0, 0);
  }

  return <div className={styles.console}>
    <header className={styles.header}><div className={styles.headerInner}>
      <div className={styles.brand}><Radio size={22} aria-hidden="true" /><span>China Radar</span><small>管理后台</small></div>
      <div className={styles.headerActions}><Link href="/" className={styles.back}><ArrowLeft size={16} />返回资讯</Link>{config && <button type="button" onClick={() => void logout()}>退出登录</button>}</div>
    </div></header>
    {loading || !config ? <main className={styles.login}>
      {loading ? <p className={styles.card} role="status">正在读取后台配置…</p> : <form className={styles.card} onSubmit={event => { event.preventDefault(); void login(); }}>
        <h1>{initialized ? '管理员登录' : '初始化管理员'}</h1>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {initialized ? <><label className={styles.fullField}>账号<input autoComplete="username" required maxLength={80} value={username} onChange={e => setUsername(e.target.value)} /></label><label className={styles.fullField}>密码<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={e => setPassword(e.target.value)} /></label><div className={styles.formActions}><button className={styles.primary} type="submit">登录</button></div></> : <>
          <p>在后端项目目录的终端执行：</p><pre><code>pnpm --filter ai-hot-radar-server admin:init</code></pre><p>按提示设置账号和密码（至少 12 个字符），然后刷新页面。使用测试数据库时，先将终端的 <code>DATABASE_URL</code> 指向同一数据库。</p>
        </>}
      </form>}
    </main> : <div className={styles.workspace}>
      <nav className={styles.sidebar} aria-label="后台导航">{navigation.map(group => <div className={styles.navGroup} key={group.label}>
        <p>{group.label}</p>
        {group.items.map(({ id, label, Icon }) => <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} disabled={busy} onClick={() => navigate(id)}><Icon size={17} aria-hidden="true" />{label}</button>)}
      </div>)}</nav>
      <main className={styles.main}>
        <select className={styles.mobileNav} aria-label="后台导航" value={tab} disabled={busy} onChange={event => { const next = tabs.find(item => item.id === event.target.value); if (next) navigate(next.id); }}>
          {navigation.map(group => <optgroup key={group.label} label={group.label}>{group.items.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</optgroup>)}
        </select>
        <h1 className={styles.pageTitle}>{tabs.find(item => item.id === tab)?.label}</h1>
        <div hidden={tab !== 'ai'}>
          <dl className={styles.metrics}>
            <div><dt>AI 状态</dt><dd>{config.status.aiMode === 'enabled' ? '已开启' : config.status.aiMode === 'missing-key' ? '待填密钥' : '规则兜底'}</dd></div>
            <div><dt>今日调用（UTC）</dt><dd>{config.status.aiDailyUsed} / {config.status.aiDailyLimit}</dd></div>
            <div><dt>待分析 / 失败</dt><dd>{config.status.aiPending} / {config.status.aiFailed}</dd></div>
          </dl>
          <nav className={styles.subnav} aria-label="AI 配置页面">{aiViews.map(({ id, label }) => <button type="button" key={id} aria-current={aiView === id ? 'true' : undefined} disabled={busy} onClick={() => setAiView(id)}>{label}</button>)}</nav>
          <div hidden={aiView !== 'settings'}><AiSettingsForm initial={config.ai} busy={busy} onSave={save} /></div>
          <div hidden={aiView !== 'test'}><AiTestPanel token={token} busy={busy} keyConfigured={config.ai.keyConfigured} onUsage={usage => setConfig(current => current ? { ...current, status: { ...current.status, aiDailyUsed: usage.used, aiDailyLimit: usage.limit } } : current)} /></div>
          <div hidden={aiView !== 'queue'}><AiQueuePanel active={tab === 'ai' && aiView === 'queue'} /></div>
        </div>
        {tab === 'telegram' && <TelegramAccountPanel sources={config.sources} />}
        <div hidden={tab !== 'sources'}><SourceSettingsForm sources={config.sources} network={config.network} token={token} busy={busy} onSave={save} onOpenNetwork={() => navigate('network')} aiKeyConfigured={config.ai.keyConfigured} onAiUsage={usage => setConfig(current => current ? { ...current, status: { ...current.status, aiDailyUsed: usage.used, aiDailyLimit: usage.limit } } : current)} /></div>
        {tab === 'network' && <NetworkSettingsForm initial={config.network} busy={busy} onSave={save} />}
        {tab === 'browser' && (config.browser ? <BrowserSettingsForm initial={config.browser} busy={busy} onSave={save} /> : <p className={styles.error} role="alert">后端尚未加载浏览器设置，请重启后端后刷新页面。</p>)}
        <div hidden={tab !== 'rules'}><RulesSettingsForm initial={config.rules} sources={config.sources} token={token} busy={busy} onSave={save} /></div>
        {tab === 'news' && <NewsManagementPanel sources={config.sources} />}
        {tab === 'follows' && <FollowSettingsPanel />}
        {tab === 'migration' && <ConfigMigrationPanel onBusy={setBusy} />}
        {tab === 'logs' && <LogsPanel sources={config.sources} />}
      </main>
      {(error || notice) && <div className={`${styles.feedback} ${error ? styles.error : styles.notice}`}>
        <span role={error ? 'alert' : 'status'}>{error || notice}</span>
        <button type="button" aria-label="关闭提示" onClick={() => { setError(''); setNotice(''); }}><X size={16} /></button>
      </div>}
    </div>}
  </div>;
}
