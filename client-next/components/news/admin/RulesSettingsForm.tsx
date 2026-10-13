'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { adminApi, type FilterRule, type SaveSettings, type SourceSettings } from './admin-api';
import styles from './admin.module.css';

const fields = [['titleExact', '标题完全等于'], ['titleContains', '标题包含'], ['textContains', '标题或摘要包含'], ['urlPrefix', '原文 URL 路径前缀'], ['urlExact', '原文 URL 路径等于']];
export function RulesSettingsForm({ initial, sources, token, busy, onSave }: { initial: FilterRule[]; sources: SourceSettings[]; token: string; busy: boolean; onSave: SaveSettings }) {
  const [rules, setRules] = useState(initial);
  const [sample, setSample] = useState({ title: 'Beijing - AP News', summary: 'Beijing AP News', url: 'https://news.google.com/rss/articles/example', sourceId: 'ap' });
  const [preview, setPreview] = useState(''); const [testing, setTesting] = useState(false);
  const sampleSourceId = sources.some(source => source.id === sample.sourceId) ? sample.sourceId : sources[0]?.id || '';
  const update = (id: string, patch: Partial<FilterRule>) => { setRules(old => old.map(r => r.id === id ? { ...r, ...patch } : r)); setPreview(''); };
  return <div className={styles.stack}><form className={styles.card} onSubmit={event => { event.preventDefault(); void onSave('admin/rules', rules); }}>
    <div className={styles.sectionTitle}><div><h2>排除规则</h2><p>任意一条开启的规则命中，就从快讯中隐藏。AI 也会遵守这些规则。</p></div><button type="button" onClick={() => { setRules(old => [...old, { id: crypto.randomUUID(), sourceId: '', enabled: true, field: 'titleExact', value: '' }]); setPreview(''); }}><Plus size={16} />添加规则</button></div>
    <details className={styles.ruleGuide}><summary>这些规则怎么用？查看例子</summary><p>这里配置的是“排除”，命中任意一条启用的规则就隐藏。它不负责判断新闻是否涉华；涉华判断由 AI 或关键词兜底完成。</p><ul><li>标题完全等于：填 China - AP News，只排除这个栏目标题；China announces new tariffs 不会因此被排除。</li><li>标题包含：填 podcast，会排除标题中出现 podcast 的内容。</li><li>标题或摘要包含：填 book review，标题或摘要任一处包含它就会排除。</li><li>原文 URL 路径前缀：填 https://apnews.com/hub/，排除这个目录及其下级页面，保留 /article/ 下的新闻。</li><li>原文 URL 路径等于：只排除填写的那个地址，适合过滤媒体首页或栏目首页。</li></ul><p>“作用来源”选择所有来源时全站生效；选择某个媒体时只作用于这个媒体。匹配内容是普通文字或地址，不是正则表达式。Google 索引若没有已识别的原文链接，URL 规则只能匹配索引地址，此时可用标题规则。</p></details>
    <div className={styles.ruleList}>{rules.map((rule, index) => <div className={styles.rule} key={rule.id}>
      <label className={styles.check}><input type="checkbox" checked={rule.enabled} onChange={e => update(rule.id, { enabled: e.target.checked })} />启用</label>
      <label>作用来源<select value={rule.sourceId} onChange={e => update(rule.id, { sourceId: e.target.value })}><option value="">所有来源</option>{rule.sourceId && !sources.some(s => s.id === rule.sourceId) && <option value={rule.sourceId}>已删除来源 · {rule.sourceId}</option>}{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>匹配方式<select value={rule.field} onChange={e => update(rule.id, { field: e.target.value as FilterRule['field'] })}>{fields.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
      <label>匹配内容<input required maxLength={2000} value={rule.value} onChange={e => update(rule.id, { value: e.target.value })} /></label>
      <button type="button" aria-label={`移除第 ${index + 1} 条规则`} onClick={() => { setRules(old => old.filter(r => r.id !== rule.id)); setPreview(''); }}><Trash2 size={16} /></button>
    </div>)}</div>
    {!rules.length && <p className={styles.hint}>暂无排除规则，仍由 AI 和涉华关键词规则决定展示。</p>}
    <p className={styles.hint}>文字匹配忽略大小写与多余空格。URL 按域名和路径匹配，忽略 www、查询参数和末尾斜线；路径前缀按完整目录边界匹配。保存后重筛已有记录，保留收藏、原文和时间，不重新调用 AI。</p>
    <div className={styles.actions}><button className={styles.primary} type="submit" disabled={busy || testing}>{busy ? '保存中…' : '保存规则并重新筛选'}</button><span>修改只在点击保存后生效。</span></div>
  </form>
    <form className={styles.card} onSubmit={async event => {
      event.preventDefault(); setTesting(true); setPreview('');
      try { const result = await adminApi<{ excluded: boolean; matched: FilterRule[]; fallbackVisible: boolean }>('admin/rules/preview', token, { ...sample, sourceId: sampleSourceId, rules }, 'POST'); setPreview(result.excluded ? `将被排除：命中 ${result.matched.map(r => r.value).join('；')}` : `没有命中排除规则。关键词兜底${result.fallbackVisible ? '会展示' : '不展示'}；最终 AI 结果另行判断。`); }
      catch (error) { setPreview(error instanceof Error ? error.message : '预览失败'); }
      finally { setTesting(false); }
    }}><h2>用样例预览规则</h2><p>使用上方尚未保存的规则进行匹配，不联网、不调用 AI。</p><div className={styles.fields}>
      <label>来源<select value={sampleSourceId} onChange={e => { setSample(old => ({ ...old, sourceId: e.target.value })); setPreview(''); }}>{!sources.length && <option value="">没有已配置来源</option>}{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>标题<input required maxLength={600} value={sample.title} onChange={e => { setSample(old => ({ ...old, title: e.target.value })); setPreview(''); }} /></label>
      <label className={styles.wide}>原文或索引 URL<input type="url" required value={sample.url} onChange={e => { setSample(old => ({ ...old, url: e.target.value })); setPreview(''); }} /></label>
      <label className={styles.wide}>摘要<textarea maxLength={1600} rows={2} value={sample.summary} onChange={e => { setSample(old => ({ ...old, summary: e.target.value })); setPreview(''); }} /></label>
    </div><div className={styles.actions}><button type="submit" disabled={testing || busy}>{testing ? '预览中…' : '预览匹配结果'}</button><span role="status">{preview}</span></div></form>
  </div>;
}
