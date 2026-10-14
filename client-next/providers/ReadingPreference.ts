'use client';

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'china-radar-translation-first';
const CHANGE_EVENT = 'reading-preference:change';

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
