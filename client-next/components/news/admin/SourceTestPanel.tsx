import type { SourceTestResult } from './admin-api';
import styles from './admin.module.css';

export function SourceTestPanel({ result, onAnalyze }: { result: SourceTestResult; onAnalyze?: (sample: { title: string; summary: string }) => void }) {
  return <div className={styles.testResult} role="status">
    <h3>{result.ok ? result.rawCount === 0 ? '连接成功，当前没有内容' : result.acceptedCount === 0 ? '连接成功，样例未通过基础检查' : '连接与解析成功' : '来源预览未完成'}</h3>
    <p>{result.ok ? `${result.feedTitle || '来源'}：返回 ${result.rawCount} 条，检查 ${result.checkedCount} 条，其中 ${result.acceptedCount} 条通过来源、时间和排除规则。` : `${result.status ? `HTTP ${result.status} · ` : ''}${result.code ? `${result.code}：` : ''}${result.error}`}</p>
    {result.structure && <details className={styles.details} open><summary>解析结构与字段映射</summary><pre>{JSON.stringify(result.structure, null, 2)}</pre></details>}
    <ol className={styles.attempts}>{result.attempts.map((attempt, index) => <li key={attempt.url}>
      <strong>{index === 0 ? '首选地址' : `备用地址 ${index}`} · {attempt.error || `HTTP ${attempt.status}，获取成功`}</strong><span>{attempt.url}</span>
    </li>)}</ol>
    {result.ok && <p>下面展示前 10 条解析样例。测试不保存新闻、不调用 AI；“关键词兜底”仅用于说明未开启 AI 时的展示结果。</p>}
    {result.samples?.map((sample, index) => <article className={styles.sample} key={`${sample.url}-${index}`}>
      <h4>{sample.title || '无标题'}</h4>
      <span className={!sample.accepted ? styles.sampleExcluded : styles.sampleAccepted}>{!sample.accepted ? sample.reason : sample.fallbackVisible ? '通过基础检查 · 关键词兜底会展示' : '通过基础检查 · 关键词兜底不展示'}</span>
      {sample.summary && <p>{sample.summary}</p>}
      {onAnalyze && sample.title && <button type="button" onClick={() => onAnalyze(sample)}>准备 AI 分析样例</button>}
      {sample.originalPublisher && <small>已识别出处：{sample.originalPublisher}</small>}
      {sample.originalPublisher === null && <small>出处未识别，不进入公共资讯。</small>}
      {sample.images?.slice(0, 4).map(url => <img key={url} src={url} alt="来源提供的新闻图片预览" loading="lazy" style={{ maxWidth: 200, maxHeight: 140, objectFit: 'contain' }} />)}
      {sample.url && <a href={sample.url} target="_blank" rel="noopener noreferrer">{sample.url}</a>}
      <small>发布时间：{sample.publishedAt ? new Date(sample.publishedAt).toLocaleString('zh-CN') : '来源未提供有效时间'}</small>
    </article>)}
  </div>;
}
