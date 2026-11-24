'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Download, FlaskConical, Plus, Trash2 } from 'lucide-react';
import { NewsSourceRow } from '../NewsSourceRow';
import { adminApi, type AiTestResult, type ApiSourceSettings, type WebSourceSettings, type WebPagePreview, type SaveSettings, type SourceSettings, type SourceTestResult, type NetworkSettings } from './admin-api';
import { SourceTestPanel } from './SourceTestPanel';
import { AiTestPanel } from './AiTestPanel';
import { ParserAssistantPanel } from './ParserAssistantPanel';
import { SourceTransferPanel } from './SourceTransferPanel';
import styles from './admin.module.css';

export const newApi = (): ApiSourceSettings => ({ method: 'GET', body: '', auth: { type: 'none', header: 'Authorization', value: '' }, mapping: { items: 'articles', title: 'title', summary: 'description', url: 'url', publishedAt: 'publishedAt', author: 'author', images: 'urlToImage', body: 'content' } });
export const newWeb = (): WebSourceSettings => ({ rules: { mode: 'metadata', item: '', title: '', summary: '', link: '', date: '', image: '', body: '', author: '', next: '' }, loadMoreText: '', loadMoreContainer: '', timeoutSeconds: 30, maxItems: 50, maxPages: 3, concurrency: 1 });
const emptySource = (): SourceSettings => ({ id: '', name: '', englishName: '', kind: 'rss', website: '', feedUrls: [''], publisherHosts: [], description: '', notes: '', logo: '', pollSeconds: 900, sortOrder: 0, adapter: 'generic', target: '', useProxy: false, api: newApi(), web: newWeb() });
const pageContext = (source: SourceSettings) => JSON.stringify([source.kind, source.target, source.publisherHosts, source.useProxy,
  source.web?.loadMoreText || '', source.web?.loadMoreContainer || '', source.web?.maxPages, source.web?.timeoutSeconds]);
const rulesContext = (source: SourceSettings, snapshotId: string) => JSON.stringify([snapshotId, source.web?.rules, source.web?.maxItems, source.timeZone, !!source.forceChina]);
function SourceEditor({ source, network, token, busy, onSave, onSaved, onCopy, onOpenNetwork, aiKeyConfigured, onAiUsage }: { source: SourceSettings; network: NetworkSettings; token: string; busy: boolean; onSave: SaveSettings; onSaved: (id: string) => void; onCopy: (source: SourceSettings) => void; onOpenNetwork: () => void; aiKeyConfigured: boolean; onAiUsage: (usage: AiTestResult['usage']) => void }) {
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(() => ({ ...emptySource(), ...source, kind: ['google-rss', 'rsshub', 'reserved'].includes(source.kind) ? 'rss' : source.kind }));
  const [feedUrls, setFeedUrls] = useState(() => source.feedUrls?.length ? source.feedUrls : [source.feedUrl || '']);
  const [hosts, setHosts] = useState(() => source.publisherHosts.join('\n'));
  const [loading, setLoading] = useState(!!source.id); const [testing, setTesting] = useState(false); const [uploading, setUploading] = useState(false);
  const [privateLoaded, setPrivateLoaded] = useState(!source.id);
  const [result, setResult] = useState<SourceTestResult | null>(null); const [error, setError] = useState(''); const [confirmDelete, setConfirmDelete] = useState(false); const [showSecret, setShowSecret] = useState(false);
  const [aiSample, setAiSample] = useState<{ title: string; summary: string } | null>(null);
  const [loadedPage, setLoadedPage] = useState<{ page: WebPagePreview; context: string } | null>(null);
  const [testingRules, setTestingRules] = useState(false);
  const [rulePreview, setRulePreview] = useState<{ result: SourceTestResult; context: string } | null>(null);
  const [parserBusy, setParserBusy] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collection, setCollection] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => { setDraft(old => old.kind === 'telegram' ? old : { ...old, useProxy: source.useProxy ?? false }); }, [source.useProxy]);
  useEffect(() => { setDraft(old => old.kind === 'telegram' ? { ...old, useProxy: network.telegramUseProxy ?? false } : old); }, [network.telegramUseProxy]);
  useEffect(() => {
    if (!source.id) return;
    let cancelled = false;
    adminApi<{ notes: string; api?: ApiSourceSettings }>(`admin/sources/${encodeURIComponent(source.id)}/private`, '').then(privateFields => {
      if (!cancelled) { setDraft(old => ({ ...old, notes: privateFields.notes, api: privateFields.api || old.api })); setPrivateLoaded(true); }
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source.id]);
  const pending = busy || collecting || testing || testingRules || uploading || loading || parserBusy || !privateLoaded;
  const change = <K extends keyof SourceSettings>(key: K, value: SourceSettings[K]) => setDraft(old => ({ ...old, [key]: value }));
  const api = draft.api || newApi(); const web = draft.web || newWeb();
  const adapter = draft.adapter || 'generic';
  const editApi = (next: ApiSourceSettings) => change('api', next);
  function selectAdapter(adapter: string) {
    const api = newApi();
    if (adapter === 'x-official') api.auth = { type: 'bearer', header: 'Authorization', value: '' };
    if (adapter === 'twitter') api.auth = { type: 'header', header: 'X-API-Key', value: '' };
    setDraft(old => ({ ...old, adapter, api }));
    setShowSecret(false); setResult(null); setError('');
  }
  const editFeeds = (update: (previous: string[]) => string[]) => { setFeedUrls(update); setResult(null); setError(''); };
  const body = () => ({ ...draft, feedUrl: feedUrls[0], feedUrls, channel: draft.kind === 'telegram' ? draft.target || draft.channel : undefined, publisherHosts: hosts.split(/[\s,]+/).filter(Boolean) });
  const page = loadedPage && loadedPage.context === pageContext(body()) ? loadedPage.page : null;
  const pageExpired = !!page && new Date(page.expiresAt).getTime() <= Date.now();
  const rulesCurrent = !!page && rulePreview?.context === rulesContext(body(), page.snapshotId);
  const displayedResult: SourceTestResult | null = draft.kind === 'web'
    ? page ? { ok: true, checkedAt: page.loadedAt, attempts: [], page } : result?.ok === false ? result : null
    : result;
  function useReuters() {
    const target = 'https://www.reuters.com/world/china/';
    setDraft(old => ({ ...old, name: old.name || '路透社', target, web: { ...(old.web || newWeb()),
      loadMoreText: 'Load more articles', loadMoreContainer: 'ul[class*="feed-list-module__list"]', timeoutSeconds: 30, maxPages: 20 } }));
    setResult(null); setLoadedPage(null); setRulePreview(null); setError('');
  }
  async function test() {
    if (!form.current?.reportValidity()) return;
    const submitted = body();
    setTesting(true); setResult(null); setLoadedPage(null); setRulePreview(null); setError('');
    try {
      const checked = await adminApi<SourceTestResult>(draft.kind === 'web' ? 'admin/sources/page' : 'admin/sources/test', token, submitted, 'POST');
      setResult(checked);
      const loaded = checked.page;
      if (loaded) {
        setDraft(old => ({ ...old, id: loaded.sourceId }));
        setLoadedPage({ page: loaded, context: pageContext(submitted) });
      }
    }
    catch (e) { setError(e instanceof Error ? e.message : '来源预览失败'); }
    finally { setTesting(false); }
  }
  async function testRules() {
    if (!page || !form.current?.reportValidity()) return;
    const submitted = body(); const context = rulesContext(submitted, page.snapshotId);
    setTestingRules(true); setRulePreview(null); setError('');
    try {
      const checked = await adminApi<SourceTestResult>('admin/sources/rules/test', token, { source: submitted, snapshotId: page.snapshotId }, 'POST');
      setRulePreview({ result: checked, context });
    } catch (e) { setError(e instanceof Error ? e.message : '解析规则测试失败'); }
    finally { setTestingRules(false); }
  }
  async function collectNow() {
    setCollecting(true); setCollection(null); setError('');
    try {
      const result = await onSave(`admin/sources/${encodeURIComponent(source.id)}/collect`, {}, 'POST');
      if (result) setCollection({ ok: result.ok === true, message: result.ok ? `${source.name}采集完成。` : result.error || '采集未完成，请查看来源详情' });
    } finally { setCollecting(false); }
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
  return <div className={styles.stack}><form ref={form} className={styles.card} onChange={() => setResult(null)} onInvalid={event => {
    if (!(event.target instanceof Element)) return;
    const group = event.target.closest('details');
    if (group) group.open = true;
  }} onSubmit={async event => {
    event.preventDefault(); const saved = await onSave('admin/sources', body()); if (saved) onSaved(saved.savedSourceId || draft.id);
  }}>
    <div className={styles.sectionTitle}><h2>{source.id ? source.name : '新增来源'}</h2>
      {source.id && <button type="button" disabled={pending} onClick={() => onCopy(body())}><Copy size={16} />复制来源</button>}
    </div>
    {loading && <p role="status">正在读取私有配置…</p>}
    {!privateLoaded && error && <p className={styles.error} role="alert">{error}</p>}
    <fieldset className={styles.fields} disabled={pending} aria-label="来源配置项">
      <label>来源名称<input required maxLength={100} value={draft.name} onChange={e => change('name', e.target.value)} /></label>
      <label>获取方式<select value={draft.kind} onChange={e => { const kind = e.target.value; setDraft(old => ({ ...old, kind, pollSeconds: kind === 'telegram' ? 0 : old.pollSeconds || 900, useProxy: kind === 'telegram' ? network.telegramUseProxy : old.useProxy })); }}><option value="rss">RSS</option><option value="web">网页爬虫</option><option value="api">API / 平台适配器</option><option value="telegram">Telegram 接收</option></select></label>
      {draft.kind === 'api' && <label className={styles.wide}>适配器<select value={adapter} onChange={e => selectAdapter(e.target.value)}><option value="generic">通用 JSON API</option><option value="x-official">X 官方 API · 账号动态</option><option value="twitter">X 搜索（TwitterAPI.io，复用上游）</option><option value="bing">Bing 搜索（复用上游）</option><option value="hackernews">Hacker News 搜索（复用上游）</option><option value="bilibili">哔哩哔哩（保留，暂不启用）</option><option value="sogou">搜狗（保留，暂不启用）</option></select></label>}
      {draft.kind === 'rss' ? <div className={`${styles.wide} ${styles.feedList}`}>
        {feedUrls.map((url, index) => <div key={index} className={styles.feedRow}><label htmlFor={`feed-${index}`}>{`RSS 地址 ${index + 1}`}</label><div className={styles.feedInput}>
          <input id={`feed-${index}`} type="url" required maxLength={2000} value={url} onChange={e => editFeeds(old => old.map((value, i) => i === index ? e.target.value : value))} />
          {index === 0 && <button type="button" disabled={feedUrls.length >= 10} onClick={() => editFeeds(old => [...old, ''])}><Plus size={16} />新增 RSS 地址</button>}
          {index > 0 && <button type="button" aria-label={`上移地址 ${index + 1}`} onClick={() => moveFeed(index, -1)}><ArrowUp size={16} /></button>}
          {index < feedUrls.length - 1 && <button type="button" aria-label={`下移地址 ${index + 1}`} onClick={() => moveFeed(index, 1)}><ArrowDown size={16} /></button>}
          {feedUrls.length > 1 && <button type="button" aria-label={`移除地址 ${index + 1}`} onClick={() => editFeeds(old => old.filter((_, i) => i !== index))}><Trash2 size={16} /></button>}
        </div></div>)}<small>每轮采集会同时请求这些地址，合并去重后处理。</small>
      </div> : <label className={styles.wide}>{draft.kind === 'telegram' ? '公开频道用户名' : draft.kind === 'api' && adapter === 'x-official' ? 'X 公开账号 / 主页地址' : draft.kind === 'api' && adapter !== 'generic' ? '搜索词 / 平台采集目标' : '采集目标 URL'}<input required maxLength={2000} value={draft.target || draft.channel || ''} onChange={e => change('target', e.target.value)} placeholder={draft.kind === 'telegram' ? 'channel_name' : draft.kind === 'api' && adapter === 'x-official' ? 'USA_China_Talk' : draft.kind === 'api' && adapter !== 'generic' ? '搜索关键词' : 'https://…'} />{draft.kind === 'telegram' && <small>先在 Telegram 客户端订阅频道，再启用来源。</small>}</label>}
      {draft.kind === 'api' && <>
        {adapter === 'generic' && <><label>请求方法<select value={api.method} onChange={e => editApi({ ...api, method: e.target.value as ApiSourceSettings['method'] })}><option>GET</option><option>POST</option></select></label>
          <label>鉴权方式<select value={api.auth.type} onChange={e => editApi({ ...api, auth: { ...api.auth, type: e.target.value as ApiSourceSettings['auth']['type'] } })}><option value="none">无</option><option value="bearer">Bearer Token</option><option value="header">自定义请求头 / API Key</option></select></label>
          {api.auth.type === 'header' && <label>鉴权请求头名称<input required value={api.auth.header} onChange={e => editApi({ ...api, auth: { ...api.auth, header: e.target.value } })} placeholder="X-API-Key" /></label>}
        </>}
        {(adapter === 'x-official' || adapter === 'twitter' || (adapter === 'generic' && api.auth.type !== 'none')) && <label>{adapter === 'x-official' ? 'X 官方 Bearer Token' : adapter === 'twitter' ? 'TwitterAPI.io API Key' : '鉴权值'}<input type={showSecret ? 'text' : 'password'} autoComplete="new-password" maxLength={4000} value={api.auth.value} onChange={e => editApi({ ...api, auth: { ...api.auth, value: e.target.value } })} /><button type="button" aria-pressed={showSecret} onClick={() => setShowSecret(value => !value)}>{showSecret ? '隐藏' : '显示'}</button></label>}
        {adapter === 'generic' && <>{api.method === 'POST' && <label className={styles.wide}>JSON 请求内容<textarea rows={5} maxLength={10000} value={api.body} onChange={e => editApi({ ...api, body: e.target.value })} /></label>}
          <details className={styles.wide}><summary>API 字段映射（属性路径，不能填脚本）</summary><div className={styles.fields}>{Object.entries(api.mapping).map(([key, value]) => <label key={key}>{({ items: '新闻数组路径（空表示根数组）', title: '标题', summary: '摘要', url: '原文链接', publishedAt: '发布时间', author: '作者', images: '图片', body: '正文' } as Record<string, string>)[key]}<input value={value} onChange={e => editApi({ ...api, mapping: { ...api.mapping, [key]: e.target.value } })} /></label>)}</div></details>
        </>}
      </>}
      {draft.kind === 'web' && <div className={styles.wide}>
        <details className={styles.details}><summary>网页加载设置</summary>
          {(!draft.id || draft.id === 'reuters' || /^https:\/\/(www\.)?reuters\.com\//i.test(draft.target || '')) && <button type="button" onClick={useReuters}>填入路透社示例</button>}
          <div className={styles.fields}>
            <label>加载更多按钮文字<input maxLength={120} value={web.loadMoreText || ''} placeholder="Load more articles" onChange={e => change('web', { ...web, loadMoreText: e.target.value })} /><small>留空只加载当前页。</small></label>
            <label>内容增长区域 CSS<input maxLength={500} value={web.loadMoreContainer || ''} placeholder={'ul[class*="feed-list-module__list"]'} onChange={e => change('web', { ...web, loadMoreContainer: e.target.value })} /><small>填写按钮文字时需要指定。</small></label>
            {(['timeoutSeconds', 'maxPages'] as const).map(key => <label key={key}>{key === 'timeoutSeconds' ? '每次页面操作超时（秒）' : '页数上限（含首屏）'}<input type="number" min={key === 'timeoutSeconds' ? 5 : 1} max={key === 'timeoutSeconds' ? 120 : 20} value={web[key]} onChange={e => change('web', { ...web, [key]: Number(e.target.value) })} /></label>)}
          </div>
        </details>
        <details className={styles.details}><summary>自动采集解析规则</summary>
          <label>解析方式<select value={web.rules.mode} onChange={e => change('web', { ...web, rules: { ...web.rules, mode: e.target.value as 'metadata' | 'css' } })}><option value="metadata">文章 / 列表元数据（JSON-LD、Open Graph）</option><option value="css">列表 CSS 选择器</option></select></label>
          <div className={styles.fields}>{Object.entries(web.rules).filter(([key]) => key !== 'mode').map(([key, value]) => <label key={key}>{({ item: '新闻条目', title: '标题', summary: '摘要', link: '链接', date: '发布时间', image: '图片', body: '正文', author: '作者', next: '下一页链接' } as Record<string, string>)[key]}<input maxLength={500} value={value} onChange={e => change('web', { ...web, rules: { ...web.rules, [key]: e.target.value } })} /></label>)}</div>
          <div className={styles.fields}>{(['maxItems', 'concurrency'] as const).map(key => <label key={key}>{key === 'maxItems' ? '单次条数上限' : '浏览器并发上限'}<input type="number" min={1} max={key === 'maxItems' ? 500 : 3} value={web[key]} onChange={e => change('web', { ...web, [key]: Number(e.target.value) })} /></label>)}</div>
        </details>
      </div>}
      <label>采集间隔（秒）<input type="number" required min={draft.kind === 'telegram' ? 0 : 60} max={86400} value={draft.pollSeconds} onChange={e => change('pollSeconds', Number(e.target.value))} />{draft.kind === 'telegram' && <small>Telegram 按消息接收。</small>}</label>
      <label>显示顺序<input type="number" required step={1} min={Number.MIN_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} value={draft.sortOrder ?? ''} disabled={pending} title={source.editedAt ? `上次编辑：${new Date(source.editedAt).toLocaleString('zh-CN')}` : undefined} onChange={event => change('sortOrder', event.target.value === '' ? undefined : event.target.valueAsNumber)} /><small>数字越小越靠前。</small></label>
      <div className={styles.wide}><label className={styles.check}><input type="checkbox" checked={draft.useProxy ?? false} onChange={e => change('useProxy', e.target.checked)} />{draft.kind === 'telegram' ? 'Telegram 账号使用代理' : '使用共享代理'}</label>{network.mode === 'direct' && <button type="button" className={styles.linkButton} onClick={onOpenNetwork}>配置共享代理</button>}</div>
      <details className={`${styles.wide} ${styles.details}`}><summary>展示与筛选</summary><div className={styles.fields}>
        <label>Logo 地址<input value={draft.logo || ''} maxLength={2000} onChange={e => change('logo', e.target.value)} placeholder="https://…" /></label>
        <label>上传 Logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void upload(e.target.files?.[0])} /><small>最大 1 MiB。{draft.logo && <a href={draft.logo} target="_blank" rel="noopener noreferrer">查看 Logo</a>}</small></label>
        <label>公开说明<textarea rows={2} maxLength={800} value={draft.description} onChange={e => change('description', e.target.value)} /></label>
        <label>私人备注<textarea rows={2} maxLength={2000} value={draft.notes || ''} onChange={e => change('notes', e.target.value)} /></label>
        <label>默认发布时间时区<input value={draft.timeZone || 'UTC'} onChange={e => change('timeZone', e.target.value)} placeholder="UTC / Europe/London / Asia/Shanghai" /><small>仅用于未标明时区的发布时间。</small></label>
        <div><label className={styles.check}><input type="checkbox" checked={draft.forceChina ?? false} onChange={e => change('forceChina', e.target.checked)} />强制视为涉华</label><small className={styles.hint}>保存后也更新已有新闻，其他筛选仍生效。</small></div>
      </div></details>
      <details className={styles.wide}><summary>高级出处识别</summary><label>允许的原文发布者域名<textarea rows={3} value={hosts} onChange={e => setHosts(e.target.value)} /><small>每行一个域名，接受子域名。Google 索引和内部 RSSHub 必须明确配置；普通 RSS / 网页默认使用目标域名。</small></label>{result?.samples?.length && <button type="button" onClick={() => { const values = result.samples!.flatMap(sample => { try { return sample.url ? [new URL(sample.url).hostname] : []; } catch { return []; } }); setHosts([...new Set([...hosts.split(/[\s,]+/).filter(Boolean), ...values])].join('\n')); }}>从样例链接补充域名，保存前请核对</button>}</details>
    </fieldset>
    {privateLoaded && error && <p className={styles.error} role="alert">{error}</p>}
    {draft.kind === 'api' && ['twitter', 'x-official'].includes(adapter) && <p className={styles.hint}>预览和采集都可能消耗平台额度。</p>}
    <div className={styles.formActions}>
      <span>{source.id ? '预览使用当前表单，不入库。' : '新来源保存后默认暂停。'}</span>
      <button type="button" disabled={pending} onClick={() => void test()}><FlaskConical size={16} />{testing ? '预览中…' : draft.kind === 'web' ? '测试加载网页' : '预览来源'}</button>
      <button type="submit" className={styles.primary} disabled={pending}>保存来源</button>
    </div>
  </form>{(displayedResult || draft.kind === 'web' && (page || rulePreview)) && <section className={styles.card} aria-label="来源预览结果">
    <div className={styles.sectionTitle}><h2>预览结果</h2>{draft.kind === 'web' && <button type="button" disabled={pending || !page || pageExpired} onClick={() => void testRules()}>{testingRules ? '正在测试规则…' : '测试现有规则'}</button>}</div>
    {pageExpired && <p className={styles.error} role="status">页面快照已过期，请重新测试加载网页。</p>}
    {draft.kind === 'web' && page && rulePreview && !rulesCurrent && <p role="status">配置已修改，请重新测试现有规则。</p>}
    {draft.kind === 'web' && rulePreview && rulesCurrent && <><h3>现有规则提取结果</h3><SourceTestPanel result={rulePreview.result} /></>}
    {displayedResult && <SourceTestPanel result={displayedResult} onAnalyze={setAiSample} />}
  </section>}{draft.kind === 'web' && <ParserAssistantPanel key={page?.snapshotId || 'no-page'} page={page} getSource={body} source={source} instructions={web.parseInstructions || ''} onInstructions={value => change('web', { ...web, parseInstructions: value })} disabled={pending} keyConfigured={aiKeyConfigured} onSave={onSave} onBusy={setParserBusy} onApplied={saved => {
    const id = saved.savedSourceId || draft.id; const next = saved.sources.find(s => s.id === id); if (next) setDraft(old => ({ ...old, web: next.web, target: next.target })); onSaved(id);
  }} />}{aiSample && <AiTestPanel key={JSON.stringify(aiSample)} sample={aiSample} token="" busy={pending} keyConfigured={aiKeyConfigured} onUsage={onAiUsage} />}
    {source.id && <section className={styles.card} aria-label="已保存来源的采集操作">
      <h2>采集状态</h2>
      {source.state && <NewsSourceRow source={source.state} pending={pending} onChange={(s, update) => { void onSave(`sources/${s.id}`, update); }} />}
      <div className={styles.formActions}>
        <button type="button" className={styles.danger} aria-expanded={confirmDelete} disabled={pending} onClick={() => setConfirmDelete(!confirmDelete)}><Trash2 size={16} />删除来源</button>
        {source.kind !== 'telegram' && <button type="button" disabled={pending || !source.state?.enabled || !source.state.configured} onClick={() => void collectNow()}><Download size={16} />{collecting ? '正在采集…' : '立即采集并入库'}</button>}
      </div>
      {source.kind !== 'telegram' && <p className={styles.hint}>{source.state?.enabled && source.state.configured ? '使用已保存的配置。' : '启用来源后可立即采集。'}{source.kind === 'api' && ['twitter', 'x-official'].includes(source.adapter || '') ? '此操作可能消耗平台额度。' : ''}</p>}
      {collection && <p className={collection.ok ? styles.notice : styles.error} role={collection.ok ? 'status' : 'alert'}>{collection.message}</p>}
      {confirmDelete && <div className={styles.deleteConfirm}><p>停止采集，保留新闻、收藏、规则和分析缓存。</p><div className={styles.formActions}><button type="button" onClick={() => setConfirmDelete(false)}>取消</button><button type="button" className={styles.danger} disabled={pending} onClick={async () => { if (await onSave(`admin/sources/${encodeURIComponent(source.id)}`, {}, 'DELETE')) onSaved(''); }}>确认删除</button></div></div>}
    </section>}
  </div>;
}
export function SourceSettingsForm({ sources, network, token, busy, onSave, onOpenNetwork, aiKeyConfigured, onAiUsage }: { sources: SourceSettings[]; network: NetworkSettings; token: string; busy: boolean; onSave: SaveSettings; onOpenNetwork: () => void; aiKeyConfigured: boolean; onAiUsage: (usage: AiTestResult['usage']) => void }) {
  const editor = useRef<HTMLElement>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [selected, setSelected] = useState(sources[0]?.id || '');
  const [newSource, setNewSource] = useState(emptySource);
  const [draftVersion, setDraftVersion] = useState(0);
  const source = sources.find(s => s.id === selected) || newSource;
  function selectSource(id: string) { setSelected(id); setNewSource(emptySource()); }
  function revealEditor() { if (editor.current && editor.current.getBoundingClientRect().top < 16) editor.current.scrollIntoView(); }
  function startNew(template = emptySource()) { setNewSource(template); setSelected(''); setDraftVersion(version => version + 1); revealEditor(); }
  function copySource(template: SourceSettings) {
    startNew({ ...template, id: '', state: undefined, sortOrder: 0, editedAt: undefined, name: `${template.name.slice(0, 96)}（副本）`,
      web: template.web ? { ...template.web, previousRules: undefined } : undefined });
  }
  const pending = busy || transferBusy;
  return <div className={styles.stack}><SourceTransferPanel busy={busy} onBusy={setTransferBusy} onSave={onSave} onImported={() => { setNewSource(emptySource()); setDraftVersion(version => version + 1); }} /><div className={styles.sourceLayout}><section className={styles.sourceDirectory} aria-label="来源目录">
    <button type="button" disabled={pending} className={`${styles.add} ${styles.primary}`} onClick={() => startNew()}><Plus size={16} />新增来源</button>
    <div className={styles.sourcePicker} tabIndex={0} role="group" aria-label="现有来源">
    {sources.map(s => <div key={s.id} className={styles.sourceEntry}>
      <button type="button" disabled={pending} aria-pressed={selected === s.id} className={`${styles.sourceSelect} ${selected === s.id ? styles.selected : ''}`} onClick={() => { selectSource(s.id); revealEditor(); }}><span>{s.name}<small>{s.kind}</small></span></button>
      <button type="button" role="switch" aria-checked={s.state?.enabled ?? false} aria-label={`${s.state?.enabled ? '暂停' : '启动'}${s.name}`} className={`${styles.sourceToggle} ${s.state?.enabled ? styles.sourceToggleOn : ''}`} disabled={pending || !s.state || (!s.state.enabled && !s.state.configured)} title={!s.state?.enabled && !s.state?.configured ? '请先完成来源配置' : s.state?.enabled ? '点击暂停采集' : '点击启动采集'} onClick={() => void onSave(`sources/${encodeURIComponent(s.id)}`, { enabled: !s.state!.enabled })}>{s.state?.enabled ? '已开启' : '已暂停'}</button>
    </div>)}
    </div>
  </section><section ref={editor} className={styles.sourceEditor} aria-label="来源编辑与预览"><SourceEditor key={`${source.id || 'new-source'}-${draftVersion}`} source={source} network={network} token={token} busy={pending} onSave={onSave} onSaved={selectSource} onCopy={copySource} onOpenNetwork={onOpenNetwork} aiKeyConfigured={aiKeyConfigured} onAiUsage={onAiUsage} /></section></div></div>;
}
