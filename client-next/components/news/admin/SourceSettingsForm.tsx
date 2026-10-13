'use client';

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FlaskConical, Plus, Trash2 } from 'lucide-react';
import { NewsSourceRow } from '../NewsSourceRow';
import { adminApi, type SaveSettings, type SourceSettings, type SourceTestResult } from './admin-api';
import { SourceTestPanel } from './SourceTestPanel';
import styles from './admin.module.css';

const emptySource = (): SourceSettings => ({ id: '', name: '', englishName: '', kind: 'rss', website: '', feedUrls: [''], publisherHosts: [], description: '', pollSeconds: 120 });
function SourceEditor({ source, token, busy, onSave, onSaved }: { source: SourceSettings; token: string; busy: boolean; onSave: SaveSettings; onSaved: (id: string) => void }) {
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(() => ({ ...source, kind: source.kind === 'reserved' ? 'rss' : source.kind }));
  const [feedUrls, setFeedUrls] = useState(() => source.feedUrls?.length ? source.feedUrls : [source.feedUrl || '']);
  const [hosts, setHosts] = useState(() => source.publisherHosts.join('\n'));
  const [pollSeconds, setPollSeconds] = useState(() => String(source.pollSeconds));
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<SourceTestResult | null>(null);
  const [testError, setTestError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = busy || testing;
  const change = (key: keyof SourceSettings, value: string | number) => setDraft(old => ({ ...old, [key]: value }));
  const editFeeds = (update: (previous: string[]) => string[]) => { setFeedUrls(update); setResult(null); setTestError(''); };
  const body = () => ({ ...draft, feedUrl: feedUrls[0], feedUrls, pollSeconds: Number(pollSeconds), publisherHosts: hosts.split(/[\s,]+/).filter(Boolean) });
  async function test() {
    if (!form.current?.reportValidity()) return;
    setTesting(true); setResult(null); setTestError('');
    try { setResult(await adminApi<SourceTestResult>('admin/sources/test', token, body(), 'POST')); }
    catch (error) { setTestError(error instanceof Error ? error.message : '测试失败'); }
    finally { setTesting(false); }
  }
  function moveFeed(index: number, offset: number) {
    editFeeds(old => { const next = [...old]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  }
  return <div className={styles.stack}>
    {source.kind === 'telegram' ? <section className={styles.card}><h2>{source.name}</h2><p>频道关注关系在 Telegram 客户端管理。本站开关只控制是否接收此频道消息。</p></section> : <form ref={form} className={styles.card} onChange={() => { setResult(null); setTestError(''); }} onSubmit={async event => {
      event.preventDefault();
      if (await onSave('admin/sources', body())) onSaved(draft.id);
    }}>
    <h2>{source.id ? `编辑 ${source.name}` : '添加 RSS 来源'}</h2>
    <fieldset className={styles.fields} disabled={pending} aria-label="来源配置项">
      <label>来源 ID<input required readOnly={!!source.id} pattern="[a-z][a-z0-9-]*" maxLength={64} value={draft.id} onChange={e => change('id', e.target.value)} /><small>唯一标识，如 france24；保存后不能修改。</small></label>
      <label>显示名称<input required maxLength={100} value={draft.name} onChange={e => change('name', e.target.value)} /></label>
      <label>原始发布者名称<input required maxLength={100} value={draft.englishName} onChange={e => change('englishName', e.target.value)} /><small>只填写实际发布者名称，用于标注出处。</small></label>
      <label>入口类型<input readOnly value={/^https?:\/\/news\.google\.com(?:\/|$)/i.test(feedUrls[0]) ? 'Google News RSS 索引' : 'RSS（包含 RSSHub 地址）'} /><small>系统按 RSS 地址自动识别，无需选择。</small></label>
      <div className={`${styles.wide} ${styles.feedList}`}>
        {feedUrls.map((url, index) => <div key={index} className={styles.feedRow}>
          <label htmlFor={`feed-${index}`}>{index === 0 ? 'RSS 地址（首选）' : `备用 RSS 地址 ${index}`}</label>
          <div className={styles.feedInput}><input id={`feed-${index}`} type="url" required maxLength={2000} value={url} disabled={pending} onChange={e => editFeeds(old => old.map((value, i) => i === index ? e.target.value : value))} />
            {index === 0 && <button type="button" disabled={pending || feedUrls.length >= 10} onClick={() => editFeeds(old => [...old, ''])}><Plus size={16} />添加</button>}
            {index > 0 && <button type="button" disabled={pending} aria-label={`将备用地址 ${index} 上移`} onClick={() => moveFeed(index, -1)}><ArrowUp size={16} /></button>}
            {index < feedUrls.length - 1 && <button type="button" disabled={pending} aria-label={`将地址 ${index + 1} 下移`} onClick={() => moveFeed(index, 1)}><ArrowDown size={16} /></button>}
            {feedUrls.length > 1 && <button type="button" disabled={pending} aria-label={`移除地址 ${index + 1}`} onClick={() => editFeeds(old => old.filter((_, i) => i !== index))}><Trash2 size={16} /></button>}
          </div>
        </div>)}
        <small>按顺序获取，前一条连接失败或格式错误时尝试下一条。可填媒体 RSS 或 RSSHub 完整地址，最多 10 条；Google 索引会自动识别并核对发布者域名。</small>
      </div>
      <label>媒体网站<input type="url" required value={draft.website} onChange={e => change('website', e.target.value)} /></label>
      <label>检查间隔（秒）<input type="number" required min={60} max={86400} value={pollSeconds} onChange={e => setPollSeconds(e.target.value)} /></label>
      <label>允许的原文域名<textarea rows={3} required value={hosts} onChange={e => setHosts(e.target.value)} /><small>每行一个域名，如 apnews.com；自动接受其子域名。</small></label>
      <label>来源说明<textarea rows={3} maxLength={800} value={draft.description} onChange={e => change('description', e.target.value)} /></label>
    </fieldset>
    <div className={styles.actions}><button type="submit" className={styles.primary} disabled={pending}>{busy ? '保存中…' : '保存来源配置'}</button><span>新来源默认暂停，保存后再开启采集。</span></div>
  </form>}
  <section className={styles.card} aria-label="来源信息面板"><h2>来源信息</h2>
    {source.state && <NewsSourceRow source={source.state} pending={pending} onChange={(s, update) => { void onSave(`sources/${s.id}`, update); }} />}
    <div className={styles.actions}>
      {source.kind !== 'telegram' && <button type="button" disabled={pending} onClick={() => { void test(); }}><FlaskConical size={16} />{testing ? '正在按顺序获取…' : '测试获取一次'}</button>}
      {source.id && <button type="button" className={styles.danger} disabled={pending} onClick={() => setConfirmDelete(true)}><Trash2 size={16} />删除来源</button>}
    </div>
    {source.kind !== 'telegram' && <p className={styles.hint}>按上方当前填写的地址测试，无需先保存。不会入库或调用 AI；测试结果只在本页面显示。</p>}
    {confirmDelete && <div className={styles.deleteConfirm} role="alert"><p>确定删除“{source.name}”？将停止采集并移除来源配置，已有新闻、收藏和针对该来源的排除规则会保留。</p><div className={styles.actions}><button type="button" className={styles.danger} disabled={pending} onClick={async () => { if (await onSave(`admin/sources/${encodeURIComponent(source.id)}`, {}, 'DELETE')) onSaved(''); }}>确定删除</button><button type="button" disabled={pending} onClick={() => setConfirmDelete(false)}>取消</button></div></div>}
    {testError && <p className={styles.error} role="alert">{testError}</p>}
    {result && <SourceTestPanel result={result} />}
  </section></div>;
}
export function SourceSettingsForm({ sources, token, busy, onSave }: { sources: SourceSettings[]; token: string; busy: boolean; onSave: SaveSettings }) {
  const [selected, setSelected] = useState(sources[0]?.id || '');
  const source = sources.find(s => s.id === selected) || emptySource();
  return <div className={styles.sourceLayout}><section className={styles.sourcePicker} aria-label="来源目录"><button disabled={busy} className={styles.add} onClick={() => setSelected('')}><Plus size={16} />添加 RSS 来源</button>{sources.map(s => <button key={s.id} disabled={busy} aria-pressed={selected === s.id} className={selected === s.id ? styles.selected : ''} onClick={() => setSelected(s.id)}><span>{s.name}<small>{s.englishName}</small></span><small>{s.state?.enabled ? '开启' : '暂停'}</small></button>)}</section><SourceEditor key={source.id || 'new-source'} source={source} token={token} busy={busy} onSave={onSave} onSaved={setSelected} /></div>;
}
