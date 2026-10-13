import type { Source } from '../NewsSourceRow';

export interface AiSettings { enabled: boolean; baseUrl: string; model: string; dailyLimit: number; instructions: string; keyConfigured: boolean; protocolPrompt: string }
export interface AiTestResult {
  ok: boolean; checkedAt: string; model: string; elapsedMs: number;
  input: { title: string; summary: string; truncated: boolean }; usage: { used: number; limit: number };
  error?: { code: string; message: string; detail?: string; errorType?: string; status?: number; requestId?: string; networkCode?: string };
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
  let response: Response;
  try {
    response = await fetch(`/api/news/${path}`, { cache: 'no-store', method: body === undefined ? 'GET' : method,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Admin-Token': token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new Error('浏览器未收到后台响应，请检查本地服务和网络连接。'); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const detail = typeof result.message === 'string' ? result.message : [502, 504].includes(response.status) ? '前端代理没有收到后台的完整响应，请检查后台运行状态和代理等待时间。' : '后台请求失败。';
    throw new Error(`HTTP ${response.status}：${detail}`);
  }
  return response.json().catch(() => { throw new Error(`HTTP ${response.status}：后台返回的响应不是 JSON，请检查后台服务和代理配置。`); });
}
export type SaveSettings = (path: string, body: unknown, method?: string) => Promise<boolean>;
