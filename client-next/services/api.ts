import { requestJson } from './http';
import type { CuratedResponse, DigestRecord } from '../lib/server-api';
import type { Stats } from '../types';
import { adminHeaders } from './admin-session';
import { waitForAiTask, type AiTicket } from './ai-tasks';

export interface Keyword {
  id: string;
  text: string;
  category: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { hotspots: number };
}

export interface Hotspot {
  id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  sourceId: string | null;
  isReal: boolean;
  relevance: number;
  relevanceReason: string | null;
  keywordMentioned: boolean | null;
  importance: 'low' | 'medium' | 'high' | 'urgent';
  summary: string | null;
  viewCount: number | null;
  likeCount: number | null;
  retweetCount: number | null;
  replyCount: number | null;
  commentCount: number | null;
  quoteCount: number | null;
  danmakuCount: number | null;
  authorName: string | null;
  authorUsername: string | null;
  authorAvatar: string | null;
  authorFollowers: number | null;
  authorVerified: boolean | null;
  publishedAt: string | null;
  createdAt: string;
  keyword: { id: string; text: string; category: string | null } | null;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.method && options.method !== 'GET') for (const [name, value] of Object.entries(adminHeaders())) if (!headers.has(name)) headers.set(name, value);
  return requestJson<T>(`/api${endpoint}`, { ...options, headers });
}

// Keywords API
export const keywordsApi = {
  getAll: () => request<Keyword[]>('/keywords'),
  
  create: (data: { text: string; category?: string }) => 
    request<Keyword>('/keywords', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  
  update: (id: string, data: { text?: string; isActive?: boolean }) => request<Keyword>(`/keywords/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => 
    request<void>(`/keywords/${id}`, { method: 'DELETE' })
};

export const followsApi = {
  access: () => request<{ configured: boolean; authenticated: boolean }>('/follows/access'),
  unlock: (password: string) => request<{ authenticated: boolean }>('/follows/unlock', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request('/follows/logout', { method: 'POST' }),
};

// Hotspots API
export const hotspotsApi = {
  getAll: (params?: { 
    page?: number; 
    limit?: number; 
    source?: string; 
    importance?: string; 
    keywordId?: string;
    isReal?: string;
    timeRange?: string;
    timeFrom?: string;
    timeTo?: string;
    sortBy?: string;
    sortOrder?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') searchParams.append(key, String(value));
      });
    }
    return request<{ data: Hotspot[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
      `/hotspots?${searchParams}`
    );
  },
  
  getStats: () => request<Stats>('/hotspots/stats')
};

// Manual trigger
export const triggerHotspotCheck = () =>
  request<{ message: string; isScanning: boolean; lastScanStartedAt?: string; lastScanFinishedAt?: string }>(
    '/check-hotspots',
    { method: 'POST' },
  );

export const getScanStatus = () =>
  request<{
    isScanning: boolean;
    lastScanStartedAt: string | null;
    lastScanFinishedAt: string | null;
    lastScanError: string | null;
  }>('/scan-status');

// Curated
export const curatedApi = {
  getAll: (
    period: 'today' | 'week' = 'today',
    limit = 20,
    offset = 0,
    opts: { category?: string; region?: string; search?: string; source?: string } = {},
  ) => {
    const params = new URLSearchParams({ period, limit: String(limit), offset: String(offset) });
    if (opts.category) params.set('category', opts.category);
    if (opts.region) params.set('region', opts.region);
    if (opts.search) params.set('search', opts.search);
    if (opts.source) params.set('source', opts.source);
    return request<CuratedResponse>(`/curated?${params}`);
  },
};

// Digest
export const digestApi = {
  // Nest serializes an absent digest as a successful empty response.
  getByDate: (date: string) =>
    requestJson<DigestRecord | null>(`/api/digest/${date}`, {}, true),
  generate: async (date?: string) => {
    const ticket = await request<AiTicket & { message: string }>(`/digest/generate${date ? `?date=${date}` : ''}`, { method: 'POST' });
    if (ticket.taskId) await waitForAiTask(ticket);
    return ticket;
  },
};

// Entities (My Follows knowledge cards)
export interface NewsItem {
  id: string;
  title: string;
  originalTitle?: string;
  titleGenerated?: boolean;
  originalSummary?: string;
  displaySummary?: string | null;
  url: string;
  source: string;
  originalPublisher?: string | null;
  createdAt: string;
  publishedAt?: string;
  summary: string | null;
  importance?: 'low' | 'medium' | 'high' | 'urgent';
  qualityScore?: number;
}

export interface TrendPoint {
  date: string;
  count: number;
}

export interface EntityRelationItem {
  id: string;
  fromName: string;
  toName: string;
  relation: string;
}

export interface RelatedData {
  version?: number;
  relatedCountries?: string[];
  relatedOrganizations?: string[];
  relatedPeople?: string[];
  generationStatus?: string;
  type: string;
  summary: string;
  relatedCompanies: string[];
  relatedModels: string[];
  relatedProducts: string[];
  competesWith: string[];
  aliases: string[];
  tags: string[];
}

export interface EntityCardSummary {
  id: string;
  keywordId: string;
  name: string;
  type: string | null;
  summary: string | null;
  relatedData: string | null; // JSON string
  lastRefresh: string;
  createdAt: string;
  keyword: { id: string; text: string; isActive: boolean };
  todayMentions: number;
  latestNews: NewsItem[];
}

export interface EntityCardDetail extends EntityCardSummary {
  trend: TrendPoint[];
  relations: EntityRelationItem[];
}

export const entitiesApi = {
  getAll: () => request<EntityCardSummary[]>('/entities'),
  getOne: (id: string) => request<EntityCardDetail>(`/entities/${id}`),
  refresh: async (id: string) => {
    const result = await request<EntityCardSummary | AiTicket>(`/entities/${id}/refresh`, { method: 'POST' });
    if ('taskId' in result) { await waitForAiTask(result); return request<EntityCardSummary>(`/entities/${id}`); }
    return result;
  },
  getNewsForName: (name: string, limit = 6) =>
    request<NewsItem[]>(`/entities/news?name=${encodeURIComponent(name)}&limit=${limit}`),
};
