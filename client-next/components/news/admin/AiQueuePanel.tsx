'use client';

import { useEffect, useState } from 'react';
import { adminApi, type AiRequestPage } from './admin-api';
import { AiRequestDialog, aiRequestKinds, aiRequestStatuses, requestTime } from './AiRequestDialog';
import styles from './admin.module.css';

interface Queue { paused: boolean; queued: number; running: number; historical: number }

export function AiQueuePanel() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [requests, setRequests] = useState<AiRequestPage | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmHistory, setConfirmHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const [nextQueue, nextRequests] = await Promise.all([
          adminApi<Queue>('admin/ai/queue', ''),
          adminApi<AiRequestPage>(`admin/ai/requests?page=${page}`, ''),
        ]);
        if (cancelled) return;
        setQueue(nextQueue); setError('');
        if (page > nextRequests.totalPages) { setPage(nextRequests.totalPages); return; }
        setRequests(nextRequests);
      } catch (problem) {
        if (!cancelled) setError(problem instanceof Error ? problem.message : '请求记录读取失败');
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (page === 1) timer = setTimeout(() => void load(), 3000);
        }
      }
    }
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [page, revision]);

  function refresh() { setLoading(true); setRevision(value => value + 1); }
  function turnPage(next: number) { setLoading(true); setError(''); setPage(next); }
  async function action(path: string, body: unknown, method: string) {
    setBusy(true); setError('');
    try { setQueue(await adminApi<Queue>(path, '', body, method)); setConfirmHistory(false); refresh(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : '队列操作失败'); }
    finally { setBusy(false); }
  }

  return <section className={`${styles.card} ${styles.aiRequests}`}>
    <div className={styles.sectionTitle}><div><h2>请求详情</h2><p>每次实际调用单独记录，包括重试和失败。明细保留 {requests?.retentionDays ?? 7} 天；点击查看发送内容与模型返回。</p></div>
      <button type="button" disabled={loading} onClick={refresh}>{loading ? '读取中…' : '刷新记录'}</button></div>
    {queue && <>
      <p>{queue.paused ? '队列已暂停' : '队列运行中'} · 排队 {queue.queued} · 处理中 {queue.running} · 历史积压 {queue.historical}</p>
      <p>单个任务最多三次实际请求；重试耗尽后保留失败状态，不会重新自动入队。可在“新闻管理”单篇重试，或明确启动历史未完成新闻。</p>
      <div className={styles.actions}>
        <button type="button" disabled={busy} className={styles.secondary} onClick={() => void action('admin/ai/queue', { paused: !queue.paused }, 'PUT')}>{queue.paused ? '继续队列' : '暂停队列'}</button>
        <button type="button" disabled={busy} className={styles.secondary} onClick={() => setConfirmHistory(true)}>处理历史未完成新闻</button>
      </div>
      {confirmHistory && <div className={styles.notice}><p>此操作会把没有有效完成缓存的历史内容送入队列，产生实际模型请求并计入 UTC 每日额度。已完成内容继续复用缓存。</p>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void action('admin/ai/history', {}, 'POST')}>确认启动历史处理</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirmHistory(false)}>取消</button></div>}
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.requestList} aria-label="AI 实际请求记录" aria-busy={loading}>
      {requests?.items.map(request => <article key={request.id} className={styles.requestRow}>
        <div><strong>{aiRequestKinds[request.kind] || request.kind}</strong><span className={styles.requestStatus} data-status={request.status}>{aiRequestStatuses[request.status] || request.status}</span>
          <small>{requestTime(request.startedAt)} · {request.model} · 第 {request.attempt} 次尝试{request.elapsedMs !== null ? ` · ${(request.elapsedMs / 1000).toFixed(1)} 秒` : ''}</small></div>
        <button type="button" aria-haspopup="dialog" aria-label={`查看${requestTime(request.startedAt)}的${aiRequestKinds[request.kind] || request.kind}请求详情`} onClick={() => setSelectedId(request.id)}>查看详情</button>
      </article>)}
      {!requests && loading && <p role="status">正在读取请求记录…</p>}
      {requests && !requests.items.length && <p>暂无实际请求记录。</p>}
    </div>
    {requests && <nav className={`${styles.actions} ${styles.requestPagination}`} aria-label="请求记录分页">
      <span>共 {requests.total} 次请求 · 第 {requests.page} / {requests.totalPages} 页 · 北京时间</span>
      <button type="button" disabled={loading || page <= 1} onClick={() => turnPage(page - 1)}>上一页</button>
      <button type="button" disabled={loading || page >= requests.totalPages} onClick={() => turnPage(page + 1)}>下一页</button>
    </nav>}
    {selectedId && <AiRequestDialog key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} />}
  </section>;
}
