/**
 * Server-side data fetching for SSR pages.
 *
 * SERVER ONLY — do not import from a `'use client'` module. Client code must
 * keep using `services/api.ts`, whose relative `/api` paths rely on the
 * rewrites in `next.config.ts`. Server components have no origin, so they
 * need an absolute URL, which is why this file exists separately.
 *
 * Why the fallback chain: `NEXT_PUBLIC_API_URL` is only set at runtime in
 * docker-compose (not as a build arg), so during `next build` it is undefined.
 * Pages using this helper must therefore opt out of build-time prerendering
 * with `export const dynamic = 'force-dynamic'`.
 */

import type { DigestData, Hotspot } from '../types';
import { requestJson } from '../services/http';

const API_ORIGIN =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

const TIMEOUT_MS = 5000;

/** Shape of `GET /api/curated` — an object, not a bare array. */
export interface CuratedResponse {
  period: 'today' | 'week';
  total: number;
  limit: number;
  offset: number;
  items: Hotspot[];
}

/** Shape of `GET /api/hotspots` — `{ data, pagination }`, not `{ items, total }`. */
export interface HotspotsResponse {
  data: Hotspot[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/** One entry of `GET /api/digest/recent`. */
export interface DigestSummary {
  date: string;
  summary: string;
  createdAt: string;
}

/** Shape of `GET /api/digest/:date`. The API returns `null` when absent. */
export interface DigestRecord {
  date: string;
  data: DigestData;
  createdAt: string;
}

async function getJson<T>(path: string, allowEmpty = false): Promise<T> {
  return requestJson<T>(`${API_ORIGIN}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) }, allowEmpty);
}

/**
 * Fetch curated hotspots for the default view (no category/region/search).
 *
 * Service failures reach the route's error boundary instead of appearing empty.
 */
export async function fetchCuratedSSR(
  period: 'today' | 'week' = 'today',
  limit = 50,
): Promise<CuratedResponse> {
  const params = new URLSearchParams({
    period,
    limit: String(limit),
    offset: '0',
  });

  return getJson<CuratedResponse>(`/api/curated?${params}`);
}

/**
 * Fetch the default hotspot feed (page 1, no filters) for the initial HTML.
 *
 * Only the list is prefetched. Keywords and the WebSocket subscription stay
 * client-side — they drive live updates, which crawlers never see anyway.
 */
export async function fetchHotspotsSSR(limit = 20): Promise<HotspotsResponse> {
  const params = new URLSearchParams({ limit: String(limit), page: '1' });

  return getJson<HotspotsResponse>(`/api/hotspots?${params}`);
}

/**
 * Fetch one day's digest. Returns `null` when that date has no digest yet —
 * the backend answers 200 with an *empty* body rather than a 404 (see the
 * empty-text guard in `getJson`), and callers use `null` to render the empty
 * state (or trigger `notFound()`).
 */
export async function fetchDigestSSR(date: string): Promise<DigestRecord | null> {
  return getJson<DigestRecord | null>(`/api/digest/${date}`, true);
}

/**
 * Fetch the list of dates that have a digest, newest first.
 *
 * Used by the sidebar and the dynamic sitemap; neither runs during the build.
 */
export async function fetchRecentDigestsSSR(): Promise<DigestSummary[]> {
  return getJson<DigestSummary[]>('/api/digest/recent');
}
export interface NewsArticle {
  id: string; title: string; titleZh: string | null; summary: string; summaryZh: string | null; body: string;
  sourceTitlePresent: boolean; titleGenerated: boolean;
  displaySummary?: string | null;
  images: string; sourceLinks: string[]; originalPublisher: string | null; originalUrl: string | null; isManual: boolean;
  publishedAt: string | null; firstSeenAt: string;
}
export async function fetchArticleSSR(id: string): Promise<NewsArticle | null> {
  try { return await getJson<NewsArticle>(`/api/news/items/${encodeURIComponent(id)}`); }
  catch (error) { if (error instanceof Error && error.message.startsWith('HTTP 404')) return null; throw error; }
}
