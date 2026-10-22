'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { adminApi, type AiRequestDetail } from './admin-api';
import styles from './admin.module.css';

export const aiRequestKinds: Record<string, string> = { news: '新闻批量分析', digest: '日报生成', profile: '关注档案', parser: '网页解析辅助', test: '后台 AI 测试', json: '结构化生成', raw: '上游模型调用' };
export const aiRequestStatuses: Record<string, string> = { success: '成功', failed: '失败', running: '请求中', 'invalid-response': '输出协议无效' };
export const requestTime = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
function readableContent(content: string) {
  try { return JSON.stringify(JSON.parse(content), null, 2); }
  catch { return content; }
}

export function AiRequestDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [data, setData] = useState<AiRequestDetail | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const next = await adminApi<AiRequestDetail>(`admin/ai/requests/${id}`, '');
        if (cancelled) return;
        setData(next); setError('');
        if (next.status === 'running') timer = setTimeout(() => void load(), 3000);
      } catch (problem) { if (!cancelled) setError(problem instanceof Error ? problem.message : '请求详情读取失败'); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, revision]);

  return <dialog ref={dialog} className={`${styles.newsDialog} ${styles.requestDialog}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className={styles.dialogHeader}><h2 id={titleId}>请求详情{data ? ` · ${aiRequestKinds[data.kind] || data.kind}` : ''}</h2><button type="button" aria-label="关闭请求详情" onClick={onClose}><X size={20} /></button></header>
    <div className={styles.dialogBody}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {loading && !data && <p role="status">正在读取输入与输出…</p>}
      {data && <>
        <dl className={styles.aiFacts}>
          <div><dt>状态与模型</dt><dd>{aiRequestStatuses[data.status] || data.status} · {data.model} · 第 {data.attempt} 次尝试</dd></div>
          <div><dt>请求时间 · 北京时间</dt><dd>{requestTime(data.startedAt)}{data.elapsedMs !== null ? ` · ${(data.elapsedMs / 1000).toFixed(1)} 秒` : ''}</dd></div>
          <div><dt>记录 ID / 任务 ID</dt><dd>{data.id}<br />{data.taskId}</dd></div>
          <div><dt>提供商请求 ID</dt><dd>{data.requestId || '未返回'}</dd></div>
        </dl>
        {data.error && <div className={styles.error} role="alert"><strong>{data.error.message}</strong>{data.error.detail && <p>{data.error.detail}</p>}<small>{data.error.code}{data.error.status ? ` · HTTP ${data.error.status}` : ''}</small></div>}
        <section className={styles.requestPayload}><h3>请求输入</h3>
          {data.input ? <>
            <p>{data.input.input ? 'Responses' : '历史 Chat Completions'} · 输出上限 {data.input.max_output_tokens ?? data.input.max_tokens} tokens{data.input.temperature !== undefined ? ` · 温度 ${data.input.temperature}` : ''} · {data.input.text?.format?.type || data.input.response_format?.type || '文本输出'}</p>
            {(data.input.input ?? data.input.messages ?? []).map((message, index) => <div key={index}><h4>{message.role}</h4><pre tabIndex={0}>{readableContent(message.content)}</pre></div>)}
            <details><summary>完整请求 JSON</summary><pre tabIndex={0}>{JSON.stringify(data.input, null, 2)}</pre></details>
          </> : <p>这条旧记录未保存请求输入，无法补回。</p>}
        </section>
        <section className={styles.requestPayload}><h3>模型输出</h3>
          {data.output ? <>
            {data.output.status && <p>Responses 状态：{data.output.status}{data.output.incomplete_details?.reason ? ` · 未完成原因：${data.output.incomplete_details.reason}` : ''}</p>}
            {data.output.output?.filter(item => item.type === 'message').map((message, index) => <div key={index}><h4>{message.role || 'assistant'} · {message.status || data.output!.status}</h4>{message.content?.map((content, part) => content.type === 'output_text' ? <pre key={part} tabIndex={0}>{readableContent(content.text || '')}</pre> : content.type === 'refusal' ? <p key={part} className={styles.error}>模型拒绝：{content.refusal}</p> : null)}</div>)}
            {!data.output.output?.length && data.output.output_text && <pre tabIndex={0}>{readableContent(data.output.output_text)}</pre>}
            {data.output.choices?.map((choice, index) => <div key={index}><h4>返回 {index + 1} · 结束原因 {choice.finish_reason || '未返回'}</h4><pre tabIndex={0}>{choice.message?.content ? readableContent(choice.message.content) : '未返回文本内容'}</pre></div>)}
            <details><summary>完整响应 JSON（含用量）</summary><pre tabIndex={0}>{JSON.stringify(data.output, null, 2)}</pre></details>
          </> : <p>{data.status === 'running' ? '请求进行中，收到响应后自动更新。' : !data.input ? '这条旧记录未保存模型响应，无法补回。' : '未收到可保存的模型响应，请查看上方错误原因。'}</p>}
        </section>
      </>}
      <div className={styles.actions}><button type="button" disabled={loading} onClick={() => { setLoading(true); setRevision(value => value + 1); }}>{loading ? '读取中…' : '刷新详情'}</button><button type="button" onClick={onClose}>关闭</button></div>
    </div>
  </dialog>;
}
