import { ArrowUpRight } from 'lucide-react';
import { clock } from './news-format';
import styles from './news.module.css';

export interface RssAddressStatus { url: string; status: number | null; error: string | null; skipped?: boolean }
export interface Source {
  id: string; name: string; englishName: string; kind: string; description: string; website: string;
  enabled: boolean; configured: boolean; distribution: string; lastCheckedAt: string | null; lastSuccessAt: string | null;
  nextCheckAt: string | null; error: string | null; lastItemCount: number; pollSeconds: number;
  activeFeedUrl: string | null; feedWarning?: string;
  logo?: string;
  parse?: Record<string, unknown>;
}
export function NewsSourceRow({ source: s, pending, onChange }: { source: Source; pending: boolean; onChange: (s: Source, change: { enabled: boolean }) => void }) {
  const state = !s.configured ? '待配置' : !s.enabled ? '已暂停' : s.error || (s.lastSuccessAt ? '正常' : '等待首次采集');
  return <article className={styles.sourceRow}>
    <div><h2>{s.logo && <img src={s.logo} alt="" width={28} height={28} loading="lazy" />} {s.name}<small>{s.englishName}</small></h2><p>{s.distribution}</p></div>
    <span className={s.error ? styles.errorText : styles.sourceState}>{state}</span>
    <button role="switch" aria-checked={s.enabled} aria-label={`${s.enabled ? '暂停' : '启用'}${s.name}`} className={`${styles.switch} ${s.enabled ? styles.switchOn : ''}`} disabled={pending || !s.configured} onClick={() => onChange(s, { enabled: !s.enabled })}><span /></button>
    <details className={styles.sourceDetails}>
      <summary>详情 · 最近成功 {clock(s.lastSuccessAt)}</summary><p>{s.description}</p>
      {s.parse?.mode === 'rss' ? <ol>{(s.parse.attempts as RssAddressStatus[]).map((attempt, index) => <li key={attempt.url}><p>RSS 地址 {index + 1}：{attempt.skipped ? '退避中 · ' : ''}{attempt.error || (attempt.status === 304 ? 'HTTP 304，未变化' : `HTTP ${attempt.status}，成功`)}<br /><span className={styles.feedAddress}>{attempt.url}</span></p></li>)}</ol> : s.activeFeedUrl && <p>最近成功的 RSS 地址之一：<span className={styles.feedAddress}>{s.activeFeedUrl}</span></p>}
      {s.feedWarning && <p className={styles.errorText}>RSS 地址错误：{s.feedWarning}。失败地址按退避重试，其他可请求地址仍会独立采集。</p>}
      <p>最近检查 {clock(s.lastCheckedAt)}{s.nextCheckAt && s.enabled ? ` · 下次检查 ${clock(s.nextCheckAt)}` : ''}</p>
      {s.website && <a href={s.website} target="_blank" rel="noopener noreferrer">访问来源 <ArrowUpRight size={14} /></a>}
    </details>
  </article>;
}
