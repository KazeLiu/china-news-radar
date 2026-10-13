import type { Source } from '../NewsSourceRow';

export interface AiSettings { enabled: boolean; baseUrl: string; model: string; dailyLimit: number; instructions: string; keyConfigured: boolean; protocolPrompt: string }
export interface AiTestResult {
  ok: boolean; checkedAt: string; model: string; elapsedMs: number;
  input: { title: string; summary: string; truncated: boolean }; usage: { used: number; limit: number };
  error?: { code: string; message: string; status?: number };
  result?: {
    version: 1; relation: 'related' | 'unrelated' | 'uncertain';
    topics: ('policy' | 'economy' | 'diplomacy' | 'technology' | 'security' | 'society')[];
    type: 'breaking' | 'report' | 'analysis' | 'opinion' | 'feature' | 'sports' | 'entertainment' | 'other';
    language: 'zh-Hans' | 'zh-Hant' | 'en' | 'other' | 'mixed'; reason: string;
    translation: { title: string; summary: string } | null;
  };
  preview?: { visible: boolean; decisionBy: string };
}
export interface SourceSettings { id: string; name: string; englishName: string; kind: string; website: string; feedUrl?: string; feedUrls?: string[]; publisherHosts: string[]; description: string; pollSeconds: number; state?: Source }
export interface SourceTestResult {
  ok: boolean; checkedAt: string; feedUrl?: string; feedTitle?: string; error?: string; rawCount?: number; checkedCount?: number; acceptedCount?: number;
  attempts: { url: string; status: number | null; error: string | null }[];
  samples?: { title: string; summary: string; url: string | null; publishedAt: string | null; accepted: boolean; reason: string | null; fallbackVisible: boolean }[];
}
export interface FilterRule { id: string; enabled: boolean; sourceId: string; field: 'titleExact' | 'titleContains' | 'textContains' | 'urlPrefix' | 'urlExact'; value: string }
export interface AdminSettings { ai: AiSettings; sources: SourceSettings[]; rules: FilterRule[]; localOnly: boolean; status: { aiMode: string; aiDailyUsed: number; aiDailyLimit: number; aiPending: number; aiFailed: number }; changed?: number }
export async function adminApi<T>(path: string, token: string, body?: unknown, method = 'PUT'): Promise<T> {
  const response = await fetch(`/api/news/${path}`, { cache: 'no-store', method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Admin-Token': token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(typeof result.message === 'string' ? result.message : `请求失败（${response.status}）`);
  }
  return response.json();
}
export type SaveSettings = (path: string, body: unknown, method?: string) => Promise<boolean>;
