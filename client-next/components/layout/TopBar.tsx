'use client';
import { Menu, Sun, Moon } from 'lucide-react';
import { useReadingPreference } from '@/providers/ReadingPreference';
import { cn } from '@/lib/utils';

interface TopBarProps {
  onMenuClick: () => void;
  theme: 'dark' | 'light';
  onThemeToggle: () => void;
}

export function TopBar({ onMenuClick, theme, onThemeToggle }: TopBarProps) {
  const { translationFirst, toggleTranslationFirst } = useReadingPreference();
  return (
    <header className="flex items-center justify-between h-12 px-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="打开菜单"
        className="lg:hidden p-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="hidden lg:block" />
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={translationFirst}
          onClick={toggleTranslationFirst}
          className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
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
