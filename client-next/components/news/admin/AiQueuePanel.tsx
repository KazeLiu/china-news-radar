'use client';
import { useEffect, useState } from 'react';
import { adminApi } from './admin-api';
import styles from './admin.module.css';
interface Queue { paused: boolean; queued: number; running: number; historical: number; tasks: Array<{ id: string; kind: string; status: string; attempts: number; error?: { message: string; detail?: string; requestId?: string } }> }
export function AiQueuePanel() {
  const [queue, setQueue] = useState<Queue | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [confirmHistory, setConfirmHistory] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => adminApi<Queue>('admin/ai/queue', '').then(data => { if (!cancelled) { setQueue(data); setError(''); } }).catch(e => { if (!cancelled) setError(e.message); });
    void load(); const timer = setInterval(() => void load(), 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  async function action(path: string, body: unknown, method: string) {
    setBusy(true); setError('');
    try { setQueue(await adminApi<Queue>(path, '', body, method)); setConfirmHistory(false); }
    catch (e) { setError(e instanceof Error ? e.message : '队列操作失败'); }
    finally { setBusy(false); }
  }
  return <section className={styles.card}><h2>AI 任务队列</h2><p>固定单并发。暂停停止下一次请求，正在处理的请求正常收尾。历史任务需要明确启动。</p>{error && <p className={styles.error} role="alert">{error}</p>}{queue && <>
    <p>{queue.paused ? '已暂停' : '运行中'} · 排队 {queue.queued} · 处理中 {queue.running} · 历史积压 {queue.historical}</p>
    <div className={styles.actions}><button type="button" disabled={busy} className={styles.secondary} onClick={() => void action('admin/ai/queue', { paused: !queue.paused }, 'PUT')}>{queue.paused ? '继续队列' : '暂停队列'}</button><button type="button" disabled={busy} className={styles.secondary} onClick={() => setConfirmHistory(true)}>处理历史未完成新闻</button></div>
    {confirmHistory && <div className={styles.notice}><p>此操作会把没有有效完成缓存的历史内容送入队列，产生实际模型请求并计入 UTC 每日额度。已完成内容继续复用缓存。</p><button type="button" className={styles.primary} disabled={busy} onClick={() => void action('admin/ai/history', {}, 'POST')}>确认启动历史处理</button><button type="button" className={styles.secondary} onClick={() => setConfirmHistory(false)}>取消</button></div>}
    <ul>{queue.tasks.map(task => <li key={task.id}><strong>{task.kind}</strong> · {task.status} · 实际请求 {task.attempts} 次 <small>{task.id}</small>{task.error && <p>{task.error.message} {task.error.detail}{task.error.requestId ? ` · 请求 ID：${task.error.requestId}` : ''}</p>}</li>)}</ul>
  </>}</section>;
}
