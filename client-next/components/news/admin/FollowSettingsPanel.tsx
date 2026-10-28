'use client';

import { useEffect, useState } from 'react';
import { keywordsApi, type Keyword } from '@/services/api';
import { adminApi } from './admin-api';
import styles from './admin.module.css';

interface FollowAccessSettings { configured: boolean; password: string; sessionHours: number }
export function FollowSettingsPanel() {
  const [items, setItems] = useState<Keyword[]>([]);
  const [configured, setConfigured] = useState(false);
  const [password, setPassword] = useState('');
  const [sessionHours, setSessionHours] = useState('24');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState('');
  const [deleting, setDeleting] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    Promise.all([keywordsApi.getAll(), adminApi<FollowAccessSettings>('admin/follows/access', '')]).then(([rows, access]) => {
      if (!cancelled) { setItems(rows); setConfigured(access.configured); setPassword(access.password); setSessionHours(String(access.sessionHours)); setReady(true); }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '关注配置读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  async function savePassword(event: React.FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    setBusy(true);
    try {
      const access = await adminApi<FollowAccessSettings>('admin/follows/access', '', { password, sessionHours: Number(sessionHours) }, 'PUT');
      setConfigured(access.configured); setPassword(access.password); setSessionHours(String(access.sessionHours));
      setNotice('访问设置已保存，旧的访问会话已失效。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '访问密码保存失败'); }
    finally { setBusy(false); }
  }
  async function saveItem(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (editing) await keywordsApi.update(editing, { text: text.trim() });
      else await keywordsApi.create({ text: text.trim() });
      setItems(await keywordsApi.getAll()); setText(''); setEditing(''); setNotice('关注列表已更新。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '关注项保存失败'); }
    finally { setBusy(false); }
  }
  async function changeItem(item: Keyword, remove = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      if (remove) await keywordsApi.delete(item.id);
      else await keywordsApi.update(item.id, { isActive: !item.isActive });
      setItems(await keywordsApi.getAll()); setDeleting('');
      if (remove && editing === item.id) { setEditing(''); setText(''); }
      setNotice(remove ? '关注项已删除，采集新闻保留。' : '关注项状态已更新。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '关注项修改失败'); }
    finally { setBusy(false); }
  }
  if (loading) return <div className={styles.card} role="status">正在读取关注配置…</div>;
  if (!ready) return <p role="alert" className={styles.error}>{error} 请重新进入关注管理。</p>;
  return <div className="space-y-5">
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <form onSubmit={savePassword} className={styles.card}>
      <div className={styles.sectionTitle}><h2>访问密码</h2><span>{configured ? '已设置' : '未设置 · 外部访问已关闭'}</span></div>
      <p>内部人员凭此密码只读查看。保存设置后，旧的解锁会话立即失效。</p>
      <div className={styles.fields}>
        <label>访问密码<input type="text" autoComplete="off" spellCheck={false} required minLength={12} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
        <label>解锁时长（小时）<input type="number" required min={1} max={720} step={1} value={sessionHours} onChange={event => setSessionHours(event.target.value)} disabled={busy} /></label>
      </div>
      <button type="submit" className={styles.primary} disabled={busy || !password}>{busy ? '正在保存…' : '保存访问设置'}</button>
    </form>
    <section className={styles.card} aria-label="关注列表管理">
      <h2>关注列表</h2>
      <form onSubmit={saveItem} className="mb-6 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1">{editing ? '编辑关注项' : '新增关注项'}<input required maxLength={200} value={text} onChange={event => setText(event.target.value)} disabled={busy} placeholder="国家、机构、人物或议题" /></label>
        <button type="submit" className={styles.primary} disabled={busy || !text.trim()}>{editing ? '保存修改' : '添加关注'}</button>
        {editing && <button type="button" disabled={busy} onClick={() => { setEditing(''); setText(''); }}>取消编辑</button>}
      </form>
      <ul className="space-y-3">
        {items.map(item => <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--line)] p-4">
          <div className="min-w-0 flex-1"><strong className="break-all">{item.text}</strong><span className="ml-3 text-xs text-[var(--muted)]">{item.isActive ? '启用' : '暂停'}</span></div>
          {deleting === item.id ? <><span>确认删除？</span><button type="button" disabled={busy} className={styles.danger} onClick={() => void changeItem(item, true)}>确认删除</button><button type="button" disabled={busy} onClick={() => setDeleting('')}>取消</button></> : <>
            <button type="button" disabled={busy} onClick={() => { setEditing(item.id); setText(item.text); setDeleting(''); }}>编辑</button>
            <button type="button" disabled={busy} onClick={() => void changeItem(item)}>{item.isActive ? '暂停' : '启用'}</button>
            <button type="button" disabled={busy} className={styles.danger} onClick={() => setDeleting(item.id)}>删除</button>
          </>}
        </li>)}
      </ul>
      {!items.length && <p>暂无关注项。</p>}
    </section>
  </div>;
}
