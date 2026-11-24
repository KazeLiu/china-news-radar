'use client';

import { useState } from 'react';
import { adminApi, type AiSettings, type SaveSettings } from './admin-api';
import styles from './admin.module.css';

export function AiSettingsForm({ initial, busy, onSave }: { initial: AiSettings; busy: boolean; onSave: SaveSettings }) {
  const [draft, setDraft] = useState(initial);
  const [apiKey, setApiKey] = useState('');
  const [dailyLimit, setDailyLimit] = useState(() => String(initial.dailyLimit));
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false); const [modelsError, setModelsError] = useState('');
  const change = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) => setDraft(old => ({ ...old, [key]: value }));
  function clearModels() { setModels(null); setModelsError(''); }
  async function refreshModels() {
    setModelsLoading(true); setModelsError(''); setModels(null);
    try { const result = await adminApi<{ models: string[] }>('admin/ai/models', '', { baseUrl: draft.baseUrl, apiKey }, 'POST'); setModels(result.models); }
    catch (error) { setModelsError(error instanceof Error ? error.message : '无法获取模型列表'); }
    finally { setModelsLoading(false); }
  }
  return <form className={`${styles.card} ${styles.compact}`} onSubmit={async event => {
    event.preventDefault();
    if (modelsLoading) return;
    const limit = Number(dailyLimit);
    if (!dailyLimit.trim() || !Number.isInteger(limit)) return;
    if (await onSave('admin/ai', { enabled: draft.enabled, baseUrl: draft.baseUrl, model: draft.model, dailyLimit: limit, instructions: draft.instructions, apiKey, intervalMs: draft.intervalMs, autoAnalyzeNew: draft.autoAnalyzeNew, newsOutputTokens: draft.newsOutputTokens })) {
      setApiKey('');
    }
  }}>
    <div className={styles.sectionTitle}><h2>模型设置</h2><label className={styles.check}><input type="checkbox" checked={draft.enabled} onChange={e => change('enabled', e.target.checked)} />启用 AI</label></div>
    <div className={styles.fields}>
      <label>接口地址（Base URL）<input type="url" required value={draft.baseUrl} disabled={busy || modelsLoading} onChange={e => { change('baseUrl', e.target.value); clearModels(); }} /><small>填写服务根地址（如 /v1），不含 /responses。</small></label>
      <label>API Key · {initial.keyConfigured ? '已配置' : '未配置'}<input id="ai-api-key" type="password" autoComplete="new-password" value={apiKey} maxLength={1000} disabled={busy || modelsLoading} onChange={e => { setApiKey(e.target.value); clearModels(); }} placeholder="沿用同一服务时可留空" /></label>
      <div className={`${styles.secretField} ${styles.wide}`}>
        <label htmlFor="ai-model">模型</label><div className={styles.inputAction}><input id="ai-model" list="ai-model-list" required value={draft.model} maxLength={200} disabled={busy || modelsLoading} onChange={e => change('model', e.target.value)} /><button type="button" disabled={busy || modelsLoading || !draft.baseUrl.trim() || !apiKey.trim() && !initial.keyConfigured} onClick={() => void refreshModels()}>{modelsLoading ? '获取中…' : '获取模型'}</button></div>
        <datalist id="ai-model-list">{models?.map(model => <option key={model} value={model} />)}</datalist>
        {models && <small role="status">{models.length ? `已获取 ${models.length} 个模型。请选择支持 Responses 和 JSON 输出的模型。` : '列表为空，请手动填写模型 ID。'}</small>}
        {modelsError && <p className={styles.error} role="alert">{modelsError}</p>}
      </div>
      <label>每日调用上限（UTC）<input type="number" min={0} max={100000} required value={dailyLimit} onChange={e => setDailyLimit(e.target.value)} /><small>失败也计入额度。</small></label>
      <label>请求间隔（毫秒）<input type="number" min={0} max={60000} required value={draft.intervalMs} onChange={e => change('intervalMs', Number(e.target.value))} /><small>上次请求完成后开始计时。</small></label>
      <label>新闻输出预算（tokens）<input type="number" min={1024} max={32768} required value={draft.newsOutputTokens} onChange={e => change('newsOutputTokens', Number(e.target.value))} /><small>含推理与最终输出，默认 8192。</small></label>
      <div className={styles.fieldToggle}><label className={styles.check}><input type="checkbox" checked={draft.autoAnalyzeNew} onChange={e => change('autoAnalyzeNew', e.target.checked)} />自动分析新增内容</label></div>
    </div>
    <details className={styles.details}><summary>筛选指令与输出协议</summary>
      <label className={styles.fullField}>额外筛选指令<textarea rows={3} maxLength={4000} value={draft.instructions} onChange={e => change('instructions', e.target.value)} placeholder="例如：优先关注政策动向和突发事件。" /></label>
      <details><summary>基础提示词与 JSON 协议</summary><pre tabIndex={0}>{initial.protocolPrompt}</pre></details>
    </details>
    <div className={styles.formActions}><span>保留已完成结果，历史积压另行启动。</span><button className={styles.primary} disabled={busy || modelsLoading} type="submit">{busy ? '保存中…' : '保存 AI 配置'}</button></div>
  </form>;
}
