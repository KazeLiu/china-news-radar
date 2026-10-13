'use client';
import { useEffect, useState } from 'react';
import { adminApi, type SourceSettings } from './admin-api';
import styles from './admin.module.css';
interface OperationGroup { kind: string; status: string; _count: number; _sum: { discovered: number | null; added: number | null; updated: number | null; duplicates: number | null; filtered: number | null } }
interface AiGroup { status: string; _count: number; _sum: { analyzedCount: number | null; translatedCount: number | null } }
interface LogRow { id: string; startedAt: string; kind: string; route: string; sourceId?: string; sourceIds?: string[]; status: string; elapsedMs: number | null; taskId?: string; requestId?: string; attempt?: number; errorCode?: string; errorReason?: string; error?: { message: string; detail?: string }; analyzedCount?: number; translatedCount?: number; discovered?: number; added?: number; updated?: number; duplicates?: number; filtered?: number }
interface LogPage { recordingStartedAt: string; recordingError: boolean; summary: { operations: OperationGroup[]; ai: AiGroup[]; retries: number }; items: LogRow[]; total: number; nextOffset: number | null }
const kinds: Record<string, string> = { collection: '正式采集', preview: '预览与测试', admin: '管理操作', ai: 'AI 实际请求', task: 'AI 任务收尾' };
const statuses: Record<string, string> = { success: '成功', failed: '失败', empty: '没有新内容', filtered: '全部被过滤', running: '处理中', 'invalid-response': '输出协议无效' };
const beijing = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
export function LogsPanel({ sources }: { sources: SourceSettings[] }) {
  const [date, setDate] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10));
  const [source, setSource] = useState(''); const [kind, setKind] = useState(''); const [status, setStatus] = useState(''); const [offset, setOffset] = useState(0);
  const [data, setData] = useState<LogPage | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<{ taskId: string; kind: string; status: string; attempts: number; error?: { message: string; detail?: string; requestId?: string } } | null>(null);
  async function load(nextOffset = 0) {
    setBusy(true); setError('');
    try { setData(await adminApi<LogPage>(`admin/logs?${new URLSearchParams({ date, source, kind, status, offset: String(nextOffset) })}`, '')); setOffset(nextOffset); }
    catch (e) { setError(e instanceof Error ? e.message : '日志读取失败'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let cancelled = false;
    const initialDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    adminApi<LogPage>(`admin/logs?date=${initialDate}`, '').then(next => { if (!cancelled) setData(next); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);
  const collected = data?.summary.operations.filter(group => group.kind === 'collection') || [];
  const total = (key: keyof OperationGroup['_sum']) => collected.reduce((sum, group) => sum + (group._sum[key] || 0), 0);
  const ai = data?.summary.ai || [];
  const name = (id: string) => id === 'manual' ? '管理员录入' : sources.find(source => source.id === id)?.name || id;
  return <section className={styles.card}><h2>日志与统计</h2><p>按北京时间查看每日汇总和时间线；AI 每日额度仍按 UTC。请求次数与处理文章条数分开计算，预览不计入正式新增。</p>
    <form className={styles.fields} onSubmit={e => { e.preventDefault(); void load(); }}>
      <label>日期（北京时间）<input type="date" required value={date} onChange={e => setDate(e.target.value)} disabled={busy} /></label>
      <label>来源 ID（留空为全部，支持已删除来源）<input list="log-sources" value={source} maxLength={64} onChange={e => setSource(e.target.value)} disabled={busy} /><datalist id="log-sources"><option value="manual">管理员录入</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</datalist></label>
      <label>时间线类型<select value={kind} onChange={e => setKind(e.target.value)} disabled={busy}><option value="">全部类型</option>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>时间线状态<select value={status} onChange={e => setStatus(e.target.value)} disabled={busy}><option value="">全部状态</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button type="submit" className={styles.primary} disabled={busy}>{busy ? '正在读取…' : '查看日志'}</button>
    </form>{error && <p className={styles.error} role="alert">{error}</p>}
    {data && <>{data.recordingError && <p className={styles.error} role="alert">近期操作日志保存失败，请检查数据库。业务结果未改变，时间线可能不完整。</p>}
      <p>采集与管理明细自 {beijing(data.recordingStartedAt)} 开始记录，保留 30 天。AI 汇总读取已保存的实际请求记录，不反推历史采集明细；旧请求没有来源归属，不能计入单一来源汇总。以下汇总按日期和来源计算，类型与状态仅筛选时间线。</p>
      <dl className={styles.aiFacts}>
        <div><dt>来源检查</dt><dd>{collected.reduce((sum, group) => sum + group._count, 0)} 次 · 失败 {collected.filter(group => group.status === 'failed').reduce((sum, group) => sum + group._count, 0)} 次 · 无新内容 {collected.filter(group => group.status === 'empty').reduce((sum, group) => sum + group._count, 0)} 次</dd></div>
        <div><dt>正式采集文章</dt><dd>发现 {total('discovered')} · 新增 {total('added')} · 更新 {total('updated')} · 重复 {total('duplicates')} · 采集筛选过滤 {total('filtered')}</dd></div>
        <div><dt>AI 实际请求</dt><dd>{ai.reduce((sum, group) => sum + group._count, 0)} 次 · 重试 {data.summary.retries} 次 · 成功 {ai.filter(group => group.status === 'success').reduce((sum, group) => sum + group._count, 0)} 次 · 失败/无效 {ai.filter(group => ['failed', 'invalid-response'].includes(group.status)).reduce((sum, group) => sum + group._count, 0)} 次</dd></div>
        <div><dt>AI 完成文章</dt><dd>分析 {ai.reduce((sum, group) => sum + (group._sum.analyzedCount || 0), 0)} 条 · 翻译 {ai.reduce((sum, group) => sum + (group._sum.translatedCount || 0), 0)} 条</dd></div>
      </dl><h3>时间线 · 共 {data.total} 条</h3>
      {data.items.map(row => <article key={`${row.kind}:${row.id}`} className={styles.sample}><h4>{kinds[row.kind]} · {statuses[row.status] || row.status}</h4>
        <small>{beijing(row.startedAt)} · {row.elapsedMs ?? '—'} 毫秒 · {[row.sourceId, ...(row.sourceIds || [])].filter((id): id is string => !!id).map(name).join('、') || '未绑定单一来源'}</small><p><code>{row.route}</code>{row.attempt ? ` · 第 ${row.attempt} 次请求` : ''}</p>
        {row.kind === 'collection' && <p>发现 {row.discovered} · 新增 {row.added} · 更新 {row.updated} · 重复 {row.duplicates} · 过滤 {row.filtered}</p>}
        {row.kind === 'ai' && <p>完成分析 {row.analyzedCount} 条 · 翻译 {row.translatedCount} 条</p>}
        {(row.error || row.errorCode) && <p className={styles.error}>{row.error?.message || row.errorReason || row.errorCode} {row.error?.detail}</p>}{row.requestId && <p>请求 ID：{row.requestId}</p>}
        {row.taskId && <button type="button" disabled={busy} onClick={async () => { try { setTask(await adminApi(`admin/ai/tasks/${row.taskId}`, '')); } catch (e) { setError(e instanceof Error ? e.message : '任务详情读取失败'); } }}>查看关联任务</button>}
      </article>)}{!data.items.length && <p>所选条件下没有日志。</p>}
      <div className={styles.actions}><button type="button" disabled={busy || !offset} onClick={() => void load(Math.max(0, offset - 50))}>上一页</button><button type="button" disabled={busy || data.nextOffset === null} onClick={() => void load(data.nextOffset!)}>下一页</button></div>
    </>}{task && <section className={styles.testResult}><h3>任务详情</h3><p>{task.taskId} · {task.kind} · {task.status} · 已发出 {task.attempts} 次请求</p>{task.error && <p className={styles.error}>{task.error.message} {task.error.detail}{task.error.requestId ? ` · 请求 ID：${task.error.requestId}` : ''}</p>}<button type="button" onClick={() => setTask(null)}>关闭详情</button></section>}
  </section>;
}
