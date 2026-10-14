import type { Source, RssAddressStatus } from '../NewsSourceRow';
import { requestJson } from '@/services/http';

export interface AiSettings { enabled: boolean; baseUrl: string; model: string; dailyLimit: number; instructions: string; keyConfigured: boolean; protocolPrompt: string; intervalMs: number; autoAnalyzeNew: boolean; newsOutputTokens: number }
export interface AiTestResult {
  ok: boolean; checkedAt: string; model: string; elapsedMs: number;
  input: { title: string; summary: string; truncated: boolean }; usage: { used: number; limit: number };
  error?: { code: string; message: string; detail?: string; errorType?: string; status?: number; requestId?: string; networkCode?: string };
  result?: {
    version: 1 | 2; relation: 'related' | 'unrelated' | 'uncertain';
    topics: ('policy' | 'economy' | 'diplomacy' | 'technology' | 'security' | 'society')[];
    type: 'breaking' | 'report' | 'analysis' | 'opinion' | 'feature' | 'sports' | 'entertainment' | 'other';
    language: 'zh-Hans' | 'zh-Hant' | 'en' | 'other' | 'mixed'; reason: string;
    translation: { title: string; summary: string } | null;
  };
  preview?: { visible: boolean; decisionBy: string };
}
export interface ApiSourceSettings { method: 'GET' | 'POST'; body: string; auth: { type: 'none' | 'bearer' | 'header'; header: string; value: string; keyConfigured?: boolean }; mapping: { items: string; title: string; summary: string; url: string; publishedAt: string; author: string; images: string; body: string } }
export interface WebRules { mode: 'metadata' | 'css'; item: string; title: string; summary: string; link: string; date: string; image: string; body: string; author: string; next: string }
export interface WebSourceSettings { rules: WebRules; previousRules?: WebRules; timeoutSeconds: number; maxItems: number; maxPages: number; concurrency: number }
export interface SourceSettings { id: string; name: string; englishName: string; kind: string; website: string; feedUrl?: string; feedUrls?: string[]; publisherHosts: string[]; description: string; pollSeconds: number; state?: Source; target?: string; logo?: string; notes?: string; channel?: string; adapter?: string; api?: ApiSourceSettings; web?: WebSourceSettings; timeZone?: string }
export interface SourceTestResult {
  ok: boolean; checkedAt: string; feedUrl?: string; feedTitle?: string; error?: string; rawCount?: number; checkedCount?: number; acceptedCount?: number; duplicateCount?: number;
  attempts: RssAddressStatus[];
  structure?: Record<string, unknown>; code?: string; status?: number;
  samples?: { title: string; summary: string; url: string | null; publishedAt: string | null; accepted: boolean; reason: string | null; fallbackVisible: boolean; originalPublisher?: string | null; images?: string[] }[];
}
export interface FilterRule { id: string; enabled: boolean; sourceId: string; field: 'titleExact' | 'titleContains' | 'textContains' | 'urlPrefix' | 'urlExact'; value: string }
export interface NetworkSettings { mode: 'direct' | 'proxy'; proxyConfigured: boolean; secureDns: boolean }
export interface AdminSettings { ai: AiSettings; network: NetworkSettings; sources: SourceSettings[]; rules: FilterRule[]; localOnly: boolean; status: { aiMode: string; aiDailyUsed: number; aiDailyLimit: number; aiPending: number; aiFailed: number }; changed?: number; savedSourceId?: string }
export async function adminApi<T>(path: string, _token: string, body?: unknown, method = 'PUT'): Promise<T> {
  try { return await requestJson<T>(`/api/news/${path}`, { method: body === undefined ? 'GET' : method,
    credentials: 'same-origin', ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('HTTP 401') && !path.startsWith('admin/auth/')) window.dispatchEvent(new CustomEvent('admin:expired', { detail: error.message }));
    throw error;
  }
}
export type SaveSettings = (path: string, body: unknown, method?: string) => Promise<AdminSettings | false>;
export interface ManagedNews {
  id: string; title: string; summary: string; body: string; titleZh: string | null; summaryZh: string | null;
  displayTitle: string | null; displaySummary: string | null; url: string; originalUrl: string | null; originalPublisher: string | null;
  images: string; publishedAt: string | null; firstSeenAt: string; updatedAt: string; isManual: boolean;
  publicationStatus: 'draft' | 'published'; hiddenArticle: boolean; hiddenImages: boolean; visible: boolean; aiStatus: string; aiReason: string | null;
}
