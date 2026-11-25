import type { AnalysisText } from './analysis';

const KINDS = ['person', 'organization', 'company', 'place', 'policy'] as const;
const FIELDS = ['title', 'summary', 'body'] as const;
type EntityKind = typeof KINDS[number];
type Field = typeof FIELDS[number];
export type EntityExcerpt = { field: Field; excerpt: string };
export type EntityMention = EntityExcerpt & { name: string; kind: EntityKind; surface: string };
export type EntityRelation = EntityExcerpt & { from: number; to: number; label: string };
export type EntityEvidence = { mentions: EntityMention[]; relations: EntityRelation[] };

export function entityKey(mention: EntityMention) {
  return `${mention.kind}:${mention.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function shortText(value: unknown, max: number) {
  return typeof value === 'string' && value.length <= max ? value.trim() : '';
}
function readExcerpt(value: Record<string, unknown>, input: AnalysisText): EntityExcerpt | undefined {
  const field = FIELDS.find(field => field === value.field);
  const excerpt = shortText(value.excerpt, 120);
  if (field && excerpt && !(field === 'title' && input.sourceTitlePresent === false) && input[field]?.includes(excerpt)) return { field, excerpt };
}

export function parseEntityEvidence(value: unknown, input: AnalysisText): EntityEvidence | undefined {
  if (!isObject(value) || !Array.isArray(value.mentions)) return;
  const mentions: EntityMention[] = [];
  const indexes = new Map<number, number>();
  const unique = new Map<string, number>();
  for (const [index, candidate] of value.mentions.slice(0, 5).entries()) {
    if (!isObject(candidate)) continue;
    const evidence = readExcerpt(candidate, input);
    const kind = KINDS.find(kind => kind === candidate.kind);
    const name = shortText(candidate.name, 80);
    const surface = shortText(candidate.surface, 80);
    if (!kind || !name || !surface || !evidence?.excerpt.includes(surface)) continue;
    const mention = { ...evidence, kind, name, surface };
    const key = entityKey(mention);
    const existing = unique.get(key);
    if (existing !== undefined) {
      indexes.set(index, existing);
      continue;
    }
    indexes.set(index, mentions.length);
    unique.set(key, mentions.length);
    mentions.push(mention);
  }
  if (value.mentions.length && !mentions.length) return;
  const relations: EntityRelation[] = [];
  if (Array.isArray(value.relations)) for (const candidate of value.relations.slice(0, 2)) {
    if (!isObject(candidate) || typeof candidate.from !== 'number' || typeof candidate.to !== 'number') continue;
    const from = indexes.get(candidate.from);
    const to = indexes.get(candidate.to);
    const label = shortText(candidate.label, 24);
    const evidence = readExcerpt(candidate, input);
    if (from === undefined || to === undefined || from === to || !label || !evidence
      || !evidence.excerpt.includes(mentions[from].surface) || !evidence.excerpt.includes(mentions[to].surface)) continue;
    relations.push({ from, to, label, ...evidence });
  }
  return { mentions, relations };
}
