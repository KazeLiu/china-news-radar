'use client';

import { useId, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { adminApi, type SaveSettings, type SourceDocument, type SourceImportPreview } from './admin-api';
import styles from './admin.module.css';

const template: SourceDocument = { format: 'china-radar-sources', version: 1, sources: [
  { name: '示例媒体', kind: 'rss', feedUrls: ['https://example.com/china.xml'], pollSeconds: 900, publisherHosts: ['example.com'], description: '海外涉华新闻', sortOrder: 0 },
] };
function download(document: SourceDocument, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }));
  const link = window.document.createElement('a'); link.href = url; link.download = filename;
  window.document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function SourceTransferPanel({ busy, onBusy, onSave, onImported }: { busy: boolean; onBusy: (busy: boolean) => void; onSave: SaveSettings; onImported: () => void }) {
  const [operation, setOperation] = useState(''); const [text, setText] = useState('');
  const [preview, setPreview] = useState<SourceImportPreview | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const inputId = useId(); const pending = busy || !!operation;
  function start(name: string) { setOperation(name); onBusy(true); setError(''); setNotice(''); }
  function finish() { setOperation(''); onBusy(false); }
  async function exportAll() {
    start('export');
    try { download(await adminApi<SourceDocument>('admin/sources/export', ''), `china-radar-sources-${new Date().toISOString().slice(0, 10)}.json`); setNotice('已导出服务器上保存的来源配置。'); }
    catch (error) { setError(error instanceof Error ? error.message : '来源导出失败'); }
    finally { finish(); }
  }
  async function loadFile(file?: File) {
    if (!file) return;
    setPreview(null); setError(''); setNotice('');
    if (file.size > 1_048_576) { setError('JSON 文件最大为 1 MiB'); return; }
    start('file');
    try { setText((await file.text()).replace(/^\uFEFF/, '')); }
    catch { setError('文件读取失败，请重新选择 JSON 文件'); }
    finally { finish(); }
  }
  async function inspect() {
    setPreview(null); start('preview');
    try {
      if (new Blob([text]).size > 1_048_576) throw new Error('JSON 最大为 1 MiB');
      let document: unknown;
      try { document = JSON.parse(text.replace(/^\uFEFF/, '')); }
      catch { throw new Error('JSON 格式不正确，请检查逗号、双引号及括号'); }
      setPreview(await adminApi<SourceImportPreview>('admin/sources/import/preview', '', document, 'POST'));
    } catch (error) { setError(error instanceof Error ? error.message : '导入校验失败'); }
    finally { finish(); }
  }
  async function confirm() {
    if (!preview) return;
    start('import');
    try {
      const result = await onSave('admin/sources/import', { revision: preview.revision, document: preview.document }, 'POST');
      if (!result) { setError('导入未完成，请查看页面顶部的具体错误，重新预览后再确认。'); setPreview(null); return; }
      setNotice(`导入完成：新增 ${preview.added} 个，更新 ${preview.updated} 个；这些来源均已暂停。`);
      setText(''); setPreview(null); onImported();
    } finally { finish(); }
  }
  return <section className={`${styles.card} ${styles.sourceTransfer}`} aria-label="来源导入与导出">
    <div className={styles.sectionTitle}><h2>来源导入与导出</h2><div className={styles.actions}>
      <button type="button" disabled={pending} onClick={() => void exportAll()}><Download size={16} />{operation === 'export' ? '正在导出…' : '导出 JSON'}</button>
      <button type="button" disabled={pending} onClick={() => download(template, 'china-radar-sources-template.json')}>下载模板</button>
    </div></div>
    <p>导出已保存的来源与解析规则，可在 JSON 中添加条目后导入其他服务器。不导出鉴权值、请求正文、私人备注和上传的 Logo 文件；URL 中的访问参数仍需妥善保管。</p>
    <details><summary>导入 JSON</summary><div className={styles.stack}>
      <label htmlFor={inputId}>选择 JSON 文件<input id={inputId} type="file" accept=".json,application/json" disabled={pending} onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
      <label>或粘贴、编辑 JSON<textarea rows={10} spellCheck={false} value={text} disabled={pending} onChange={event => { setText(event.target.value); setPreview(null); setError(''); setNotice(''); }} placeholder={'{"format":"china-radar-sources","version":1,"sources":[…]}'} /></label>
      <div className={styles.actions}><button type="button" disabled={pending || !text.trim()} onClick={() => void inspect()}>{operation === 'preview' ? '正在校验…' : '校验并预览'}</button></div>
      {preview && <div aria-live="polite"><h3>新增 {preview.added} 个 · 更新 {preview.updated} 个</h3>
        <ul className={styles.sourceImportList}>{preview.sources.map(source => <li key={source.id}><strong>{source.action === 'add' ? '新增' : '更新'} · {source.name}</strong><small>{source.kind} · {source.id}</small>{source.warnings.map(warning => <p key={warning}>{warning}</p>)}</li>)}</ul>
        <p>按 ID 合并，不删除未列出的来源。所有导入项都会暂停；同 ID、同接口保留本站鉴权值，接口变更需重新填写。确认后右侧未保存的来源表单将重置，不采集、不打开浏览器、不调用 AI。</p>
        <div className={styles.actions}><button type="button" className={styles.primary} disabled={pending} onClick={() => void confirm()}><Upload size={16} />{operation === 'import' ? '正在导入…' : '确认合并并暂停导入项'}</button><button type="button" disabled={pending} onClick={() => setPreview(null)}>取消</button></div>
      </div>}
    </div></details>
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
  </section>;
}
