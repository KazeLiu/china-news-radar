'use client';

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'china-radar-translation-first';
const CHANGE_EVENT = 'reading-preference:change';
const FEED_WIDTH_KEY = 'china-radar-feed-width';
export const FEED_WIDTHS = [
  { value: 'full', label: '填满', title: '铺满可用宽度' },
  { value: 'default', label: '默认', title: '最大宽度 1280px' },
  { value: 'narrow', label: '窄', title: '使用原来的列表宽度' },
] as const;
type FeedWidth = typeof FEED_WIDTHS[number]['value'];

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

const getSnapshot = () => localStorage.getItem(STORAGE_KEY) !== 'false';
const getServerSnapshot = () => true;

function toggleTranslationFirst() {
  localStorage.setItem(STORAGE_KEY, String(!getSnapshot()));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useReadingPreference() {
  const translationFirst = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { translationFirst, toggleTranslationFirst };
}

function getWidthSnapshot(): FeedWidth {
  const value = localStorage.getItem(FEED_WIDTH_KEY);
  return value === 'full' || value === 'narrow' ? value : 'default';
}
const getServerWidth = (): FeedWidth => 'default';

function setWidth(width: FeedWidth) {
  localStorage.setItem(FEED_WIDTH_KEY, width);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useFeedWidth() {
  const width = useSyncExternalStore(subscribe, getWidthSnapshot, getServerWidth);
  return { width, setWidth };
}
