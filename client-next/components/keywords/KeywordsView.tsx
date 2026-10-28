'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bookmark, LockKeyhole, LogOut } from 'lucide-react';
import { followsApi, keywordsApi, entitiesApi, type Keyword, type NewsItem } from '@/services/api';
import { HttpError } from '@/services/http';
import { BilingualText } from '../common/BilingualText';
import { AiTitleBadge } from '../common/AiTitleBadge';
import { useReadingPreference } from '@/providers/ReadingPreference';
import { getNewsText } from '@/lib/newsText';
import { relativeTime } from '@/utils/relativeTime';
import { cn } from '@/lib/utils';

export function KeywordsView() {
  const [access, setAccess] = useState<{ configured: boolean; authenticated: boolean } | null>(null);
  const [password, setPassword] = useState('');
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [selected, setSelected] = useState('');
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accessRevision, setAccessRevision] = useState(0);
  const { translationFirst } = useReadingPreference();
  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof HttpError && cause.status === 401) {
      setAccess(current => current ? { ...current, authenticated: false } : current);
      setKeywords([]); setSelected(''); setNews([]);
    }
    setError(cause instanceof Error ? cause.message : '关注列表读取失败');
  }, []);

  useEffect(() => {
    let cancelled = false;
    followsApi.access().then(value => { if (!cancelled) setAccess(value); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '访问状态读取失败'); });
    return () => { cancelled = true; };
  }, [accessRevision]);

  useEffect(() => {
    if (!access?.authenticated) return;
    let cancelled = false;
    keywordsApi.getAll().then(items => {
      if (cancelled) return;
      setKeywords(items);
      setSelected(items[0]?.id || '');
    }).catch(cause => { if (!cancelled) handleError(cause); });
    return () => { cancelled = true; };
  }, [access?.authenticated, handleError]);

  const keyword = keywords.find(item => item.id === selected);
  const keywordText = keyword?.text;
  useEffect(() => {
    if (!access?.authenticated || !keywordText) return;
    let cancelled = false;
    setLoading(true); setNews([]); setError('');
    entitiesApi.getNewsForName(keywordText, 30).then(items => { if (!cancelled) setNews(items); })
      .catch(cause => { if (!cancelled) handleError(cause); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [access?.authenticated, keywordText, handleError]);
  async function unlock(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await followsApi.unlock(password); setPassword(''); setAccess({ configured: true, authenticated: true }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法解锁'); }
    finally { setBusy(false); }
  }
  async function lock() {
    setBusy(true); setError('');
    try { await followsApi.logout(); setAccess(current => current ? { ...current, authenticated: false } : current); setKeywords([]); setSelected(''); setNews([]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '退出失败'); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto w-full max-w-5xl px-4 py-6">
    <header className="mb-6 flex items-center justify-between gap-4">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold text-[var(--text-primary)]"><Bookmark className="h-5 w-5 text-[var(--accent-blue)]" />我的关注</h1>
      {access?.authenticated && <button type="button" onClick={() => void lock()} disabled={busy} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><LogOut className="h-4 w-4" />锁定</button>}
    </header>
    {error && <p role="alert" className="mb-4 text-sm text-red-500">{error}</p>}
    {!access ? error ? <button type="button" onClick={() => { setError(''); setAccessRevision(value => value + 1); }} className="min-h-11 rounded-lg border border-[var(--card-border)] px-4 text-sm text-[var(--text-primary)]">重新读取访问状态</button> : <p role="status" className="text-[var(--text-secondary)]">正在读取访问状态…</p> : !access.authenticated ?
      <form onSubmit={unlock} className="mx-auto max-w-sm space-y-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]"><LockKeyhole className="h-5 w-5" />内部访问</h2>
        {access.configured ? <>
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]"><span>访问密码</span><input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)} className="min-h-11 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-base text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]" /></label>
          <button type="submit" disabled={busy} className="min-h-11 w-full rounded-lg bg-[var(--accent-blue)] px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? '正在解锁…' : '查看关注列表'}</button>
        </> : <p className="text-sm leading-relaxed text-[var(--text-secondary)]">管理员尚未设置访问密码，请联系管理员。</p>}
      </form> : <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="关注列表" className="flex flex-wrap content-start gap-2 md:flex-col">
          {keywords.map(item => <button type="button" key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)} className={cn('flex min-h-11 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm', selected === item.id ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]' : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-primary)]')}>
            <span className="break-all">{item.text}</span>{!item.isActive && <span className="shrink-0 text-xs text-[var(--text-muted)]">已暂停</span>}
          </button>)}
        </nav>
        <section aria-label="相关报道" className="min-w-0 space-y-3">
          {keyword && <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">{keyword.text}</h2>}
          {loading ? <p role="status" className="text-sm text-[var(--text-secondary)]">正在读取相关报道…</p> : news.map(item => {
            const text = getNewsText(item, translationFirst);
            return <article key={item.id} className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]"><span>{item.originalPublisher || item.source}</span><time dateTime={item.publishedAt || item.createdAt}>{relativeTime(item.publishedAt || item.createdAt)}</time></div>
              <h3 className="font-medium leading-relaxed text-[var(--text-primary)]"><a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent-blue)]"><BilingualText text={text.title} prefix={<AiTitleBadge generated={item.titleGenerated} />} /></a></h3>
              {text.summary.primary && <div className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]"><BilingualText text={text.summary} lineClassName="line-clamp-3" /></div>}
            </article>;
          })}
          {!loading && !news.length && !error && <p className="py-8 text-sm text-[var(--text-muted)]">{keywords.length ? '暂无相关报道' : '暂无关注项'}</p>}
        </section>
      </div>}
  </div>;
}
