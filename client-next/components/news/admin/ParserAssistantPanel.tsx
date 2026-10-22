'use client';
import { useState } from 'react';
import { waitForAiTask, type AiTicket } from '@/services/ai-tasks';
import { adminApi, type AdminSettings, type SaveSettings, type SourceSettings, type SourceTestResult, type WebRules, type WebPagePreview } from './admin-api';
import { SourceTestPanel } from './SourceTestPanel';
import styles from './admin.module.css';
export function ParserAssistantPanel({ page, getSource, source, instructions, onInstructions, disabled, keyConfigured, onSave, onApplied, onBusy }: { page: WebPagePreview | null; getSource: () => SourceSettings; source: SourceSettings; instructions: string; onInstructions: (value: string) => void; disabled: boolean; keyConfigured: boolean; onSave: SaveSettings; onApplied: (settings: AdminSettings) => void; onBusy: (busy: boolean) => void }) {
  const [candidate, setCandidate] = useState<{ taskId: string; rules: WebRules } | null>(null); const [preview, setPreview] = useState<SourceTestResult | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [candidateContext, setCandidateContext] = useState('');
  const [previewContext, setPreviewContext] = useState('');
  const context = () => { const draft = getSource(); return JSON.stringify([page?.snapshotId, draft.target, draft.web?.rules, draft.web?.parseInstructions || '']); };
  const extractionContext = () => { const draft = getSource(); return JSON.stringify([context(), draft.web?.maxItems, draft.timeZone, !!draft.forceChina]); };
  const current = candidateContext === context();
  const previewCurrent = previewContext === extractionContext();
  const expired = !!page && new Date(page.expiresAt).getTime() <= Date.now();
  function working(value: boolean) { setBusy(value); onBusy(value); }
  async function generate() {
    if (!page) return;
    working(true); setError(''); setCandidate(null); setPreview(null); setCandidateContext(context());
    try {
      const ticket = await adminApi<AiTicket>('admin/sources/rules/assist', '', { source: getSource(), snapshotId: page.snapshotId }, 'POST');
      const result = await waitForAiTask<{ rules: WebRules }>(ticket);
      setCandidate({ taskId: ticket.taskId, rules: result.rules });
    } catch (e) { setError(e instanceof Error ? e.message : '候选生成失败'); }
    finally { working(false); }
  }
  async function inspect() {
    if (!candidate || !page) return;
    if (!current) { setError('解析配置已修改，请重新生成候选'); return; }
    working(true); setError(''); setPreview(null); setPreviewContext(extractionContext());
    try { setPreview(await adminApi<SourceTestResult>('admin/sources/rules/preview', '', { taskId: candidate.taskId, snapshotId: page.snapshotId, source: getSource() }, 'POST')); }
    catch (e) { setError(e instanceof Error ? e.message : '候选预览失败'); }
    finally { working(false); }
  }
  async function apply() {
    if (!candidate || !page || !preview?.ok || !previewCurrent) return;
    if (!current) { setError('解析配置已修改，请重新生成候选'); return; }
    working(true); setError('');
    try {
      const saved = await onSave('admin/sources/rules/apply', { taskId: candidate.taskId, snapshotId: page.snapshotId, source: getSource() }, 'POST');
      if (saved) { onApplied(saved); setCandidate(null); setPreview(null); }
    } catch (e) { setError(e instanceof Error ? e.message : '候选保存失败'); }
    finally { working(false); }
  }
  return <section className={styles.card}><h2>解析结构</h2><p>使用上方已加载的 HTML 生成规则，再预览下方文章列表。确认后自动填写并保存自动采集规则；这些步骤不再打开浏览器，也不保存新闻或发送通知。</p><p className={styles.hint}>辅助生成发送去噪、压缩重复结构后的页面样本，最多 24,000 字符，不含图片地址，消耗一次 AI 额度。预览仍使用完整 HTML 提取图片，预览和保存不调用 AI。</p>
    {!page ? <p role="status">请先点击“测试加载网页”。</p> : expired ? <p role="status" className={styles.error}>页面快照已过期，请重新测试加载网页。</p> : <p className={styles.hint}>正在使用 {new Date(page.loadedAt).toLocaleTimeString('zh-CN')} 加载的页面；快照有效至 {new Date(page.expiresAt).toLocaleTimeString('zh-CN')}。修改网址或页面加载配置后需要重新加载。</p>}
    {source.state?.parse && <details className={styles.details}><summary>最近采集检查与字段匹配数量</summary><pre>{JSON.stringify(source.state.parse, null, 2)}</pre></details>}
    <label>AI 解析提示（可选）<textarea rows={3} maxLength={2000} value={instructions} disabled={disabled || busy} onChange={event => onInstructions(event.target.value)} placeholder="例如：顶部头条、Latest News 下方和右侧列表都是新闻；忽略视频推荐。" /><small>随来源保存，仅在点击辅助生成时发送。修改提示后需重新生成候选，不用重新加载网页。</small></label>
    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={disabled || busy || !page || expired || !keyConfigured} onClick={() => void generate()}>{busy ? '正在处理…' : 'AI 辅助生成候选 · 一次额度'}</button>
      {source.id && source.web?.previousRules && <button type="button" disabled={disabled || busy} onClick={async () => { const saved = await onSave(`admin/sources/${encodeURIComponent(source.id)}/rules/restore`, {}, 'POST'); if (saved) onApplied(saved); }}>恢复上一份有效规则</button>}
    </div>{error && <p className={styles.error} role="alert">{error}</p>}
    {candidate && <><details className={styles.details} open><summary>待应用候选规则</summary><pre>{JSON.stringify(candidate.rules, null, 2)}</pre></details>{!current && <p role="status">解析配置已修改，请重新生成候选。</p>}<div className={styles.actions}><button type="button" disabled={disabled || busy || !current || expired} onClick={() => void inspect()}>预览候选提取</button></div></>}
    {preview && current && !previewCurrent && <p role="status">提取上限、时区或筛选设置已修改，请重新预览文章，不需要再次调用 AI。</p>}
    {preview && current && previewCurrent && <><h3>候选文章列表</h3><SourceTestPanel result={preview} /><div className={styles.actions}><button type="button" className={styles.primary} disabled={disabled || busy || expired || !preview.ok || !preview.samples?.some(sample => sample.title && sample.url)} onClick={() => void apply()}>确认应用并保存来源</button></div></>}
  </section>;
}
