import type { Source, RssAddressStatus } from '../NewsSourceRow';
import { requestJson } from '@/services/http';

export interface AiSettings { enabled: boolean; baseUrl: string; model: string; dailyLimit: number; instructions: string; keyConfigured: boolean; protocolPrompt: string; intervalMs: number; autoAnalyzeNew: boolean; newsOutputTokens: number }
export interface AiRequestSummary {
  id: string; taskId: string; kind: string; model: string; attempt: number; status: string;
  startedAt: string; finishedAt: string | null; elapsedMs: number | null; requestId: string | null;
  analyzedCount: number; translatedCount: number;
}
export interface AiRequestPage { items: AiRequestSummary[]; total: number; page: number; pageSize: number; totalPages: number; retentionDays: number }
export interface AiRequestDetail extends AiRequestSummary {
  sourceIds: string[];
  input: { model: string; max_output_tokens?: number; store?: boolean; stream?: boolean; text?: { format?: { type: string } }; input?: { role: string; content: string }[];
    temperature?: number; max_tokens?: number; response_format?: { type: string }; messages?: { role: string; content: string }[] } | null;
  output: { status?: string; incomplete_details?: { reason?: string } | null; output_text?: string;
    output?: { type: string; role?: string; status?: string; content?: { type: string; text?: string; refusal?: string }[] }[];
    choices?: { message?: { content?: string | null }; finish_reason?: string }[]; [key: string]: unknown } | null;
  error: { code: string; message: string; detail?: string; status?: number; requestId?: string } | null;
}
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
export interface WebSourceSettings { rules: WebRules; previousRules?: WebRules; loadMoreText?: string; loadMoreContainer?: string; parseInstructions?: string; timeoutSeconds: number; maxItems: number; maxPages: number; concurrency: number }
export interface SourceSettings { id: string; name: string; englishName: string; kind: string; website: string; feedUrl?: string; feedUrls?: string[]; publisherHosts: string[]; description: string; pollSeconds: number; forceChina?: boolean; useProxy?: boolean; state?: Source; target?: string; logo?: string; notes?: string; channel?: string; adapter?: string; api?: ApiSourceSettings; web?: WebSourceSettings; timeZone?: string; sortOrder?: number; editedAt?: string | null }
export interface SourceDocument { format: 'china-radar-sources'; version: 1; sources: Record<string, unknown>[] }
export interface SourceImportPreview { revision: string; document: SourceDocument; added: number; updated: number; sources: { id: string; name: string; kind: string; action: 'add' | 'update'; warnings: string[] }[] }
export interface WebPagePreview {
  snapshotId: string; sourceId: string; loadedAt: string; expiresAt: string;
  url: string; status: number; html: string; screenshot: string; bytes: number; browserMode: string;
  loadMoreClicks: number; complete: boolean; stopReason: 'loaded' | 'no-more' | 'page-limit';
}
export interface SourceTestResult {
  ok: boolean; checkedAt: string; feedUrl?: string; feedTitle?: string; error?: string; rawCount?: number; checkedCount?: number; acceptedCount?: number; duplicateCount?: number;
  attempts: RssAddressStatus[];
  structure?: Record<string, unknown>; code?: string; status?: number;
  page?: WebPagePreview;
  samples?: { title: string; summary: string; url: string | null; publishedAt: string | null; publishedAtEstimated?: boolean; accepted: boolean; reason: string | null; fallbackVisible: boolean; originalPublisher?: string | null; images?: string[] }[];
}
export interface FilterRule { id: string; enabled: boolean; sourceId: string; field: 'titleExact' | 'titleContains' | 'textContains' | 'urlPrefix' | 'urlExact'; value: string }
export interface NetworkSettings { mode: 'direct' | 'proxy'; proxyConfigured: boolean; secureDns: boolean; telegramUseProxy: boolean }
export interface BrowserPreferences { initialWaitSeconds: number; navigationQuietSeconds: number; sessionTimeoutSeconds: number }
export interface BrowserSettings extends BrowserPreferences { defaults: BrowserPreferences; runtime: { engine: string; version: string; platform: string; mode: string } }
export interface AdminSettings { ai: AiSettings; network: NetworkSettings; browser: BrowserSettings; sources: SourceSettings[]; rules: FilterRule[]; localOnly: boolean; status: { aiMode: string; aiDailyUsed: number; aiDailyLimit: number; aiPending: number; aiFailed: number }; changed?: number; savedSourceId?: string; collectedSourceId?: string; importedSources?: { added: number; updated: number }; ok?: boolean; error?: string }
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
  id: string; sourceId: string; title: string; sourceTitlePresent: boolean; titleGenerated: boolean; aiGeneratedTitle: string | null; summary: string; body: string; titleZh: string | null; summaryZh: string | null;
  displayTitle: string | null; displaySummary: string | null; url: string; originalUrl: string | null; originalPublisher: string | null;
  images: string; sourceLinks: string; publishedAt: string | null; firstSeenAt: string; updatedAt: string; isManual: boolean;
  publicationStatus: 'draft' | 'published'; hiddenArticle: boolean; hiddenImages: boolean; visible: boolean; aiStatus: string; aiReason: string | null;
  deletedAt: string | null;
}
