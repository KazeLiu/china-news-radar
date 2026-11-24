'use client';

import { useState } from 'react';
import type { BrowserPreferences, BrowserSettings, SaveSettings } from './admin-api';
import styles from './admin.module.css';

export function BrowserSettingsForm({ initial, busy, onSave }: { initial: BrowserSettings; busy: boolean; onSave: SaveSettings }) {
  const [draft, setDraft] = useState<BrowserPreferences>(() => ({ initialWaitSeconds: initial.initialWaitSeconds, navigationQuietSeconds: initial.navigationQuietSeconds, sessionTimeoutSeconds: initial.sessionTimeoutSeconds }));
  const [error, setError] = useState('');
  return <form className={`${styles.card} ${styles.compact}`} onSubmit={async event => {
    event.preventDefault(); setError('');
    if (draft.initialWaitSeconds + draft.navigationQuietSeconds >= draft.sessionTimeoutSeconds) { setError('会话上限应大于初始观察与跳转稳定等待之和'); return; }
    await onSave('admin/browser', draft);
  }}>
    <h2>页面加载</h2>
    <p className={styles.hint}>{initial.runtime.engine} {initial.runtime.version} · {initial.runtime.platform} · {({ headed: '有窗口', virtual: '虚拟显示', headless: '无头' } as Record<string, string>)[initial.runtime.mode] || initial.runtime.mode}</p>
    <fieldset className={styles.fields} disabled={busy}>
      <label>初始观察（秒）<input type="number" required min={0} max={120} value={draft.initialWaitSeconds} onChange={event => setDraft(old => ({ ...old, initialWaitSeconds: Number(event.target.value) }))} /><small>首次打开页面后等待，0 表示不额外等待。</small></label>
      <label>跳转稳定等待（秒）<input type="number" required min={1} max={30} value={draft.navigationQuietSeconds} onChange={event => setDraft(old => ({ ...old, navigationQuietSeconds: Number(event.target.value) }))} /><small>页面加载后无跳转达到此时长才读取。</small></label>
      <label>会话上限（秒）<input type="number" required min={30} max={300} value={draft.sessionTimeoutSeconds} onChange={event => setDraft(old => ({ ...old, sessionTimeoutSeconds: Number(event.target.value) }))} /><small>整轮上限，包含观察、跳转、翻页和截图。</small></label>
    </fieldset>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.formActions}><span>仅对新任务生效。</span><button type="button" disabled={busy} onClick={() => { setDraft({ ...initial.defaults }); setError(''); }}>恢复默认值</button><button type="submit" className={styles.primary} disabled={busy}>{busy ? '保存中…' : '保存浏览器设置'}</button></div>
  </form>;
}
