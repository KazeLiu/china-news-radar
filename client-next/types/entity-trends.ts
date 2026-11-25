export type EntityPeriod = 'day' | 'week' | 'month';
export type EntityKind = 'person' | 'organization' | 'company' | 'place' | 'policy';
export type EntityExcerpt = { field: 'title' | 'summary' | 'body'; excerpt: string };
export type EntityReport = { id: string; title: string; publisher: string; date: string; originalUrl: string | null };
export type EntitySample = {
  report: EntityReport;
  excerpts: EntityExcerpt[];
  statements?: (EntityExcerpt & { from: string; to: string; label: string })[];
};
export type TrendNode = { id: string; name: string; kind: EntityKind; count: number; samples: EntitySample[] };
export type TrendEdge = { id: string; from: string; to: string; count: number; explicitCount: number; samples: EntitySample[] };
export type EntityTrends = {
  period: EntityPeriod;
  firstDay: string;
  lastDay: string;
  articleRequested: boolean;
  article: (EntityReport & { analyzed: boolean; mentions: (EntityExcerpt & { id: string; name: string })[] }) | null;
  coverage: { analyzed: number; total: number };
  nodes: TrendNode[];
  edges: TrendEdge[];
};
