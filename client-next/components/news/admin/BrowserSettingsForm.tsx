'use client';

import { useState } from 'react';
import type { BrowserPreferences, BrowserSettings, SaveSettings } from './admin-api';
import styles from './admin.module.css';

export function BrowserSettingsForm({ initial, busy, onSave }: { initial: BrowserSettings; busy: boolean; onSave: SaveSettings }) {
  const [draft, setDraft] = useState<BrowserPreferences>(() => ({ initialWaitSeconds: initial.initialWaitSeconds, navigationQuietSeconds: initial.navigationQuietSeconds, sessionTimeoutSeconds: initial.sessionTimeoutSeconds }));
  const [error, setError] = useState('');
  return <form className={styles.card} onSubmit={async event => {
    event.preventDefault(); setError('');
    if (draft.initialWaitSeconds + draft.navigationQuietSeconds >= draft.sessionTimeoutSeconds) { setError('会话上限应大于初始观察与跳转稳定等待之和'); return; }
    await onSave('admin/browser', draft);
  }}>
    <h2>采集浏览器</h2>
    <p>内核配置：{initial.runtime.engine} {initial.runtime.version} · {initial.runtime.platform} · {({ headed: '有窗口', virtual: '虚拟显示', headless: '无头' } as Record<string, string>)[initial.runtime.mode] || initial.runtime.mode}。使用独立浏览器，不连接个人 Chrome。</p>
    <fieldset className={styles.fields} disabled={busy}>
      <label>初始观察时间（秒）<input type="number" required min={0} max={120} value={draft.initialWaitSeconds} onChange={event => setDraft(old => ({ ...old, initialWaitSeconds: Number(event.target.value) }))} /><small>默认 {initial.defaults.initialWaitSeconds} 秒。首次访问后至少观察这段时间，再检查页面；0 表示不额外等待。访问拒绝或安全错误仍会直接结束。</small></label>
      <label>跳转稳定等待（秒）<input type="number" required min={1} max={30} value={draft.navigationQuietSeconds} onChange={event => setDraft(old => ({ ...old, navigationQuietSeconds: Number(event.target.value) }))} /><small>默认 {initial.defaults.navigationQuietSeconds} 秒。页面加载完成且连续这段时间没有新跳转，才读取 HTML 和截图。</small></label>
      <label>整次页面会话上限（秒）<input type="number" required min={30} max={300} value={draft.sessionTimeoutSeconds} onChange={event => setDraft(old => ({ ...old, sessionTimeoutSeconds: Number(event.target.value) }))} /><small>默认 {initial.defaults.sessionTimeoutSeconds} 秒，最多 300 秒。包括页面观察、正常验证跳转、翻页与截图；这是最长等待，不是每次固定停留时长。</small></label>
    </fieldset>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={styles.hint}>来源中的“每次页面操作超时”控制单个加载或按钮操作，这里的上限控制整轮。持续验证、验证码、登录或付费限制会明确报错，不自动点击或绕过。</p>
    <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>保存浏览器设置</button><button type="button" disabled={busy} onClick={() => { setDraft({ ...initial.defaults }); setError(''); }}>恢复默认值</button><span>保存后用于下一次网页测试、自动采集和 URL 导入，正在运行的任务不受影响。</span></div>
  </form>;
}
