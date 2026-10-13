import type { SourceTestResult } from './admin-api';
import styles from './admin.module.css';

export function SourceTestPanel({ result }: { result: SourceTestResult }) {
  return <div className={styles.testResult} role="status">
    <h3>{result.ok ? '获取成功' : '获取失败'}</h3>
    <p>{result.ok ? `${result.feedTitle || 'RSS'}：返回 ${result.rawCount} 条，检查前 ${result.checkedCount} 条，其中 ${result.acceptedCount} 条通过来源、时间和排除规则。` : result.error}</p>
    <ol className={styles.attempts}>{result.attempts.map((attempt, index) => <li key={attempt.url}>
      <strong>{index === 0 ? '首选地址' : `备用地址 ${index}`} · {attempt.error || `HTTP ${attempt.status}，获取成功`}</strong><span>{attempt.url}</span>
    </li>)}</ol>
    {result.ok && <p>下面展示前 10 条解析样例。测试不保存新闻、不调用 AI；“关键词兜底”仅用于说明未开启 AI 时的展示结果。</p>}
    {result.samples?.map((sample, index) => <article className={styles.sample} key={`${sample.url}-${index}`}>
      <h4>{sample.title || '无标题'}</h4>
      <span className={!sample.accepted ? styles.sampleExcluded : styles.sampleAccepted}>{!sample.accepted ? sample.reason : sample.fallbackVisible ? '通过基础检查 · 关键词兜底会展示' : '通过基础检查 · 关键词兜底不展示'}</span>
      {sample.summary && <p>{sample.summary}</p>}
      {sample.url && <a href={sample.url} target="_blank" rel="noopener noreferrer">{sample.url}</a>}
      <small>发布时间：{sample.publishedAt ? new Date(sample.publishedAt).toLocaleString('zh-CN') : 'RSS 未提供有效时间'}</small>
    </article>)}
  </div>;
}
