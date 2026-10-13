import { ArrowUpRight } from 'lucide-react';
import { clock } from './news-format';
import styles from './news.module.css';

export interface Source {
  id: string; name: string; englishName: string; kind: string; description: string; website: string;
  enabled: boolean; configured: boolean; distribution: string; lastCheckedAt: string | null; lastSuccessAt: string | null;
  nextCheckAt: string | null; error: string | null; lastItemCount: number; pollSeconds: number;
  activeFeedUrl: string | null; feedWarning?: string;
}
export function NewsSourceRow({ source: s, pending, onChange }: { source: Source; pending: boolean; onChange: (s: Source, change: { enabled: boolean }) => void }) {
  const state = !s.configured ? '待配置' : !s.enabled ? '已暂停' : s.error || (s.lastSuccessAt ? '正常' : '等待首次采集');
  return <article className={styles.sourceRow}>
    <div><h2>{s.name}<small>{s.englishName}</small></h2><p>{s.distribution}</p></div>
    <span className={s.error ? styles.errorText : styles.sourceState}>{state}</span>
    <button role="switch" aria-checked={s.enabled} aria-label={`${s.enabled ? '暂停' : '启用'}${s.name}`} className={`${styles.switch} ${s.enabled ? styles.switchOn : ''}`} disabled={pending || !s.configured} onClick={() => onChange(s, { enabled: !s.enabled })}><span /></button>
    <details className={styles.sourceDetails}>
      <summary>详情 · 最近成功 {clock(s.lastSuccessAt)}</summary><p>{s.description}</p>
      {s.activeFeedUrl && <p>最近成功的 RSS 地址：<span className={styles.feedAddress}>{s.activeFeedUrl}</span></p>}
      {s.feedWarning && <p className={styles.errorText}>部分 RSS 地址未成功：{s.feedWarning}。系统会按顺序尝试其他地址。</p>}
      <p>最近检查 {clock(s.lastCheckedAt)}{s.nextCheckAt && s.enabled ? ` · 下次检查 ${clock(s.nextCheckAt)}` : ''}</p>
      <a href={s.website} target="_blank" rel="noopener noreferrer">访问来源 <ArrowUpRight size={14} /></a>
    </details>
  </article>;
}
