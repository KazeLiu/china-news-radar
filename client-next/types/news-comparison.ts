export type EvidenceField = 'title' | 'summary' | 'body';

export interface ComparisonArticle {
  id: string;
  publisher: string;
  title: string | null;
  publishedAt: string | null;
  url: string | null;
  sourceLinks: string[];
  hasBody: boolean;
  hasSummary: boolean;
  bodyTruncated: boolean;
}

export interface ComparisonClaim {
  text: string;
  entities: { name: string; evidence: number }[];
  evidence: { articleId: string; field: EvidenceField; quote: string; speaker: string | null; stance: 'states' | 'attributes' | 'qualifies' | 'denies' }[];
  differences: { kind: 'scope' | 'wording' | 'attribution' | 'timing' | 'numbers' | 'emphasis'; text: string; left: number; right: number; leftPhrase: string; rightPhrase: string }[];
}

export interface Comparison {
  id: string;
  title: string;
  updatedAt: string;
  articles: ComparisonArticle[];
  claims: ComparisonClaim[];
  citations: { from: string; to: string; kind: 'cites' | 'reprints'; field: EvidenceField; quote: string }[];
  recordedLinks: { from: string; to: string; shared: boolean }[];
}

export interface ComparisonResponse {
  events: { id: string; title: string; updatedAt: string; _count: { articles: number } }[];
  status: 'ready' | 'stale' | 'missing';
  comparison: Comparison | null;
}
