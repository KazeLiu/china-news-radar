'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FlaskConical, Plus, Trash2 } from 'lucide-react';
import { NewsSourceRow } from '../NewsSourceRow';
import { adminApi, type AiTestResult, type ApiSourceSettings, type WebSourceSettings, type SaveSettings, type SourceSettings, type SourceTestResult } from './admin-api';
import { SourceTestPanel } from './SourceTestPanel';
import { AiTestPanel } from './AiTestPanel';
import { ParserAssistantPanel } from './ParserAssistantPanel';
import styles from './admin.module.css';

export const newApi = (): ApiSourceSettings => ({ method: 'GET', body: '', auth: { type: 'none', header: 'Authorization', value: '' }, mapping: { items: 'articles', title: 'title', summary: 'description', url: 'url', publishedAt: 'publishedAt', author: 'author', images: 'urlToImage', body: 'content' } });
export const newWeb = (): WebSourceSettings => ({ rules: { mode: 'metadata', item: '', title: '', summary: '', link: '', date: '', image: '', body: '', author: '', next: '' }, timeoutSeconds: 30, maxItems: 50, maxPages: 3, concurrency: 1 });
const emptySource = (): SourceSettings => ({ id: '', name: '', englishName: '', kind: 'rss', website: '', feedUrls: [''], publisherHosts: [], description: '', notes: '', logo: '', pollSeconds: 120, adapter: 'generic', target: '', api: newApi(), web: newWeb() });
function SourceEditor({ source, token, busy, onSave, onSaved, aiKeyConfigured, onAiUsage }: { source: SourceSettings; token: string; busy: boolean; onSave: SaveSettings; onSaved: (id: string) => void; aiKeyConfigured: boolean; onAiUsage: (usage: AiTestResult['usage']) => void }) {
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(() => ({ ...emptySource(), ...source, kind: ['google-rss', 'rsshub', 'reserved'].includes(source.kind) ? 'rss' : source.kind }));
  const [feedUrls, setFeedUrls] = useState(() => source.feedUrls?.length ? source.feedUrls : [source.feedUrl || '']);
  const [hosts, setHosts] = useState(() => source.publisherHosts.join('\n'));
  const [loading, setLoading] = useState(!!source.id); const [testing, setTesting] = useState(false); const [uploading, setUploading] = useState(false);
  const [privateLoaded, setPrivateLoaded] = useState(!source.id);
  const [result, setResult] = useState<SourceTestResult | null>(null); const [error, setError] = useState(''); const [confirmDelete, setConfirmDelete] = useState(false); const [showSecret, setShowSecret] = useState(false);
  const [aiSample, setAiSample] = useState<{ title: string; summary: string } | null>(null);
  useEffect(() => {
    if (!source.id) return;
    let cancelled = false;
    adminApi<{ notes: string; api?: ApiSourceSettings }>(`admin/sources/${encodeURIComponent(source.id)}/private`, '').then(privateFields => {
      if (!cancelled) { setDraft(old => ({ ...old, notes: privateFields.notes, api: privateFields.api || old.api })); setPrivateLoaded(true); }
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source.id]);
  const pending = busy || testing || uploading || loading || !privateLoaded;
  const change = <K extends keyof SourceSettings>(key: K, value: SourceSettings[K]) => setDraft(old => ({ ...old, [key]: value }));
  const api = draft.api || newApi(); const web = draft.web || newWeb();
  const editApi = (next: ApiSourceSettings) => change('api', next);
  const editFeeds = (update: (previous: string[]) => string[]) => { setFeedUrls(update); setResult(null); setError(''); };
  const body = () => ({ ...draft, feedUrl: feedUrls[0], feedUrls, channel: draft.kind === 'telegram' ? draft.target || draft.channel : undefined, publisherHosts: hosts.split(/[\s,]+/).filter(Boolean) });
  async function test() {
    if (!form.current?.reportValidity()) return;
    setTesting(true); setResult(null); setError('');
    try { setResult(await adminApi<SourceTestResult>('admin/sources/test', token, body(), 'POST')); }
    catch (e) { setError(e instanceof Error ? e.message : '来源预览失败'); }
    finally { setTesting(false); }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1048576) { setError('Logo 仅支持 PNG、JPEG、WebP，最大 1 MiB'); return; }
    setUploading(true); setError('');
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file); });
      const result = await adminApi<{ logo: string }>('admin/sources/logo', '', { data }, 'POST'); change('logo', result.logo);
    } catch (e) { setError(e instanceof Error ? e.message : 'Logo 上传失败'); }
    finally { setUploading(false); }
  }
  function moveFeed(index: number, offset: number) { editFeeds(old => { const next = [...old]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; }); }
  return <div className={styles.stack}><form ref={form} className={styles.card} onChange={() => setResult(null)} onSubmit={async event => {
    event.preventDefault(); const saved = await onSave('admin/sources', body()); if (saved) onSaved(saved.savedSourceId || draft.id);
  }}>
    <h2>{source.id ? `编辑 ${source.name}` : '新增来源'}</h2>
    {loading && <p role="status">正在读取私有配置…</p>}
    <fieldset className={styles.fields} disabled={pending} aria-label="来源配置项">
      <label>来源名称<input required maxLength={100} value={draft.name} onChange={e => change('name', e.target.value)} /></label>
      <label>获取方式<select value={draft.kind} onChange={e => { change('kind', e.target.value); if (e.target.value === 'telegram') change('pollSeconds', 0); else if (!draft.pollSeconds) change('pollSeconds', 120); }}><option value="rss">RSS</option><option value="web">网页爬虫</option><option value="api">API / 平台适配器</option><option value="telegram">Telegram 接收</option></select></label>
      <label>Logo 地址<input value={draft.logo || ''} maxLength={2000} onChange={e => change('logo', e.target.value)} placeholder="https://… 或上传后的本站地址" /></label>
      <label>上传 Logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void upload(e.target.files?.[0])} /><small>最大 1 MiB。{draft.logo && <a href={draft.logo} target="_blank" rel="noopener noreferrer">查看 Logo</a>}</small></label>
      {draft.kind === 'rss' ? <div className={`${styles.wide} ${styles.feedList}`}>
        {feedUrls.map((url, index) => <div key={index} className={styles.feedRow}><label htmlFor={`feed-${index}`}>{`RSS 地址 ${index + 1}`}</label><div className={styles.feedInput}>
          <input id={`feed-${index}`} type="url" required maxLength={2000} value={url} onChange={e => editFeeds(old => old.map((value, i) => i === index ? e.target.value : value))} />
          {index === 0 && <button type="button" disabled={feedUrls.length >= 10} onClick={() => editFeeds(old => [...old, ''])}><Plus size={16} />新增 RSS 地址</button>}
          {index > 0 && <button type="button" aria-label={`上移地址 ${index + 1}`} onClick={() => moveFeed(index, -1)}><ArrowUp size={16} /></button>}
          {index < feedUrls.length - 1 && <button type="button" aria-label={`下移地址 ${index + 1}`} onClick={() => moveFeed(index, 1)}><ArrowDown size={16} /></button>}
          {feedUrls.length > 1 && <button type="button" aria-label={`移除地址 ${index + 1}`} onClick={() => editFeeds(old => old.filter((_, i) => i !== index))}><Trash2 size={16} /></button>}
        </div></div>)}<small>每轮采集会同时请求这些地址，合并去重后处理。</small>
      </div> : <label className={styles.wide}>{draft.kind === 'telegram' ? '公开频道用户名' : draft.kind === 'api' && draft.adapter !== 'generic' ? '搜索词 / 平台采集目标' : '采集目标 URL'}<input required maxLength={2000} value={draft.target || draft.channel || ''} onChange={e => change('target', e.target.value)} placeholder={draft.kind === 'telegram' ? 'channel_name' : 'https://…'} /></label>}
      {draft.kind === 'api' && <><label>适配器<select value={draft.adapter || 'generic'} onChange={e => change('adapter', e.target.value)}><option value="generic">通用 JSON API</option><option value="twitter">X（复用上游 Twitter）</option><option value="bing">Bing 搜索（复用上游）</option><option value="hackernews">Hacker News 搜索（复用上游）</option><option value="bilibili">哔哩哔哩（保留，暂不启用）</option><option value="sogou">搜狗（保留，暂不启用）</option></select></label>
        <label>请求方法<select value={api.method} onChange={e => editApi({ ...api, method: e.target.value as ApiSourceSettings['method'] })}><option>GET</option><option>POST</option></select></label>
        <label>鉴权方式<select value={api.auth.type} onChange={e => editApi({ ...api, auth: { ...api.auth, type: e.target.value as ApiSourceSettings['auth']['type'] } })}><option value="none">无</option><option value="bearer">Bearer Token</option><option value="header">自定义请求头 / X API Key</option></select></label>
        {api.auth.type === 'header' && <label>鉴权请求头名称<input required value={api.auth.header} onChange={e => editApi({ ...api, auth: { ...api.auth, header: e.target.value } })} placeholder="X-API-Key" /></label>}
        {(api.auth.type !== 'none' || draft.adapter === 'twitter') && <label>鉴权值<input type={showSecret ? 'text' : 'password'} autoComplete="new-password" value={api.auth.value} onChange={e => editApi({ ...api, auth: { ...api.auth, value: e.target.value } })} /><button type="button" aria-pressed={showSecret} onClick={() => setShowSecret(value => !value)}>{showSecret ? '隐藏' : '显示'}</button></label>}
        {api.method === 'POST' && <label className={styles.wide}>JSON 请求内容<textarea rows={5} maxLength={10000} value={api.body} onChange={e => editApi({ ...api, body: e.target.value })} /></label>}
        {draft.adapter === 'generic' && <details className={styles.wide}><summary>API 字段映射（属性路径，不能填脚本）</summary><div className={styles.fields}>{Object.entries(api.mapping).map(([key, value]) => <label key={key}>{({ items: '新闻数组路径（空表示根数组）', title: '标题', summary: '摘要', url: '原文链接', publishedAt: '发布时间', author: '作者', images: '图片', body: '正文' } as Record<string, string>)[key]}<input value={value} onChange={e => editApi({ ...api, mapping: { ...api.mapping, [key]: e.target.value } })} /></label>)}</div></details>}
      </>}
      {draft.kind === 'web' && <details className={styles.wide}><summary>网页解析结构与采集限制</summary><p className={styles.hint}>新闻列表通常选择“列表 CSS 选择器”，填写每条新闻、标题和链接的选择器；页面提供新闻列表元数据时，也可使用元数据模式。测试先检查访问，再检查解析结构；设备验证、登录或付费限制不能靠增大超时解决。</p><label>解析方式<select value={web.rules.mode} onChange={e => change('web', { ...web, rules: { ...web.rules, mode: e.target.value as 'metadata' | 'css' } })}><option value="metadata">文章 / 列表元数据（JSON-LD、Open Graph）</option><option value="css">列表 CSS 选择器</option></select></label><div className={styles.fields}>{Object.entries(web.rules).filter(([key]) => key !== 'mode').map(([key, value]) => <label key={key}>{({ item: '新闻条目', title: '标题', summary: '摘要', link: '链接', date: '发布时间', image: '图片', body: '正文', author: '作者', next: '下一页链接' } as Record<string, string>)[key]}<input maxLength={500} value={value} onChange={e => change('web', { ...web, rules: { ...web.rules, [key]: e.target.value } })} /></label>)}</div><div className={styles.fields}>{(['timeoutSeconds', 'maxItems', 'maxPages', 'concurrency'] as const).map(key => <label key={key}>{({ timeoutSeconds: '页面超时（秒）', maxItems: '单次条数上限', maxPages: '翻页上限', concurrency: '浏览器并发上限' })[key]}<input type="number" min={1} value={web[key]} onChange={e => change('web', { ...web, [key]: Number(e.target.value) })} /></label>)}</div></details>}
      <label>采集间隔（秒）<input type="number" required min={draft.kind === 'telegram' ? 0 : 60} max={86400} value={draft.pollSeconds} onChange={e => change('pollSeconds', Number(e.target.value))} /><small>与 AI 请求间隔分开；Telegram 按消息接收。</small></label>
      <div className={styles.wide}><label className={styles.check}><input type="checkbox" checked={draft.forceChina ?? false} onChange={e => change('forceChina', e.target.checked)} />强制视为涉华</label><p className={styles.hint}>覆盖 AI 和关键词的涉华判断；仍按新闻类型、出处、排除规则和人工展示状态筛选。保存后也更新此来源已有新闻，不重新调用 AI，保留模型原始判断。</p></div>
      <label>来源说明<textarea rows={3} maxLength={800} value={draft.description} onChange={e => change('description', e.target.value)} /><small>可公开展示。</small></label>
      <label>私人备注<textarea rows={3} maxLength={2000} value={draft.notes || ''} onChange={e => change('notes', e.target.value)} /><small>只在登录后的来源详情读取。</small></label>
      <label>无时区发布时间按此解释<input value={draft.timeZone || 'UTC'} onChange={e => change('timeZone', e.target.value)} placeholder="UTC / Europe/London / Asia/Shanghai" /><small>仅用于来源没有提供时区的时间。</small></label>
      <details className={styles.wide}><summary>高级出处识别</summary><label>允许的原文发布者域名<textarea rows={3} value={hosts} onChange={e => setHosts(e.target.value)} /><small>每行一个域名，接受子域名。Google 索引和内部 RSSHub 必须明确配置；普通 RSS / 网页默认使用目标域名。</small></label>{result?.samples?.length && <button type="button" onClick={() => { const values = result.samples!.flatMap(sample => { try { return sample.url ? [new URL(sample.url).hostname] : []; } catch { return []; } }); setHosts([...new Set([...hosts.split(/[\s,]+/).filter(Boolean), ...values])].join('\n')); }}>从样例链接补充域名，保存前请核对</button>}</details>
    </fieldset><div className={styles.actions}><button type="submit" className={styles.primary} disabled={pending}>保存来源配置</button><span>新来源默认暂停，预览并保存后再开启。</span></div>
  </form><section className={styles.card} aria-label="来源信息面板"><h2>来源状态与预览</h2>
    {source.state && <NewsSourceRow source={source.state} pending={pending} onChange={(s, update) => { void onSave(`sources/${s.id}`, update); }} />}
    <div className={styles.actions}><button type="button" disabled={pending} onClick={() => void test()}><FlaskConical size={16} />{testing ? '正在连接与解析…' : '测试当前表单'} </button>{source.id && <button type="button" className={styles.danger} disabled={pending} onClick={() => setConfirmDelete(true)}><Trash2 size={16} />删除来源</button>}</div>
    <p className={styles.hint}>预览不要求保存，不入库、不通知、不调用 AI。Telegram 只检查接收配置，不登录账号或读取私聊。</p>
    {confirmDelete && <div className={styles.deleteConfirm} role="alert"><p>删除来源会停止采集，保留新闻、收藏、规则和分析缓存。</p><button type="button" className={styles.danger} disabled={pending} onClick={async () => { if (await onSave(`admin/sources/${encodeURIComponent(source.id)}`, {}, 'DELETE')) onSaved(''); }}>确认删除</button><button type="button" onClick={() => setConfirmDelete(false)}>取消</button></div>}
    {error && <p className={styles.error} role="alert">{error}</p>}{result && <SourceTestPanel result={result} onAnalyze={setAiSample} />}
  </section>{draft.kind === 'web' && <ParserAssistantPanel getSource={body} source={source} disabled={pending} keyConfigured={aiKeyConfigured} onSave={onSave} onApplied={saved => {
    const id = saved.savedSourceId || draft.id; const next = saved.sources.find(s => s.id === id); if (next) setDraft(old => ({ ...old, web: next.web, target: next.target })); onSaved(id);
  }} />}{aiSample && <AiTestPanel key={JSON.stringify(aiSample)} sample={aiSample} token="" busy={pending} keyConfigured={aiKeyConfigured} onUsage={onAiUsage} />}</div>;
}
export function SourceSettingsForm({ sources, token, busy, onSave, aiKeyConfigured, onAiUsage }: { sources: SourceSettings[]; token: string; busy: boolean; onSave: SaveSettings; aiKeyConfigured: boolean; onAiUsage: (usage: AiTestResult['usage']) => void }) {
  const [selected, setSelected] = useState(sources[0]?.id || ''); const source = sources.find(s => s.id === selected) || emptySource();
  return <div className={styles.sourceLayout}><section className={styles.sourcePicker} aria-label="来源目录" tabIndex={0}><button disabled={busy} className={styles.add} onClick={() => setSelected('')}><Plus size={16} />新增来源</button>{sources.map(s => <button key={s.id} disabled={busy} aria-pressed={selected === s.id} className={selected === s.id ? styles.selected : ''} onClick={() => setSelected(s.id)}><span>{s.name}<small>{s.kind}</small></span><small>{s.state?.enabled ? '开启' : '暂停'}</small></button>)}</section><section key={source.id || 'new-source'} className={styles.sourceEditor} aria-label="来源编辑与预览" tabIndex={0}><SourceEditor source={source} token={token} busy={busy} onSave={onSave} onSaved={setSelected} aiKeyConfigured={aiKeyConfigured} onAiUsage={onAiUsage} /></section></div>;
}
