'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { Eye, EyeOff, Image as ImageIcon, ImageOff, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { adminApi, type ManagedNews, type SourceSettings } from './admin-api';
import { waitForAiTask, type AiTicket } from '@/services/ai-tasks';
import { HotspotMedia } from '../../hotspot/HotspotMedia';
import { AiTitleBadge } from '../../common/AiTitleBadge';
import { NewsSourceLinks } from '../NewsSourceLinks';
import styles from './admin.module.css';

const emptyForm = () => ({ title: '', summary: '', body: '', url: '', publisher: '', publishedAt: '', images: '' });
type Form = ReturnType<typeof emptyForm>;
interface Page { items: ManagedNews[]; total: number; nextOffset: number | null }
const batchLabels = { hideArticle: '隐藏文章', showArticle: '显示文章', hideImages: '隐藏全部图片', showImages: '显示图片', delete: '删除', restore: '从回收站恢复' };
type BatchAction = keyof typeof batchLabels;
const beijing = (value: string | number) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
const aiLabels: Record<string, string> = { done: '已分析', pending: '待分析', processing: '分析中', failed: '分析失败', limited: '额度不足', disabled: '未分析', excluded: '规则排除', historical: '历史未分析' };
function NewsDialog({ title, busy, onClose, children, compact = false }: { title: string; busy: boolean; onClose: () => void; children: ReactNode; compact?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className={`${styles.newsDialog} ${compact ? styles.confirmDialog : ''}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className={styles.dialogHeader}><h2 id={titleId}>{title}</h2><button type="button" aria-label="关闭窗口" disabled={busy} onClick={onClose}><X size={20} /></button></header>
    <div className={styles.dialogBody}>{children}</div>
  </dialog>;
}
export function NewsManagementPanel({ sources }: { sources: Pick<SourceSettings, 'id' | 'name'>[] }) {
  const [page, setPage] = useState<Page>({ items: [], total: 0, nextOffset: null });
  const [state, setState] = useState('all'); const [query, setQuery] = useState(''); const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ManagedNews | null>(null); const [form, setForm] = useState<Form>(emptyForm);
  const [savedMaterial, setSavedMaterial] = useState(''); const [display, setDisplay] = useState({ title: '', summary: '' });
  const [importUrl, setImportUrl] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ items: ManagedNews[]; action: BatchAction } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectAll = useRef<HTMLInputElement>(null);
  const polling = useRef<AbortController | null>(null);
  const dirty = JSON.stringify(form) !== savedMaterial;
  const editable = !selected || (selected.isManual && !selected.deletedAt);
  const images = selected ? JSON.parse(selected.images) as string[] : [];
  const trashView = page.items.length ? !!page.items[0].deletedAt : state === 'deleted';
  const sourceName = (item: ManagedNews) => item.isManual ? '管理员录入' : sources.find(source => source.id === item.sourceId)?.name || item.sourceId;
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selectedIds.length > 0 && selectedIds.length < page.items.length; }, [selectedIds, page.items.length]);
  async function load(nextOffset = offset): Promise<void> {
    const next = await adminApi<Page>(`admin/items?${new URLSearchParams({ state, q: query, offset: String(nextOffset) })}`, '');
    if (!next.items.length && nextOffset > 0) return load(Math.max(0, Math.min(nextOffset - 30, Math.floor((next.total - 1) / 30) * 30)));
    setPage(next); setOffset(nextOffset); setSelectedIds([]);
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
    setDisplay({ title: item?.displayTitle ?? item?.aiGeneratedTitle ?? item?.titleZh ?? item?.title ?? '', summary: item?.displaySummary ?? item?.summaryZh ?? item?.summary ?? '' });
  }
  function openEditor(item: ManagedNews | null) { choose(item); setError(''); setNotice(''); setEditorOpen(true); }
  function confirmBatch(action: BatchAction, items = page.items.filter(item => selectedIds.includes(item.id))) {
    setError(''); setConfirmation({ action, items });
  }
  async function applyBatch() {
    if (!confirmation) return;
    const result = await adminApi<{ count: number }>('admin/items/batch', '', { ids: confirmation.items.map(item => item.id), action: confirmation.action }, 'POST');
    setNotice(`${batchLabels[confirmation.action]}完成，共 ${result.count} 条；没有调用 AI 或重新发送通知。`);
    setConfirmation(null);
  }
  function closeEditor() {
    const displayDirty = selected?.isManual && (display.title !== (selected.displayTitle ?? selected.aiGeneratedTitle ?? selected.titleZh ?? selected.title) || display.summary !== (selected.displaySummary ?? selected.summaryZh ?? selected.summary));
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
  async function analyze(item = selected) {
    if (!item) return;
    setAnalyzingId(item.id);
    let updated: ManagedNews;
    try {
      const ticket = await adminApi<AiTicket | { cached: true }>(`admin/items/${item.id}/analyze`, '', {}, 'POST');
      if ('taskId' in ticket) { setNotice(`分析已排队 · ${ticket.taskId}。进度与暂停状态见“AI 配置”；单次任务最多三次实际请求。`); polling.current = new AbortController(); await waitForAiTask(ticket, polling.current.signal); }
    } catch (problem) {
      setNotice(''); throw problem;
    } finally {
      setAnalyzingId(null);
      updated = await adminApi<ManagedNews>(`admin/items/${item.id}`, '');
      setPage(current => ({ ...current, items: current.items.map(row => row.id === updated.id ? updated : row) }));
      if (selected?.id === updated.id) choose(updated);
    }
    if (updated.aiStatus !== 'done') { setNotice(''); throw new Error('任务已结束，但此新闻尚未完成分析；请检查素材或展示状态是否已变化，再查看 AI 请求详情。'); }
    setNotice(!updated.isManual && !updated.originalPublisher ? '分析结果已保存；原始出处尚未确认，暂不公开。' : '分析结果已保存。手动草稿不会自动发布。');
  }
  const field = (key: keyof Form, label: string, max: number, multiline = false) => <label className={multiline ? styles.wide : undefined}>{label}{multiline
    ? <textarea value={form[key]} rows={key === 'body' ? 10 : 3} maxLength={max} disabled={busy || !editable} onChange={e => setForm({ ...form, [key]: e.target.value })} />
    : <input value={form[key]} maxLength={max} required={key === 'title'} disabled={busy || !editable} onChange={e => setForm({ ...form, [key]: e.target.value })} />}</label>;
  return <section className={styles.card}>
    <div className={styles.sectionTitle}><div><h2>新闻管理</h2><p>未完成分析的新闻可单独点击“AI 分析”，按已保存配置处理并计入共享额度。点击标题查看原文与结果。</p></div><button type="button" disabled={busy} onClick={() => openEditor(null)}>新增手动新闻</button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    <form className={`${styles.actions} ${styles.newsFilters}`} onSubmit={e => { e.preventDefault(); void action(async () => { await load(0); }, false); }}>
      <label>新闻范围<select value={state} disabled={busy} onChange={e => setState(e.target.value)}><option value="all">全部新闻</option><option value="draft">草稿</option><option value="hidden">已隐藏文章</option><option value="manual">全部手动新闻</option><option value="deleted">回收站</option></select></label>
      <label>标题或摘要<input value={query} maxLength={200} disabled={busy} onChange={e => setQuery(e.target.value)} /></label><button disabled={busy} type="submit">查询</button>
    </form>
    {loading ? <p role="status">正在读取新闻…</p> : <>
      <p>共 {page.total} 条 · 时间按北京时间显示</p>
      {trashView && <p>删除后保留 60 天，期间可以恢复；到期自动永久清理，仅保留 URL 防重记录。恢复不会解除原有隐藏、筛选和草稿状态。</p>}
      <div className={styles.batchToolbar} aria-label="新闻批量操作">
        <label className={styles.check}><input ref={selectAll} type="checkbox" checked={page.items.length > 0 && selectedIds.length === page.items.length} disabled={busy || !page.items.length} onChange={e => setSelectedIds(e.target.checked ? page.items.map(item => item.id) : [])} />全选当前页</label>
        <span role="status">已选 {selectedIds.length} 条</span>
        {trashView ? <button type="button" disabled={busy || !selectedIds.length} onClick={() => confirmBatch('restore')}><RotateCcw size={16} />恢复所选</button> : <>
          <button type="button" disabled={busy || !selectedIds.length} onClick={() => confirmBatch('hideArticle')}><EyeOff size={16} />隐藏文章</button>
          <button type="button" disabled={busy || !selectedIds.length} onClick={() => confirmBatch('hideImages')}><ImageOff size={16} />隐藏图片</button>
          <button type="button" disabled={busy || !selectedIds.length} onClick={() => confirmBatch('showArticle')}>显示文章</button>
          <button type="button" disabled={busy || !selectedIds.length} onClick={() => confirmBatch('showImages')}>显示图片</button>
          <button type="button" className={styles.danger} disabled={busy || !selectedIds.length} onClick={() => confirmBatch('delete')}><Trash2 size={16} />删除所选</button>
        </>}
      </div>
      <div className={styles.newsList}>{page.items.map(item => {
        const thumbnail = (JSON.parse(item.images) as string[])[0];
        return <article key={item.id} className={styles.newsRow}>
          <label className={`${styles.check} ${styles.newsSelect}`}><input type="checkbox" aria-label={`选择新闻：${item.displayTitle ?? item.aiGeneratedTitle ?? item.titleZh ?? item.title}`} checked={selectedIds.includes(item.id)} disabled={busy} onChange={e => setSelectedIds(ids => e.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} /></label>
          <div className={styles.newsRowContent}><button type="button" className={styles.newsOpen} disabled={busy} aria-haspopup="dialog" onClick={() => openEditor(item)}>
            <span className={styles.newsThumbnail} aria-hidden="true">{thumbnail && <Image key={thumbnail} src={thumbnail} alt="" unoptimized width={120} height={80} loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}</span>
            <span className={styles.newsCopy}><strong>{item.displayTitle ?? item.aiGeneratedTitle ?? item.titleZh ?? item.title}<AiTitleBadge generated={item.titleGenerated} /></strong><span>{item.deletedAt ? '回收站' : item.publicationStatus === 'draft' ? '草稿' : !item.isManual && !item.originalPublisher ? '出处待确认' : '已发布'} · {item.isManual ? '手动录入' : '自动采集'} · AI：{aiLabels[item.aiStatus] || '未分析'}</span>
              <small>来源：{sourceName(item)}</small>
              <small>{beijing(item.firstSeenAt)}</small>{item.deletedAt && <small>60 天保留至：{beijing(new Date(item.deletedAt).getTime() + 60 * 86400000)}</small>}</span>
          </button><div className={styles.newsSourceLinks}><NewsSourceLinks links={JSON.parse(item.sourceLinks)} /></div></div>
          <div className={styles.visibilityActions}>
            {item.deletedAt ? <button type="button" disabled={busy} onClick={() => confirmBatch('restore', [item])}><RotateCcw size={18} />恢复</button> : <>
              {!['done', 'excluded'].includes(item.aiStatus) && <button type="button" disabled={busy || item.hiddenArticle} aria-busy={analyzingId === item.id} title={item.hiddenArticle ? '请先恢复文章显示' : '复用有效缓存，或送入共享 AI 队列分析'} onClick={() => void action(() => analyze(item), false)}><Sparkles size={18} />{analyzingId === item.id ? '分析中…' : 'AI 分析'}</button>}
              <button type="button" className={`${styles.visibilityToggle} ${item.hiddenArticle ? styles.visibilityHidden : ''}`} disabled={busy} aria-pressed={item.hiddenArticle} aria-haspopup="dialog" aria-label={item.hiddenArticle ? '恢复文章' : '隐藏文章'} title={item.hiddenArticle ? '文章已隐藏，点击恢复' : '文章显示中，点击隐藏'} onClick={() => confirmBatch(item.hiddenArticle ? 'showArticle' : 'hideArticle', [item])}>{item.hiddenArticle ? <EyeOff size={18} /> : <Eye size={18} />}文章</button>
              <button type="button" className={`${styles.visibilityToggle} ${item.hiddenImages ? styles.visibilityHidden : ''}`} disabled={busy} aria-pressed={item.hiddenImages} aria-haspopup="dialog" aria-label={item.hiddenImages ? '恢复全部图片' : '隐藏全部图片'} title={item.hiddenImages ? '图片已隐藏，点击恢复' : '图片未隐藏，点击隐藏全部图片'} onClick={() => confirmBatch(item.hiddenImages ? 'showImages' : 'hideImages', [item])}>{item.hiddenImages ? <ImageOff size={18} /> : <ImageIcon size={18} />}图片</button>
              <button type="button" className={styles.danger} disabled={busy} aria-label="删除新闻" aria-haspopup="dialog" onClick={() => confirmBatch('delete', [item])}><Trash2 size={18} />删除</button>
            </>}
          </div>
        </article>;
      })}</div>{!page.items.length && <p>此范围暂无新闻。</p>}
      <div className={styles.actions}><button type="button" disabled={busy || offset === 0} onClick={() => void action(async () => { await load(Math.max(0, offset - 30)); }, false)}>上一页</button><button type="button" disabled={busy || page.nextOffset === null} onClick={() => void action(async () => { await load(page.nextOffset!); }, false)}>下一页</button></div>
    </>}
    {editorOpen && <NewsDialog title={selected ? selected.deletedAt ? '已删除新闻（只读）' : selected.isManual ? '编辑手动新闻' : '采集原文与展示预览' : '新增手动新闻'} busy={busy} onClose={closeEditor}>
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    {selected && <><p>采集来源：{sourceName(selected)}</p><NewsSourceLinks links={JSON.parse(selected.sourceLinks)} /></>}
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
      <p>{selected.deletedAt ? '回收站，仅管理员可见' : selected.publicationStatus === 'draft' ? '草稿，仅管理员可见' : selected.hiddenArticle ? '文章已隐藏' : !selected.isManual && !selected.originalPublisher ? '原始出处未确认，暂不公开' : selected.visible ? '符合展示规则' : '未通过内容筛选'} · AI：{selected.aiStatus}</p>{selected.aiReason && <p>{selected.aiReason}</p>}
      <div className={styles.previewArticle}><h4>{display.title}<AiTitleBadge generated={selected.titleGenerated} /></h4>{!selected.sourceTitlePresent && <small>来源没有原始标题；采集标题为正文截取的临时兜底，完整正文仍单独保存。</small>}<p>{display.summary}</p><small>出处：{selected.originalPublisher || (selected.isManual ? '管理员录入' : '未识别发布者')} · {selected.hiddenImages ? '全部图片已隐藏' : `图片 ${images.length} 张`}</small>
        {!selected.hiddenImages && <HotspotMedia media={images.map(url => ({ type: 'photo', url }))} />}
        <details><summary>查看保存的完整正文</summary><p>{selected.body || '未取得正文'}</p></details></div>
      {selected.isManual && !selected.deletedAt && <><div className={styles.fields}><label>展示标题<input maxLength={1200} value={display.title} disabled={busy || dirty} onChange={e => setDisplay({ ...display, title: e.target.value })} /></label><label>展示摘要<textarea maxLength={8000} value={display.summary} disabled={busy || dirty} rows={4} onChange={e => setDisplay({ ...display, summary: e.target.value })} /></label></div><div className={styles.actions}>
        <button type="button" disabled={busy || dirty} onClick={() => void action(() => updateDisplay({ displayTitle: display.title, displaySummary: display.summary }))}>保存展示文案 · 不调用 AI</button>
        <button type="button" disabled={busy || dirty} onClick={() => void action(() => updateDisplay({ displayTitle: null, displaySummary: null }))}>使用原文或分析译文</button>
      </div><p>分析仅发送标题与有限摘要，无有效缓存时产生模型请求并计入每日额度。首次请求最多再重试两次。</p></>}
      {!selected.deletedAt && <div className={styles.actions}>
        {(selected.isManual || !['done', 'excluded'].includes(selected.aiStatus)) && <button type="button" disabled={busy || dirty || selected.hiddenArticle} onClick={() => void action(() => analyze(), false)}>{analyzingId === selected.id ? '分析中…' : 'AI 分析并预览'}</button>}
        {selected.isManual && <button type="button" className={styles.primary} disabled={busy || dirty || selected.publicationStatus === 'published' || selected.hiddenArticle || selected.aiStatus !== 'done' || !selected.visible} onClick={() => void action(async () => { choose(await adminApi<ManagedNews>(`admin/items/${selected.id}/publish`, '', {}, 'POST')); setNotice('新闻已发布。重复发布或恢复不会重放通知。'); })}>发布新闻</button>}
      </div>}
    </section>}
    </NewsDialog>}
    {confirmation && <NewsDialog title={`${batchLabels[confirmation.action]} ${confirmation.items.length} 条新闻？`} busy={busy} onClose={() => setConfirmation(null)} compact>
      {confirmation.items.slice(0, 3).map(item => <p key={item.id} className={styles.confirmTitle}>{item.displayTitle ?? item.aiGeneratedTitle ?? item.titleZh ?? item.title}</p>)}{confirmation.items.length > 3 && <p>以及另外 {confirmation.items.length - 3} 条已选新闻。</p>}
      <p>{confirmation.action === 'delete' ? '将从所有公共入口移除，进入回收站。60 天内可恢复，满 60 天自动永久删除原文、译文及不再共用的分析缓存，仅留 URL 防重记录，避免重新采入。' : confirmation.action === 'hideArticle' ? '将从前台、日报条目、Agent、RSS 等公共入口隐藏文章，保留数据，可随时恢复。' : confirmation.action === 'hideImages' ? '将隐藏这些新闻在公共入口的全部图片，保留文字和原图信息。' : '恢复后仍遵守内容筛选、发布状态和其他人工隐藏设置，不重新调用 AI，也不重复发送通知。'}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button type="button" className={['delete', 'hideArticle', 'hideImages'].includes(confirmation.action) ? styles.danger : styles.primary} disabled={busy} onClick={() => void action(applyBatch)}>{busy ? '正在保存…' : `确认${batchLabels[confirmation.action]}`}</button></div>
    </NewsDialog>}
  </section>;
}
