'use client';
import { useEffect, useState } from 'react';
import { adminApi, type SourceSettings } from './admin-api';
import styles from './admin.module.css';
interface OperationGroup { kind: string; status: string; _count: number; _sum: { discovered: number | null; added: number | null; updated: number | null; duplicates: number | null; filtered: number | null } }
interface AiGroup { status: string; _count: number; _sum: { analyzedCount: number | null; translatedCount: number | null } }
interface ProcessDetails { newsItemId?: string; title?: string; aiStatus?: string; relation?: string; forceChina?: boolean; topics?: string[]; type?: string; language?: string; reason?: string; translated?: boolean; summaryOmitted?: boolean; inputCount?: number; count?: number; action?: string; purged?: number; attempts?: number; maxAttempts?: number; retryAt?: string; scoring?: { relevance: number; novelty: number; audience: number; quality: number; importance: string; tags: string[] } }
interface LogRow { id: string; startedAt: string; kind: string; route: string; model?: string; sourceId?: string; sourceIds?: string[]; status: string; elapsedMs: number | null; taskId?: string; requestId?: string; attempt?: number; errorCode?: string; errorReason?: string; error?: { message: string; detail?: string }; details?: ProcessDetails; analyzedCount?: number; translatedCount?: number; discovered?: number; added?: number; updated?: number; duplicates?: number; filtered?: number }
interface LogPage { retentionDays: number; recordingStartedAt: string; recordingError: boolean; summary: { operations: OperationGroup[]; ai: AiGroup[]; retries: number }; items: LogRow[]; total: number; nextOffset: number | null }
const kinds: Record<string, string> = { collection: '正式采集', preview: '预览与测试', admin: '管理操作', ai: 'AI 实际请求', task: 'AI 任务流程', analysis: '新闻分析结果' };
const statuses: Record<string, string> = { success: '成功', failed: '失败', empty: '没有新内容', filtered: '全部被过滤', running: '处理中', 'invalid-response': '输出协议无效', queued: '已入队', retrying: '等待重试', cached: '复用缓存', rules: '规则兜底' };
const aiKinds: Record<string, string> = { news: '新闻批量分析', digest: '日报生成', profile: '关注档案', parser: '网页解析辅助', test: '后台 AI 测试', json: '结构化生成', raw: '上游模型调用' };
const relations: Record<string, string> = { related: '涉华', unrelated: '不涉华', uncertain: '涉华关系不确定' };
const topics: Record<string, string> = { policy: '政策', economy: '经济', diplomacy: '外交', technology: '科技', security: '安全', society: '社会' };
const types: Record<string, string> = { breaking: '快讯', report: '报道', analysis: '分析', opinion: '评论', feature: '特写', sports: '体育', entertainment: '娱乐', other: '其他' };
const importance: Record<string, string> = { low: '普通', medium: '中等', high: '重要', urgent: '紧急' };
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
      <p>明细保留 {data.retentionDays ?? 7} 天，到期自动清理；新闻、译文、有效分析缓存和每日额度不会随日志删除。AI 处理结果从功能启用后记录，不补造历史。以下汇总按日期和来源计算，类型与状态仅筛选时间线。</p>
      <dl className={styles.aiFacts}>
        <div><dt>来源检查</dt><dd>{collected.reduce((sum, group) => sum + group._count, 0)} 次 · 失败 {collected.filter(group => group.status === 'failed').reduce((sum, group) => sum + group._count, 0)} 次 · 无新内容 {collected.filter(group => group.status === 'empty').reduce((sum, group) => sum + group._count, 0)} 次</dd></div>
        <div><dt>正式采集文章</dt><dd>发现 {total('discovered')} · 新增 {total('added')} · 更新 {total('updated')} · 重复 {total('duplicates')} · 采集筛选过滤 {total('filtered')}</dd></div>
        <div><dt>AI 实际请求</dt><dd>{ai.reduce((sum, group) => sum + group._count, 0)} 次 · 重试 {data.summary.retries} 次 · 成功 {ai.filter(group => group.status === 'success').reduce((sum, group) => sum + group._count, 0)} 次 · 失败/无效 {ai.filter(group => ['failed', 'invalid-response'].includes(group.status)).reduce((sum, group) => sum + group._count, 0)} 次</dd></div>
        <div><dt>AI 完成文章</dt><dd>分析 {ai.reduce((sum, group) => sum + (group._sum.analyzedCount || 0), 0)} 条 · 翻译 {ai.reduce((sum, group) => sum + (group._sum.translatedCount || 0), 0)} 条</dd></div>
        <div><dt>不调用模型的处理</dt><dd>缓存复用 {data.summary.operations.filter(group => group.kind === 'analysis' && group.status === 'cached').reduce((sum, group) => sum + group._count, 0)} 次 · 规则兜底 {data.summary.operations.filter(group => group.kind === 'analysis' && group.status === 'rules').reduce((sum, group) => sum + group._count, 0)} 次</dd></div>
        <div><dt>管理操作</dt><dd>{data.summary.operations.filter(group => group.kind === 'admin').reduce((sum, group) => sum + group._count, 0)} 次 · 失败 {data.summary.operations.filter(group => group.kind === 'admin' && group.status === 'failed').reduce((sum, group) => sum + group._count, 0)} 次</dd></div>
        <div><dt>预览与测试</dt><dd>{data.summary.operations.filter(group => group.kind === 'preview').reduce((sum, group) => sum + group._count, 0)} 次 · 失败 {data.summary.operations.filter(group => group.kind === 'preview' && group.status === 'failed').reduce((sum, group) => sum + group._count, 0)} 次</dd></div>
      </dl><h3>时间线 · 共 {data.total} 条</h3>
      {data.items.map(row => <article key={`${row.kind}:${row.id}`} className={styles.sample}><h4>{kinds[row.kind]}{aiKinds[row.route.split('/')[1]] ? ` · ${aiKinds[row.route.split('/')[1]]}` : ''} · {statuses[row.status] || row.status}</h4>
        <small>{beijing(row.startedAt)} · {row.elapsedMs ?? '—'} 毫秒 · {[row.sourceId, ...(row.sourceIds || [])].filter((id): id is string => !!id).map(name).join('、') || '未绑定单一来源'}</small><p><code>{row.route}</code>{row.attempt ? ` · 第 ${row.attempt} 次请求` : ''}</p>
        {row.kind === 'collection' && <p>发现 {row.discovered} · 新增 {row.added} · 更新 {row.updated} · 重复 {row.duplicates} · 过滤 {row.filtered}</p>}
        {row.kind === 'ai' && <p>完成分析 {row.analyzedCount} 条 · 翻译 {row.translatedCount} 条</p>}
        {row.model && <p>模型：{row.model}</p>}
        {row.details?.inputCount !== undefined && <p>本批 {row.details.inputCount} 条待分析内容</p>}
        {row.details?.count !== undefined && <p>{({ hideArticle: '隐藏文章', showArticle: '显示文章', hideImages: '隐藏图片', showImages: '显示图片', delete: '移入回收站', restore: '从回收站恢复' } as Record<string, string>)[row.details.action || '']} · {row.details.count} 条</p>}
        {row.details?.purged !== undefined && <p>已永久清理 {row.details.purged} 条超过 60 天的回收站新闻</p>}
        {row.details?.attempts !== undefined && <p>实际请求 {row.details.attempts} / {row.details.maxAttempts} 次{row.details.retryAt ? ` · 下次尝试 ${beijing(row.details.retryAt)}` : ''}</p>}
        {row.details?.newsItemId && <><p><strong>{row.details.title}</strong></p><p>新闻 ID：{row.details.newsItemId}{row.status === 'cached' ? ' · 复用缓存，本次没有模型请求' : ''}</p>
          <p>{row.details.relation ? relations[row.details.relation] : `分析状态：${row.details.aiStatus}`} · {row.details.summaryOmitted ? '摘要为空或为标题副本，省略摘要译文' : '保留独立摘要'}{row.details.translated !== undefined ? row.details.translated ? ' · 已有中文译文' : ' · 简体中文，无需翻译' : ''}</p>
          {row.details.forceChina && <p>来源已强制视为涉华；上方保留模型原始判断，实际展示仍检查新闻类型与排除规则。</p>}
          {row.details.topics && <p>主题：{row.details.topics.map(key => topics[key] || key).join('、')} · 类型：{types[row.details.type || ''] || row.details.type} · 原文语言：{row.details.language}</p>}
          {row.details.reason && <p>{row.details.reason}</p>}
          {row.details.scoring && <p>评分（0–10）：涉华 {row.details.scoring.relevance} · 新颖 {row.details.scoring.novelty} · 阅读价值 {row.details.scoring.audience} · 质量 {row.details.scoring.quality}<br />重要度：{importance[row.details.scoring.importance]} · 标签：{row.details.scoring.tags.join('、') || '无'}</p>}</>}
        {(row.error || row.errorCode) && <p className={styles.error}>{row.error?.message || row.errorReason || row.errorCode} {row.error?.detail}</p>}{row.requestId && <p>请求 ID：{row.requestId}</p>}
        {row.taskId && <button type="button" disabled={busy} onClick={async () => { try { setTask(await adminApi(`admin/ai/tasks/${row.taskId}`, '')); } catch (e) { setError(e instanceof Error ? e.message : '任务详情读取失败'); } }}>查看关联任务</button>}
      </article>)}{!data.items.length && <p>所选条件下没有日志。</p>}
      <div className={styles.actions}><button type="button" disabled={busy || !offset} onClick={() => void load(Math.max(0, offset - 50))}>上一页</button><button type="button" disabled={busy || data.nextOffset === null} onClick={() => void load(data.nextOffset!)}>下一页</button></div>
    </>}{task && <section className={styles.testResult}><h3>任务详情</h3><p>{task.taskId} · {task.kind} · {task.status} · 已发出 {task.attempts} 次请求</p>{task.error && <p className={styles.error}>{task.error.message} {task.error.detail}{task.error.requestId ? ` · 请求 ID：${task.error.requestId}` : ''}</p>}<button type="button" onClick={() => setTask(null)}>关闭详情</button></section>}
  </section>;
}
