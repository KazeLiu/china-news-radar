'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { Eye, EyeOff, Image as ImageIcon, ImageOff, X } from 'lucide-react';
import { adminApi, type ManagedNews } from './admin-api';
import { waitForAiTask, type AiTicket } from '@/services/ai-tasks';
import { HotspotMedia } from '../../hotspot/HotspotMedia';
import styles from './admin.module.css';

const emptyForm = () => ({ title: '', summary: '', body: '', url: '', publisher: '', publishedAt: '', images: '' });
type Form = ReturnType<typeof emptyForm>;
interface Page { items: ManagedNews[]; total: number; nextOffset: number | null }
function NewsDialog({ title, busy, onClose, children, compact = false }: { title: string; busy: boolean; onClose: () => void; children: ReactNode; compact?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className={`${styles.newsDialog} ${compact ? styles.confirmDialog : ''}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className={styles.dialogHeader}><h2 id={titleId}>{title}</h2><button type="button" aria-label="关闭窗口" disabled={busy} onClick={onClose}><X size={20} /></button></header>
    <div className={styles.dialogBody}>{children}</div>
  </dialog>;
}
export function NewsManagementPanel() {
  const [page, setPage] = useState<Page>({ items: [], total: 0, nextOffset: null });
  const [state, setState] = useState('all'); const [query, setQuery] = useState(''); const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ManagedNews | null>(null); const [form, setForm] = useState<Form>(emptyForm);
  const [savedMaterial, setSavedMaterial] = useState(''); const [display, setDisplay] = useState({ title: '', summary: '' });
  const [importUrl, setImportUrl] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{ item: ManagedNews; field: 'hiddenArticle' | 'hiddenImages' } | null>(null);
  const polling = useRef<AbortController | null>(null);
  const dirty = JSON.stringify(form) !== savedMaterial;
  const editable = !selected || selected.isManual;
  const images = selected ? JSON.parse(selected.images) as string[] : [];
  async function load(nextOffset = offset) {
    const next = await adminApi<Page>(`admin/items?${new URLSearchParams({ state, q: query, offset: String(nextOffset) })}`, '');
    setPage(next); setOffset(nextOffset);
  }
  useEffect(() => {
    let cancelled = false;
    adminApi<Page>('admin/items?state=all', '').then(next => { if (!cancelled) setPage(next); }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; polling.current?.abort(); };
  }, []);
  function choose(item: ManagedNews | null) {
    const next = item ? { title: item.title, summary: item.summary, body: item.body, url: item.originalUrl || (item.isManual ? '' : item.url),
      publisher: item.originalPublisher || '', publishedAt: item.publishedAt || '', images: (JSON.parse(item.images) as string[]).join('\n') } : emptyForm();
    setSelected(item); setForm(next); setSavedMaterial(JSON.stringify(next));
    setDisplay({ title: item?.displayTitle ?? item?.titleZh ?? item?.title ?? '', summary: item?.displaySummary ?? item?.summaryZh ?? item?.summary ?? '' });
  }
  function openEditor(item: ManagedNews | null) { choose(item); setError(''); setNotice(''); setEditorOpen(true); }
  function closeEditor() {
    const displayDirty = selected?.isManual && (display.title !== (selected.displayTitle ?? selected.titleZh ?? selected.title) || display.summary !== (selected.displaySummary ?? selected.summaryZh ?? selected.summary));
    if ((dirty || displayDirty) && !window.confirm('有未保存的修改，仍要关闭吗？')) return;
    setEditorOpen(false);
  }
  async function action(run: () => Promise<void>, refresh = true) {
    setBusy(true); setError(''); setNotice('');
    try { await run(); if (refresh) await load(); }
    catch (e) { setError(e instanceof Error ? e.message : '新闻操作失败'); }
    finally { setBusy(false); }
  }
  async function save() {
    const result = await adminApi<{ item: ManagedNews; reused: boolean }>(selected ? `admin/items/${selected.id}` : 'admin/items', '', {
      ...form, images: form.images.split('\n').map(url => url.trim()).filter(Boolean), updatedAt: selected?.updatedAt,
    }, selected ? 'PUT' : 'POST');
    choose(result.item); setNotice(result.reused ? '此 URL 已有新闻，已打开原记录，没有重复录入或改变发布状态。' : '草稿已保存。分析与发布都需要单独点击。');
  }
  async function updateDisplay(body: unknown, item = selected) {
    if (!item) return;
    const updated = await adminApi<ManagedNews>(`admin/items/${item.id}/display`, '', body, 'PATCH');
    if (selected?.id === updated.id) choose(updated);
    setNotice('展示设置已保存，没有调用 AI；原文和图片信息仍保留。');
  }
  async function analyze() {
    if (!selected) return;
    const ticket = await adminApi<AiTicket | { cached: true }>(`admin/items/${selected.id}/analyze`, '', {}, 'POST');
    if ('taskId' in ticket) { setNotice(`分析已排队 · ${ticket.taskId}`); polling.current = new AbortController(); await waitForAiTask(ticket, polling.current.signal); }
    choose(await adminApi<ManagedNews>(`admin/items/${selected.id}`, ''));
    setNotice('分析结果已保存，请确认预览。草稿不会自动发布。');
  }
  const field = (key: keyof Form, label: string, max: number, multiline = false) => <label className={multiline ? styles.wide : undefined}>{label}{multiline
    ? <textarea value={form[key]} rows={key === 'body' ? 10 : 3} maxLength={max} disabled={busy || !editable} onChange={e => setForm({ ...form, [key]: e.target.value })} />
    : <input value={form[key]} maxLength={max} required={key === 'title'} disabled={busy || !editable} onChange={e => setForm({ ...form, [key]: e.target.value })} />}</label>;
  return <section className={styles.card}>
    <div className={styles.sectionTitle}><div><h2>新闻管理</h2><p>点击新闻查看原文、分析结果和展示设置。右侧按钮控制文章与全部图片是否公开显示。</p></div><button type="button" disabled={busy} onClick={() => openEditor(null)}>新增手动新闻</button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    <form className={`${styles.actions} ${styles.newsFilters}`} onSubmit={e => { e.preventDefault(); void action(async () => { await load(0); }, false); }}>
      <label>新闻范围<select value={state} disabled={busy} onChange={e => setState(e.target.value)}><option value="draft">草稿</option><option value="hidden">已隐藏文章</option><option value="manual">全部手动新闻</option><option value="all">全部新闻</option></select></label>
      <label>标题或摘要<input value={query} maxLength={200} disabled={busy} onChange={e => setQuery(e.target.value)} /></label><button disabled={busy} type="submit">查询</button>
    </form>
    {loading ? <p role="status">正在读取新闻…</p> : <>
      <p>共 {page.total} 条 · 时间按北京时间显示</p>
      <div className={styles.newsList}>{page.items.map(item => {
        const thumbnail = (JSON.parse(item.images) as string[])[0];
        return <article key={item.id} className={styles.newsRow}>
          <button type="button" className={styles.newsOpen} disabled={busy} aria-haspopup="dialog" onClick={() => openEditor(item)}>
            <span className={styles.newsThumbnail} aria-hidden="true">{thumbnail && <Image key={thumbnail} src={thumbnail} alt="" unoptimized width={120} height={80} loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}</span>
            <span className={styles.newsCopy}><strong>{item.displayTitle ?? item.titleZh ?? item.title}</strong><span>{item.publicationStatus === 'draft' ? '草稿' : '已发布'} · {item.isManual ? '手动录入' : '自动采集'}</span>
              <small>{new Date(item.firstSeenAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small></span>
          </button>
          <div className={styles.visibilityActions}>
            <button type="button" className={`${styles.visibilityToggle} ${item.hiddenArticle ? styles.visibilityHidden : ''}`} disabled={busy} aria-pressed={item.hiddenArticle} aria-haspopup="dialog" aria-label={item.hiddenArticle ? '恢复文章' : '隐藏文章'} title={item.hiddenArticle ? '文章已隐藏，点击恢复' : '文章显示中，点击隐藏'} onClick={() => { setError(''); setConfirmation({ item, field: 'hiddenArticle' }); }}>{item.hiddenArticle ? <EyeOff size={18} /> : <Eye size={18} />}文章</button>
            <button type="button" className={`${styles.visibilityToggle} ${item.hiddenImages ? styles.visibilityHidden : ''}`} disabled={busy} aria-pressed={item.hiddenImages} aria-haspopup="dialog" aria-label={item.hiddenImages ? '恢复全部图片' : '隐藏全部图片'} title={item.hiddenImages ? '图片已隐藏，点击恢复' : '图片未隐藏，点击隐藏全部图片'} onClick={() => { setError(''); setConfirmation({ item, field: 'hiddenImages' }); }}>{item.hiddenImages ? <ImageOff size={18} /> : <ImageIcon size={18} />}图片</button>
          </div>
        </article>;
      })}</div>{!page.items.length && <p>此范围暂无新闻。</p>}
      <div className={styles.actions}><button type="button" disabled={busy || offset === 0} onClick={() => void action(async () => { await load(Math.max(0, offset - 30)); }, false)}>上一页</button><button type="button" disabled={busy || page.nextOffset === null} onClick={() => void action(async () => { await load(page.nextOffset!); }, false)}>下一页</button></div>
    </>}
    {editorOpen && <NewsDialog title={selected ? selected.isManual ? '编辑手动新闻' : '采集原文与展示预览' : '新增手动新闻'} busy={busy} onClose={closeEditor}>
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    {!selected && <form className={styles.fields} onSubmit={e => { e.preventDefault(); void action(async () => {
      const result = await adminApi<{ item: ManagedNews; reused: boolean }>('admin/items/import', '', { url: importUrl }, 'POST');
      choose(result.item); setNotice(result.reused ? '已打开同 URL 的原记录，未重复录入。' : '网页内容已保存为草稿，没有调用 AI。');
    }); }}><label>从公开文章 URL 录入<input type="url" required maxLength={2000} value={importUrl} disabled={busy} onChange={e => setImportUrl(e.target.value)} /></label><div className={styles.actions}><button disabled={busy} type="submit">提取并保存草稿</button></div></form>}
    <form onSubmit={e => { e.preventDefault(); void action(save); }}>
      <h3>{selected ? editable ? '分析素材与原文' : '采集原文（只读）' : '粘贴内容录入'}</h3>
      <div className={styles.fields}>{field('title', '原始标题', 600)}{field('url', '原文 URL（可空）', 2000)}{field('publisher', '发布者（可空）', 120)}{field('publishedAt', '发布时间（ISO 8601，含时区，可空）', 50)}{field('summary', '分析摘要 · 最多 1,600 字符', 1600, true)}{field('body', '完整正文 · 最多 200,000 字符，不完整发送给模型', 200000, true)}{field('images', '图片 HTTP(S) URL · 每行一张，最多 20 张', 40020, true)}</div>
      {editable && <button type="submit" disabled={busy} className={styles.primary}>保存草稿素材</button>}
      {selected && dirty && <p role="status">素材有未保存修改，请先保存再分析或发布。已发布新闻修改素材后会回到草稿。</p>}
    </form>
    {selected && <section className={styles.testResult}><h3>展示预览与操作</h3>
      <p>{selected.publicationStatus === 'draft' ? '草稿，仅管理员可见' : selected.hiddenArticle ? '文章已隐藏' : selected.visible ? '符合展示规则' : '未通过内容筛选'} · AI：{selected.aiStatus}</p>{selected.aiReason && <p>{selected.aiReason}</p>}
      <div className={styles.previewArticle}><h4>{display.title}</h4><p>{display.summary}</p><small>出处：{selected.originalPublisher || '管理员录入'} · {selected.hiddenImages ? '全部图片已隐藏' : `图片 ${images.length} 张`}</small>
        {!selected.hiddenImages && <HotspotMedia media={images.map(url => ({ type: 'photo', url }))} />}
        <details><summary>查看保存的完整正文</summary><p>{selected.body || '未取得正文'}</p></details></div>
      {selected.isManual && <><div className={styles.fields}><label>展示标题<input maxLength={1200} value={display.title} disabled={busy || dirty} onChange={e => setDisplay({ ...display, title: e.target.value })} /></label><label>展示摘要<textarea maxLength={8000} value={display.summary} disabled={busy || dirty} rows={4} onChange={e => setDisplay({ ...display, summary: e.target.value })} /></label></div><div className={styles.actions}>
        <button type="button" disabled={busy || dirty} onClick={() => void action(() => updateDisplay({ displayTitle: display.title, displaySummary: display.summary }))}>保存展示文案 · 不调用 AI</button>
        <button type="button" disabled={busy || dirty} onClick={() => void action(() => updateDisplay({ displayTitle: null, displaySummary: null }))}>使用原文或分析译文</button>
      </div><p>分析仅发送标题与有限摘要，无有效缓存时产生模型请求并计入每日额度。首次请求最多再重试两次。</p></>}
      {selected.isManual && <div className={styles.actions}>
        <button type="button" disabled={busy || dirty || selected.hiddenArticle} onClick={() => void action(analyze)}>主动分析并预览</button><button type="button" className={styles.primary} disabled={busy || dirty || selected.publicationStatus === 'published' || selected.hiddenArticle || selected.aiStatus !== 'done' || !selected.visible} onClick={() => void action(async () => { choose(await adminApi<ManagedNews>(`admin/items/${selected.id}/publish`, '', {}, 'POST')); setNotice('新闻已发布。重复发布或恢复不会重放通知。'); })}>发布新闻</button>
      </div>}
    </section>}
    </NewsDialog>}
    {confirmation && <NewsDialog title={`${confirmation.item[confirmation.field] ? '恢复' : '隐藏'}${confirmation.field === 'hiddenArticle' ? '文章' : '全部图片'}？`} busy={busy} onClose={() => setConfirmation(null)} compact>
      <p className={styles.confirmTitle}>{confirmation.item.displayTitle ?? confirmation.item.titleZh ?? confirmation.item.title}</p>
      <p>{confirmation.item[confirmation.field] ? '恢复后仍遵守内容筛选和发布状态，不重新调用 AI，也不重复发送通知。' : confirmation.field === 'hiddenArticle' ? '隐藏后，这篇新闻将不在前台、日报条目、Agent 和 RSS 等公共入口展示。原文和译文保留，可以随时恢复。' : '隐藏后，公共入口不展示这篇新闻的任何图片，文字保留。原图信息仍保存，可以随时恢复。'}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button type="button" className={confirmation.item[confirmation.field] ? styles.primary : styles.danger} disabled={busy} onClick={() => void action(async () => { await updateDisplay({ [confirmation.field]: !confirmation.item[confirmation.field] }, confirmation.item); setConfirmation(null); })}>{busy ? '正在保存…' : confirmation.item[confirmation.field] ? '确认恢复' : '确认隐藏'}</button></div>
    </NewsDialog>}
  </section>;
}
