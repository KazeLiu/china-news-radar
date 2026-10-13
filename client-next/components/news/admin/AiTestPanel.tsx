'use client';

import { useState } from 'react';
import { adminApi, type AiTestResult } from './admin-api';
import styles from './admin.module.css';

const relationLabels = { related: '涉华', unrelated: '不涉华', uncertain: '信息不足，采用关键词兜底' };
const topicLabels = { policy: '政策', economy: '经济', diplomacy: '外交', technology: '科技', security: '安全', society: '社会' };
const typeLabels = { breaking: '突发快讯', report: '新闻报道', analysis: '分析文章', opinion: '评论', feature: '专题特写', sports: '体育', entertainment: '娱乐', other: '其他' };
const languageLabels = { 'zh-Hans': '简体中文', 'zh-Hant': '繁体中文', en: '英文', other: '其他语言', mixed: '混合语言' };

export function AiTestPanel({ token, busy, keyConfigured, onUsage }: {
  token: string; busy: boolean; keyConfigured: boolean; onUsage: (usage: AiTestResult['usage']) => void;
}) {
  const [title, setTitle] = useState('China announces new trade measures');
  const [summary, setSummary] = useState('Officials announced new rules affecting imports and exports. Details will be published next week.');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [error, setError] = useState('');

  async function test() {
    setTesting(true); setResult(null); setError('');
    try {
      const response = await adminApi<AiTestResult>('admin/ai/test', token, { title, summary }, 'POST');
      setResult(response); onUsage(response.usage);
    } catch (problem) { setError(problem instanceof Error ? problem.message : '测试调用失败'); }
    finally { setTesting(false); }
  }

  return <form className={`${styles.card} ${styles.aiTest}`} onSubmit={event => { event.preventDefault(); void test(); }} aria-busy={testing}>
    <h2>测试 AI 调用</h2>
    <p>使用已保存的接口、模型、密钥和额外指令。上方配置有改动时，请先保存。下面是虚构测试样例，可以替换成 RSS 中的真实标题、摘要。</p>
    <div className={styles.fields}>
      <label>测试标题<textarea required rows={3} maxLength={600} value={title} disabled={testing} onChange={event => setTitle(event.target.value)} /><small>{title.length} / 600 字符</small></label>
      <label>测试摘要（可留空）<textarea rows={3} maxLength={1600} value={summary} disabled={testing} onChange={event => setSummary(event.target.value)} /><small>{summary.length} / 1600 字符；模型只读取你提供的文本。</small></label>
    </div>
    <div className={styles.actions}><button className={styles.primary} type="submit" disabled={busy || testing || !keyConfigured || !title.trim()}>{testing ? '正在调用 AI…' : '测试已保存配置'}</button><span>每次点击调用一次，失败也计入每日额度；测试结果不保存为新闻。</span></div>
    {!keyConfigured && <p className={styles.hint}>请先在上方填写并保存 API Key。</p>}
    {testing && <p role="status">正在等待模型返回，最多等待约 20 秒…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {result && <div className={styles.testResult} role="status">
      <h3>{result.ok ? '调用成功，结果符合项目要求' : '测试未通过'}</h3>
      <p>模型：{result.model} · 耗时：{(result.elapsedMs / 1000).toFixed(1)} 秒 · 今日调用：{result.usage.used} / {result.usage.limit}（UTC）</p>
      {result.error && <p className={styles.error}>{result.error.status ? `HTTP ${result.error.status}：` : ''}{result.error.message}</p>}
      {result.result && <>
        <dl className={styles.aiFacts}>
          <div><dt>涉华判断</dt><dd>{relationLabels[result.result.relation]}</dd></div>
          <div><dt>内容类型</dt><dd>{typeLabels[result.result.type]}</dd></div>
          <div><dt>主题</dt><dd>{result.result.topics.map(topic => topicLabels[topic]).join('、')}</dd></div>
          <div><dt>原文语言</dt><dd>{languageLabels[result.result.language]}</dd></div>
        </dl>
        <p>判断理由：{result.result.reason}</p>
        <p>{result.preview?.visible ? '此样例符合主快讯的内容条件。' : '此样例不符合主快讯的内容条件。'}{result.preview?.decisionBy === 'ai-uncertain-rules' ? '涉华信息不足，展示判断采用关键词兜底。' : ''}实际采集还会检查来源、发布时间和排除规则。</p>
        {result.result.translation ? <article className={styles.sample}><h4>{result.result.translation.title}</h4><p>{result.result.translation.summary || '原文摘要为空，无摘要译文。'}</p></article> : <p>原文是简体中文，直接保留原文，不重复翻译。</p>}
        <details className={styles.details}><summary>查看模型结果 JSON</summary><pre>{JSON.stringify(result.result, null, 2)}</pre></details>
      </>}
      <details className={styles.details}><summary>查看本次发送给模型的标题和摘要</summary><pre>{JSON.stringify(result.input, null, 2)}</pre></details>
    </div>}
  </form>;
}
