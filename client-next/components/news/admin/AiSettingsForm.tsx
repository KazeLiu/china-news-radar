'use client';

import { useState } from 'react';
import type { AiSettings, SaveSettings } from './admin-api';
import styles from './admin.module.css';

export function AiSettingsForm({ initial, savedApiKey, busy, onSave }: { initial: AiSettings; savedApiKey: string; busy: boolean; onSave: SaveSettings }) {
  const [draft, setDraft] = useState(initial);
  const [apiKey, setApiKey] = useState(() => savedApiKey);
  const [dailyLimit, setDailyLimit] = useState(() => String(initial.dailyLimit));
  const [showKey, setShowKey] = useState(false);
  const change = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) => setDraft(old => ({ ...old, [key]: value }));
  return <form className={styles.card} onSubmit={async event => {
    event.preventDefault();
    const limit = Number(dailyLimit);
    if (!dailyLimit.trim() || !Number.isInteger(limit)) return;
    if (await onSave('admin/ai', { enabled: draft.enabled, baseUrl: draft.baseUrl, model: draft.model, dailyLimit: limit, instructions: draft.instructions, apiKey, intervalMs: draft.intervalMs, autoAnalyzeNew: draft.autoAnalyzeNew, newsOutputTokens: draft.newsOutputTokens })) {
      setApiKey(apiKey || savedApiKey); setShowKey(false);
    }
  }}>
    <div className={styles.sectionTitle}><div><h2>统一 AI 分析与翻译</h2><p>多来源新闻按一分钟合批。阅读时复用数据库里的结果。</p></div><label className={styles.check}><input type="checkbox" checked={draft.enabled} onChange={e => change('enabled', e.target.checked)} />启用 AI</label></div>
    <div className={styles.fields}>
      <label>接口地址（Base URL）<input type="url" required value={draft.baseUrl} onChange={e => change('baseUrl', e.target.value)} /><small>填写兼容 OpenAI 的服务根地址，通常以 /v1 结尾。</small></label>
      <label>模型名称<input required value={draft.model} maxLength={200} onChange={e => change('model', e.target.value)} /><small>按提供商填写准确的模型 ID。</small></label>
      <div className={styles.secretField}><label htmlFor="ai-api-key">API Key</label><span className={styles.inputAction}><input id="ai-api-key" type={showKey ? 'text' : 'password'} autoComplete="new-password" value={apiKey} maxLength={1000} onChange={e => setApiKey(e.target.value)} placeholder="填写 API Key" /><button type="button" onClick={() => setShowKey(x => !x)} aria-pressed={showKey}>{showKey ? '隐藏' : '显示'}</button></span><small>保存后的密钥保留在这里，默认隐藏；点击“显示”可查看。填写新密钥并保存即可替换。</small></div>
      <label>每日调用上限（UTC）<input type="number" min={0} max={100000} required value={dailyLimit} onChange={e => setDailyLimit(e.target.value)} /><small>失败尝试也计入额度。用尽或未配置密钥时采用规则兜底。</small></label>
      <label>请求间隔（毫秒）<input type="number" min={0} max={60000} required value={draft.intervalMs} onChange={e => change('intervalMs', Number(e.target.value))} /><small>上一次完成后再等待。0 表示不额外等待，请求仍串行。</small></label>
      <label>新闻输出预算（tokens）<input type="number" min={1024} max={32768} required value={draft.newsOutputTokens} onChange={e => change('newsOutputTokens', Number(e.target.value))} /><small>默认 8192；正文输入最多 6000 字符，每批最多 20 条。</small></label>
      <label className={styles.check}><input type="checkbox" checked={draft.autoAnalyzeNew} onChange={e => change('autoAnalyzeNew', e.target.checked)} />自动分析新增内容</label>
    </div>
    <label className={styles.fullField}>额外筛选指令<textarea rows={5} maxLength={4000} value={draft.instructions} onChange={e => change('instructions', e.target.value)} placeholder="例如：优先关注政策动向和突发事件；区分已证实消息与媒体援引的传闻。" /><small>补充关注范围、分类和措辞要求。固定 JSON 协议与翻译要求仍会附在请求中。</small></label>
    <details className={styles.details}><summary>查看完整基础提示词与 JSON 协议</summary><pre>{initial.protocolPrompt}</pre></details>
    <p className={styles.hint}>RSS 和启用的 Telegram 新闻都使用此配置。模型只接收标题和有限摘要；更换模型或提示词不会自动重翻已完成的内容。</p>
    <details className={styles.ruleGuide}><summary>AI 会做什么，怎样决定展示？</summary><ul><li>判断是否与中国大陆、香港、台湾及相关政策、企业、社会事件有实质关系。</li><li>归入政策、经济、外交、科技、安全、社会主题，可同时属于多个主题。</li><li>区分突发快讯、新闻报道、分析、评论、专题、体育和娱乐。精选资讯展示涉华的突发快讯与新闻报道。</li><li>识别语言，将非简体中文的标题和所提供摘要一次翻译为简体中文；保留原文里的消息来源、传闻和不确定措辞。</li><li>AI 无法确定是否涉华时使用关键词兜底；关闭 AI、缺少密钥、额度用尽或调用失败时也使用规则。排除规则仍优先执行。</li><li>不会打开原文链接、读取全文或核实新闻真假。下方可以用样例测试实际结果。</li></ul></details>
    <div className={styles.actions}><button className={styles.primary} disabled={busy} type="submit">{busy ? '保存中…' : '保存 AI 配置'}</button><span>保存不会启动历史积压或重分析有效缓存。</span></div>
  </form>;
}
