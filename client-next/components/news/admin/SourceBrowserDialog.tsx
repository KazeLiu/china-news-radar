'use client';
import { useEffect, useRef, useState } from 'react';
import { adminApi, type SourceSettings, type SourceTestResult } from './admin-api';
import styles from './admin.module.css';

interface Session { id: string; sourceId: string; expiresAt: string; width: number; height: number }
interface Frame { image: string; url: string; loading: boolean; error?: string }
export function SourceBrowserDialog({ source, onClose, onResult, onSourceId }: { source: SourceSettings; onClose: () => void; onResult: (result: SourceTestResult) => void; onSourceId: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [text, setText] = useState('');
  const [frameError, setFrameError] = useState('');
  const inputs = useRef(Promise.resolve()); const moving = useRef(false); const lastMove = useRef(0);
  const closed = useRef(false);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useEffect(() => {
    if (!session) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { const next = await adminApi<Frame>(`admin/sources/browser/${session!.id}`, ''); if (!cancelled) { setFrame(next); setFrameError(''); } }
      catch (e) { if (!cancelled) setFrameError(e instanceof Error ? e.message : '画面读取失败'); if (e instanceof Error && e.message.startsWith('HTTP 404')) return; }
      if (!cancelled) timer = setTimeout(() => void poll(), 1000);
    }
    void poll();
    return () => {
      cancelled = true; clearTimeout(timer);
      if (!closed.current) void adminApi(`admin/sources/browser/${session.id}`, '', {}, 'DELETE').catch(() => console.warn('采集浏览器未能立即关闭，将在十分钟内自动结束'));
    };
  }, [session]);
  async function open() {
    setBusy(true); setError('');
    try { const opened = await adminApi<Session>('admin/sources/browser', '', source, 'POST'); setSession(opened); if (!source.id) onSourceId(opened.sourceId); }
    catch (e) { setError(e instanceof Error ? e.message : '浏览器启动失败'); }
    finally { setBusy(false); }
  }
  function input(body: Record<string, unknown>) {
    if (!session || busy || frame?.loading) return Promise.resolve();
    const next = inputs.current.then(() => adminApi(`admin/sources/browser/${session.id}/input`, '', body, 'POST')).then(() => {});
    inputs.current = next.catch(e => setError(e instanceof Error ? e.message : '浏览器操作失败'));
    return inputs.current;
  }
  async function close() {
    setBusy(true); setError('');
    try {
      await inputs.current;
      if (session) { try { await adminApi(`admin/sources/browser/${session.id}`, '', {}, 'DELETE'); } catch (e) { if (!(e instanceof Error) || !e.message.startsWith('HTTP 404')) throw e; } }
      closed.current = true; onClose();
    }
    catch (e) { setError(e instanceof Error ? e.message : '关闭失败'); }
    finally { setBusy(false); }
  }
  async function finish() {
    if (!session) return;
    setBusy(true); setError('');
    try {
      await inputs.current;
      const result = await adminApi<SourceTestResult>(`admin/sources/browser/${session.id}/finish`, '', {}, 'POST');
      onResult(result); if (result.ok) { closed.current = true; onClose(); } else setError(result.error || '尚未完成验证或解析');
    } catch (e) { setError(e instanceof Error ? e.message : '预览失败'); }
    finally { setBusy(false); }
  }
  function position(event: React.PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1279, (event.clientX - rect.left) / rect.width * 1280)), y: Math.max(0, Math.min(799, (event.clientY - rect.top) / rect.height * 800)) };
  }
  return <dialog ref={dialog} className={styles.browserDialog} aria-labelledby="source-browser-title" onCancel={event => { event.preventDefault(); if (!busy) void close(); }}>
    <div className={styles.sectionTitle}><div><h2 id="source-browser-title">远程采集浏览器 · {source.name}</h2><p>这是后端的独立 Camoufox。你可以点击、拖动、滚动或输入文字；只用于公开页面验证，请勿登录私人账号或付款。</p></div><button type="button" disabled={busy} onClick={() => void close()}>关闭窗口</button></div>
    {!session ? <><p>会话十分钟后自动关闭。完成后仅在后端内存中保留本来源验证状态三十分钟，重启或修改采集网络后清除。</p><button type="button" className={styles.primary} disabled={busy} onClick={() => void open()}>{busy ? '正在启动…' : '打开远程浏览器'}</button></> : <>
      <div className={styles.browserAddress}>{frame?.url || source.target}<span>{frame?.loading ? '页面正在加载…' : '可操作'} · 截止 {new Date(session.expiresAt).toLocaleTimeString()}</span></div>
      {frame ? <div className={styles.browserScreen} role="application" tabIndex={0} aria-label="远程网页操作区，可点击拖动，键盘支持方向键、Tab、回车和空格" onKeyDown={event => {
        const key = event.key === ' ' ? 'Space' : event.key === 'Tab' && event.shiftKey ? 'Shift+Tab' : event.key;
        if (['Enter', 'Tab', 'Shift+Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(key) && key !== 'Escape') { event.preventDefault(); void input({ type: 'key', key }); }
      }} onPointerDown={event => { event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); void input({ type: 'down', ...position(event) }); }} onPointerMove={event => {
        if (!event.buttons || moving.current || Date.now() - lastMove.current < 150) return;
        moving.current = true; lastMove.current = Date.now(); void input({ type: 'move', ...position(event) }).finally(() => { moving.current = false; });
      }} onPointerUp={event => { void input({ type: 'up', ...position(event) }); }} onPointerCancel={event => { void input({ type: 'up', ...position(event) }); }}>
        {/* The image is a private, changing browser frame, not a cacheable site asset. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={frame.image} alt="后端采集浏览器实时画面" width={1280} height={800} draggable={false} />
      </div> : <p role="status">正在读取画面…</p>}
      <div className={styles.actions}><button type="button" disabled={busy || frame?.loading} onClick={() => void input({ type: 'scroll', delta: -500 })}>向上滚动</button><button type="button" disabled={busy || frame?.loading} onClick={() => void input({ type: 'scroll', delta: 500 })}>向下滚动</button><button type="button" disabled={busy || frame?.loading} onClick={() => void input({ type: 'key', key: 'Tab' })}>Tab</button><button type="button" disabled={busy || frame?.loading} onClick={() => void input({ type: 'key', key: 'Enter' })}>回车</button><button type="button" disabled={busy || frame?.loading} onClick={() => void input({ type: 'reload' })}>重新加载</button></div>
      <div className={styles.browserText}><label>向当前焦点输入文字<input value={text} maxLength={500} onChange={event => setText(event.target.value)} /></label><button type="button" disabled={busy || frame?.loading || !text} onClick={() => { void input({ type: 'text', text }); setText(''); }}>发送文字</button></div>
      <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || !frame || frame.loading} onClick={() => void finish()}>{busy ? '正在处理…' : '完成验证并预览'}</button><span>不入库、不通知、不调用 AI。</span></div>
      {frame?.error && <p className={styles.error}>{frame.error}</p>}
    </>}{(error || frameError) && <p className={styles.error} role="alert">{error || frameError}</p>}
  </dialog>;
}
