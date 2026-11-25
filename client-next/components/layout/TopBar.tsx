'use client';
import { Menu, Sun, Moon } from 'lucide-react';
import { FEED_WIDTHS, useFeedWidth, useReadingPreference } from '@/providers/ReadingPreference';
import { cn } from '@/lib/utils';

interface TopBarProps {
  onMenuClick: () => void;
  theme: 'dark' | 'light';
  onThemeToggle: () => void;
  showFeedWidth: boolean;
}

export function TopBar({ onMenuClick, theme, onThemeToggle, showFeedWidth }: TopBarProps) {
  const { translationFirst, toggleTranslationFirst } = useReadingPreference();
  const { width, setWidth } = useFeedWidth();
  return (
    <header className="flex items-center justify-between h-12 px-2.5 sm:px-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="打开菜单"
        className="lg:hidden p-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="hidden lg:block" />
      <div className="flex items-center gap-1 sm:gap-2">
        {showFeedWidth && <div role="group" aria-label="列表宽度" className="flex items-center whitespace-nowrap rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-0.5 text-xs">
          {FEED_WIDTHS.map(item => <button key={item.value} type="button" aria-pressed={width === item.value} title={item.title}
            onClick={() => setWidth(item.value)} className={cn('min-h-8 min-w-8 rounded-md px-1.5 sm:px-2 hover:bg-[var(--bg-hover)]',
              width === item.value ? 'bg-[var(--bg-elevated)] font-semibold text-[var(--accent-blue)]' : 'text-[var(--text-secondary)]')}>
            {item.label}
          </button>)}
        </div>}
        <button
          type="button"
          role="switch"
          aria-checked={translationFirst}
          onClick={toggleTranslationFirst}
          className="flex min-h-11 items-center gap-1.5 sm:gap-2 whitespace-nowrap rounded-lg px-1.5 sm:px-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <span aria-hidden="true" className={cn('relative h-4 w-8 rounded-full transition-colors', translationFirst ? 'bg-[var(--accent-blue)]' : 'bg-[var(--toggle-inactive)]')}>
            <span className={cn('absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform', translationFirst && 'translate-x-4')} />
          </span>
          译文为主
        </button>
        <button
          type="button"
          onClick={onThemeToggle}
          aria-label={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>
    </header>
  );
}
