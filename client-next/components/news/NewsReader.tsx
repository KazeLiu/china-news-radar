'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowDown, ArrowUpRight, Bookmark, Check, CircleAlert, Globe2, Moon, Radio, RefreshCw, Search, Settings2, Sun, X } from 'lucide-react';
import { useTheme } from '@/providers/ThemeProvider';
import styles from './news.module.css';
import { NewsAnalysisDetails } from './NewsAnalysisDetails';
import { topicsFor, decisionName, clock, isGoogleIndex, type AnalysisItem } from './news-format';
import type { Source } from './NewsSourceRow';
import { requestJson } from '@/services/http';

interface Item extends AnalysisItem { id: string; sourceId: string; url: string; originalPublisher: string | null; originalUrl: string | null; eventKey: string; publishedAt: string | null; firstSeenAt: string; updatedAt: string; saved: boolean }
interface Status { total: number; scanning: boolean; aiEnabled: boolean; aiMode: string; aiDailyUsed: number; aiDailyLimit: number; aiPending: number; aiFailed: number; aiLimited: number; collectorEnabled: boolean; latestDiscoveryAt: string | null }
const TOPICS = [['', '全部快讯'], ['policy', '政策'], ['economy', '经济'], ['diplomacy', '外交'], ['technology', '科技'], ['security', '安全'], ['society', '社会']];
const topicName = (topic: string) => TOPICS.find(t => t[0] === topic)?.[1] || '社会';
function ago(value: string) { const mins = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000)); return mins < 1 ? '刚刚' : mins < 60 ? `${mins} 分钟前` : mins < 1440 ? `${Math.floor(mins / 60)} 小时前` : clock(value); }
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(`/api/news/${path}`, init);
}

export function NewsReader() {
  const { theme, toggleTheme } = useTheme();
  const [items, setItems] = useState<Item[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [q, setQ] = useState(''); const [search, setSearch] = useState('');
  const [topic, setTopic] = useState(''); const [source, setSource] = useState('');
  const [saved, setSaved] = useState(false); const [clues, setClues] = useState(false);
  const [english, setEnglish] = useState(false);
  const [loading, setLoading] = useState(true); const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(''); const [metaError, setMetaError] = useState(''); const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string | null>(null); const [expanded, setExpanded] = useState<string | null>(null);
  const generation = useRef(0);
  const params = useMemo(() => new URLSearchParams({ q: search, topic, source, saved: String(saved), clues: String(clues) }).toString(), [search, topic, source, saved, clues]);
  const updateMeta = useCallback(async () => {
    try { const [s, st] = await Promise.all([api<Source[]>('sources'), api<Status>('status')]); setSources(s); setStatus(st); setMetaError(''); }
    catch (e) { setMetaError(e instanceof Error ? e.message : '无法读取采集服务状态'); throw e; }
  }, []);
  const load = useCallback(async (offset = 0, quiet = false) => {
    const current = generation.current;
    if (!quiet) setLoading(true);
    try {
      const data = await api<{ items: Item[]; total: number; nextOffset: number | null }>(`items?${params}&offset=${offset}`);
      if (current !== generation.current) return;
      setItems(old => offset ? [...old, ...data.items.filter(item => !old.some(x => x.id === item.id))] : data.items);
      setTotal(data.total); setNext(data.nextOffset); setError('');
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : '无法连接服务'); }
    finally { if (current === generation.current) setLoading(false); }
  }, [params]);
  useEffect(() => { const timer = setTimeout(() => setSearch(q.trim()), 350); return () => clearTimeout(timer); }, [q]);
  useEffect(() => { const version = ++generation.current; queueMicrotask(() => { if (generation.current === version) void load(); }); return () => { generation.current = version + 1; }; }, [load]);
  useEffect(() => {
    queueMicrotask(() => { void updateMeta().catch(() => {}); });
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void updateMeta().catch(() => {}); }, 20_000);
    return () => clearInterval(timer);
  }, [updateMeta]);
  useEffect(() => { const timer = setInterval(() => { if (document.visibilityState === 'visible' && items.length <= 50 && !pending) void load(0, true); }, 20_000); return () => clearInterval(timer); }, [load, items.length, pending]);
  const groups = useMemo(() => {
    const map = new Map<string, Item[]>(); for (const item of items) { const group = map.get(item.eventKey) || []; group.push(item); map.set(item.eventKey, group); } return [...map.values()];
  }, [items]);
  const healthy = sources.filter(s => s.enabled && s.configured && s.lastSuccessAt && !s.error);
  const failed = sources.filter(s => s.enabled && !!s.error);
  async function scan() {
    setScanning(true); setNotice('');
    try { const result = await api<{ started: boolean; sourcesChecked?: number }>('scan', { method: 'POST' }); await Promise.all([load(0, true), updateMeta()]); setNotice(result.started ? `已检查 ${result.sourcesChecked} 个来源；受限来源会按退避时间重试` : '正在采集中，稍后会自动更新'); }
    catch (e) { setError(e instanceof Error ? e.message : '刷新失败'); }
    finally { setScanning(false); }
  }
  async function toggleSaved(item: Item) {
    setPending(item.id);
    try { const updated = await api<Item>(`items/${item.id}/saved`, { method: 'PATCH', body: JSON.stringify({ saved: !item.saved }) }); setItems(old => old.map(x => x.id === item.id ? updated : x).filter(x => !saved || x.saved)); }
    catch (e) { setError(e instanceof Error ? e.message : '收藏失败'); }
    finally { setPending(null); }
  }
  return <div className={styles.app}>
    <header className={styles.header}>
      <button type="button" className={styles.brand} onClick={() => setSaved(false)} aria-label="回到全部快讯"><span className={styles.logo}><Radio size={22} /></span><span>CHINA <b>RADAR</b><small>海外涉华快讯</small></span></button>
      <div className={styles.headerRight}><Link className={styles.adminLink} href="/admin"><Settings2 size={16} />后台管理</Link><button type="button" className={styles.iconButton} onClick={toggleTheme} aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button></div>
    </header>
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <p className={styles.navLabel}>工作台 / WORKSPACE</p>
        <nav aria-label="主要导航"><button type="button" className={!saved ? styles.navActive : ''} onClick={() => setSaved(false)}><Activity size={18} />快讯流</button><button type="button" className={saved ? styles.navActive : ''} onClick={() => setSaved(true)}><Bookmark size={18} />我的收藏</button><Link className={styles.navLink} href="/admin?tab=sources"><Settings2 size={18} />来源管理{failed.length > 0 && <span className={styles.count}>{failed.length}</span>}</Link></nav>
        <div className={styles.sourceNav}><p className={styles.navLabel}>关注来源 / SOURCES</p>{sources.filter(s => s.kind !== 'telegram').map(s => <button type="button" key={s.id} onClick={() => { setSource(s.id); setSaved(false); }} className={source === s.id ? styles.sourceActive : ''}><span className={`${styles.dot} ${s.error ? styles.dotError : s.enabled && s.lastSuccessAt ? styles.dotOk : ''}`} /><span>{s.name}</span><small>{s.kind === 'reserved' ? '待接入' : s.enabled ? '' : '已暂停'}</small></button>)}</div>
        <div className={styles.sidebarFoot}><Globe2 size={17} /><p>关注中国，连接世界。<small>保留出处，原文优先。</small></p></div>
      </aside>
      <main className={styles.main}>
        <div className={styles.heading}><div><p className={styles.eyebrow}>THE WORLD, ON CHINA</p><h1>{saved ? '值得留存的消息。' : '动向，先一步看见。'}</h1><p>{saved ? '收藏保存在服务器，随时回到报道原文。' : '海外报道中的中国。按首次发现时间排列，持续更新。'}</p></div><button type="button" className={styles.refresh} disabled={scanning || status?.scanning} onClick={scan}><RefreshCw size={16} className={scanning || status?.scanning ? styles.spin : ''} />{scanning || status?.scanning ? '采集中' : '检查更新'}</button></div>
        <div className={styles.statusBar}><span><span className={`${styles.dot} ${healthy.length ? styles.dotOk : ''}`} />{!status ? '采集状态未读取' : status.collectorEnabled === false ? '自动采集已暂停' : `${healthy.length} 个来源正常`}</span><span>{failed.length ? `${failed.length} 个来源暂时失败` : '公开 RSS · 每 2–3 分钟检查'}</span><span className={styles.statusEnd}>最近采集 {clock(status?.latestDiscoveryAt || null)}</span></div>
        {status?.aiEnabled && <div className={styles.analysisNotice} role="status"><span>AI 分析待处理 {status.aiPending} 条 · 今日调用 {status.aiDailyUsed}/{status.aiDailyLimit}</span><span>失败 {status.aiFailed} 条 · 额度暂停 {status.aiLimited} 条，均采用规则兜底</span></div>}
        {status?.aiMode === 'missing-key' && <div className={styles.analysisNotice} role="status">AI 已开启但未配置密钥，当前采用规则兜底。</div>}
        {(error || metaError) && <div className={styles.alert} role="alert"><CircleAlert size={17} /><span>{error || metaError} 已有消息会保留。</span><button type="button" aria-label="关闭错误提示" onClick={() => { setError(''); setMetaError(''); }}><X size={17} /></button></div>}
        {notice && <div className={styles.notice} role="status"><Check size={16} />{notice}<button type="button" onClick={() => setNotice('')} aria-label="关闭通知"><X size={16} /></button></div>}
        <>
          <div className={styles.toolbar}><label className={styles.search}><Search size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索事件、人物或关键词…" aria-label="搜索快讯" />{q && <button type="button" onClick={() => setQ('')} aria-label="清除搜索"><X size={16} /></button>}</label><select value={source} onChange={e => setSource(e.target.value)} aria-label="筛选新闻来源"><option value="">所有来源</option>{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button type="button" onClick={() => setEnglish(x => !x)} className={styles.language} aria-pressed={english}>{english ? '显示中文译文' : '显示原文'}</button></div>
          <div className={styles.topics} aria-label="筛选主题">{TOPICS.map(([id, name]) => <button type="button" key={id} className={topic === id ? styles.topicActive : ''} aria-pressed={topic === id} onClick={() => setTopic(id)}>{name}</button>)}</div>
          <div className={styles.feedMeta}><span>{loading ? '正在读取…' : `${total} 条报道`}<small>按发现时间 · 同标题折叠</small></span><label><input type="checkbox" checked={clues} onChange={e => setClues(e.target.checked)} />包含待确认频道线索</label></div>
          <section className={styles.feed} aria-label="快讯列表" aria-busy={loading}>
            {loading && !items.length ? <div className={styles.empty}><RefreshCw className={styles.spin} size={24} /><h2>正在读取快讯</h2><p>首次启动会先检查公开 RSS 来源。</p></div> : !groups.length ? <div className={styles.empty}>{saved ? <Bookmark size={28} /> : <Radio size={28} />}<h2>{saved ? '收藏从一条消息开始' : search || topic || source ? '没有匹配的快讯' : '等待第一条快讯'}</h2><p>{saved ? '点报道旁的书签即可保存。' : search || topic || source ? '换个关键词，或清除筛选。' : '查看来源管理，确认采集成功后点击检查更新。'}</p>{(search || topic || source) && <button type="button" onClick={() => { setQ(''); setTopic(''); setSource(''); }}>清除筛选</button>}</div> : groups.map(group => { const item = group[0]; const name = sources.find(s => s.id === item.sourceId); const translated = !!item.titleZh && !english; return <article className={styles.article} key={item.id}>
              <div className={styles.time}><span>{ago(item.firstSeenAt)}</span><small>首次发现</small></div>
              <div className={styles.articleBody}><div className={styles.articleMeta}><span className={styles.publisher}>{item.originalPublisher || '出处待确认'}</span>{topicsFor(item).map(t => <span className={styles.topicBadge} key={t}>{topicName(t)}</span>)}<span className={styles.distribution}>{decisionName(item)}</span>{isGoogleIndex(item.url) && <span className={styles.distribution}>Google News 索引</span>}{name?.kind === 'telegram' && <span className={styles.distribution}>{name.name} 转发</span>}</div><h2><a href={item.originalUrl || item.url} target="_blank" rel="noopener noreferrer">{translated ? item.titleZh : item.title}<ArrowUpRight size={16} /></a></h2>{translated && <p className={styles.originalTitle}>{item.title}</p>}{(item.summaryZh || item.summary) && item.summary !== item.title && <p className={styles.excerpt}>{!english && item.summaryZh ? item.summaryZh : item.summary}</p>}<div className={styles.articleBottom}><span title={item.publishedAt ? clock(item.publishedAt) : '来源未提供有效发布时间'}>{item.publishedAt ? `发布 ${clock(item.publishedAt)}` : '发布时间未提供'}</span>{translated && <span>AI 译文 · 请以原文为准</span>}<button type="button" onClick={() => setExpanded(expanded === item.id ? null : item.id)} aria-expanded={expanded === item.id}>{group.length > 1 ? `${group.length} 条同标题记录` : '查看出处'}</button></div><NewsAnalysisDetails item={item} />{expanded === item.id && <div className={styles.provenance}>{group.map(record => <p key={record.id}><a href={record.originalUrl || record.url} target="_blank" rel="noopener noreferrer">{sources.find(s => s.id === record.sourceId)?.name || record.sourceId} <ArrowUpRight size={12} /></a><span>首次发现 {clock(record.firstSeenAt)} · 更新 {clock(record.updatedAt)}</span></p>)}{!item.originalUrl && <small>{isGoogleIndex(item.url) ? '入口为 Google News 跳转链接，索引标注的发布者已核对；未伪造原文 URL。' : '尚未找到可识别的海外原始出处，请自行核实。'}</small>}</div>}</div>
              <button type="button" className={`${styles.saveButton} ${item.saved ? styles.isSaved : ''}`} disabled={pending === item.id} onClick={() => toggleSaved(item)} aria-label={item.saved ? '取消收藏' : '收藏报道'} aria-pressed={item.saved}><Bookmark size={19} fill={item.saved ? 'currentColor' : 'none'} /></button>
            </article>; })}
          </section>
          {next !== null && <button type="button" className={styles.loadMore} disabled={loading} onClick={() => load(next)}>{loading ? '读取中…' : '加载更多'}<ArrowDown size={16} /></button>}
          <footer className={styles.footer}><span>{!status ? 'AI 状态未读取。' : status.aiEnabled ? 'AI 统一分析与翻译，结果全站复用；失败时规则兜底。' : 'AI 未启用，当前采用规则兜底。'}</span><span>时间按设备所在时区显示</span></footer>
        </>
      </main>
    </div>
    <nav className={styles.mobileNav} aria-label="手机导航"><button type="button" className={!saved ? styles.mobileActive : ''} onClick={() => setSaved(false)}><Activity size={19} />快讯</button><button type="button" className={saved ? styles.mobileActive : ''} onClick={() => setSaved(true)}><Bookmark size={19} />收藏</button><Link className={styles.mobileAdmin} href="/admin"><Settings2 size={19} />后台</Link></nav>
  </div>;
}
