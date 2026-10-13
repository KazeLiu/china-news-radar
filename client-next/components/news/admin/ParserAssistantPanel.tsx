'use client';
import { useState } from 'react';
import { waitForAiTask, type AiTicket } from '@/services/ai-tasks';
import { adminApi, type AdminSettings, type SaveSettings, type SourceSettings, type SourceTestResult, type WebRules } from './admin-api';
import { SourceTestPanel } from './SourceTestPanel';
import styles from './admin.module.css';
export function ParserAssistantPanel({ getSource, source, disabled, keyConfigured, onSave, onApplied }: { getSource: () => SourceSettings; source: SourceSettings; disabled: boolean; keyConfigured: boolean; onSave: SaveSettings; onApplied: (settings: AdminSettings) => void }) {
  const [candidate, setCandidate] = useState<{ taskId: string; rules: WebRules } | null>(null); const [preview, setPreview] = useState<SourceTestResult | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [snapshot, setSnapshot] = useState('');
  const context = () => JSON.stringify([getSource().target, getSource().web?.rules]);
  async function generate() {
    setBusy(true); setError(''); setCandidate(null); setPreview(null); setSnapshot(context());
    try {
      const ticket = await adminApi<AiTicket>('admin/sources/rules/assist', '', getSource(), 'POST');
      const result = await waitForAiTask<{ rules: WebRules }>(ticket);
      setCandidate({ taskId: ticket.taskId, rules: result.rules });
    } catch (e) { setError(e instanceof Error ? e.message : '候选生成失败'); }
    finally { setBusy(false); }
  }
  async function inspect() {
    if (!candidate) return;
    if (context() !== snapshot) { setError('表单目标或规则已修改，请重新生成候选'); return; }
    setBusy(true); setError(''); setPreview(null);
    const draft = getSource();
    try { setPreview(await adminApi<SourceTestResult>('admin/sources/test', '', { ...draft, web: { ...draft.web, rules: candidate.rules, maxPages: 1 } }, 'POST')); }
    catch (e) { setError(e instanceof Error ? e.message : '候选预览失败'); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!candidate || !preview?.ok) return;
    if (context() !== snapshot) { setError('表单目标或规则已修改，请重新生成候选'); return; }
    const saved = await onSave('admin/sources/rules/apply', { taskId: candidate.taskId, source: getSource() }, 'POST');
    if (saved) { onApplied(saved); setCandidate(null); setPreview(null); }
  }
  return <section className={styles.card}><h2>解析结构</h2><p>普通抓取只检查已保存规则。辅助生成最多读取 12,000 字符页面片段，并产生一次 AI 请求；候选预览后才允许应用，失败保留当前有效规则。</p>
    {source.state?.parse && <details className={styles.details}><summary>最近采集检查与字段匹配数量</summary><pre>{JSON.stringify(source.state.parse, null, 2)}</pre></details>}
    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={disabled || busy || !keyConfigured} onClick={() => void generate()}>{busy ? '正在处理…' : 'AI 辅助生成候选 · 一次额度'}</button>
      {source.id && source.web?.previousRules && <button type="button" disabled={disabled || busy} onClick={async () => { const saved = await onSave(`admin/sources/${encodeURIComponent(source.id)}/rules/restore`, {}, 'POST'); if (saved) onApplied(saved); }}>恢复上一份有效规则</button>}
    </div>{error && <p className={styles.error} role="alert">{error}</p>}
    {candidate && <><details className={styles.details} open><summary>待应用候选规则</summary><pre>{JSON.stringify(candidate.rules, null, 2)}</pre></details><div className={styles.actions}><button type="button" disabled={disabled || busy} onClick={() => void inspect()}>预览候选提取</button><button type="button" className={styles.primary} disabled={disabled || busy || !preview?.ok || !preview.samples?.some(sample => sample.title && sample.url)} onClick={() => void apply()}>确认应用并保存来源</button></div></>}
    {preview && <SourceTestPanel result={preview} />}
  </section>;
}
