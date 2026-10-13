export interface FilterRule {
  id: string;
  enabled: boolean;
  sourceId: string;
  field: 'titleExact' | 'titleContains' | 'textContains' | 'urlPrefix' | 'urlExact';
  value: string;
}
export interface FilterItem { title: string; summary: string; url: string; originalUrl?: string | null }

// Defaults are editable in the admin page; no headline-length or keyword guessing.
export const DEFAULT_EXCLUSIONS: FilterRule[] = [
  { id: 'ap-home-title', enabled: true, sourceId: '', field: 'titleExact', value: 'Associated Press News: Breaking News | Latest News Today - AP News' },
  { id: 'ap-home-short-title', enabled: true, sourceId: '', field: 'titleExact', value: 'AP News' },
  ...['Beijing', 'China', 'Hong Kong', 'Taiwan', 'Xinjiang', 'Tibet', 'Shanghai'].map(label => ({
    id: `ap-${label.toLowerCase().replaceAll(' ', '-')}`, enabled: true, sourceId: '', field: 'titleExact' as const, value: `${label} - AP News`,
  })),
  { id: 'ap-hub', enabled: true, sourceId: '', field: 'urlPrefix', value: 'https://apnews.com/hub/' },
  { id: 'ap-home-url', enabled: true, sourceId: '', field: 'urlExact', value: 'https://apnews.com/' },
  { id: 'guardian-china', enabled: true, sourceId: '', field: 'urlExact', value: 'https://www.theguardian.com/world/china' },
];
const normalized = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
function comparableUrl(raw: string) {
  try { const url = new URL(raw); return `${url.hostname.toLowerCase().replace(/^www\./, '')}${decodeURI(url.pathname).replace(/\/$/, '')}`; }
  catch { return ''; }
}
export function matchingExclusions(item: FilterItem, rules: FilterRule[] = DEFAULT_EXCLUSIONS, sourceId = ''): FilterRule[] {
  return rules.filter(rule => {
    if (!rule.enabled || (rule.sourceId && rule.sourceId !== sourceId)) return false;
    const value = normalized(rule.value);
    if (rule.field === 'titleExact') return normalized(item.title) === value;
    if (rule.field === 'titleContains') return normalized(item.title).includes(value);
    if (rule.field === 'textContains') return normalized(`${item.title} ${item.summary}`).includes(value);
    const expected = comparableUrl(rule.value);
    if (!expected) return false;
    return [item.originalUrl, item.url].filter(Boolean).some(raw => {
      const actual = comparableUrl(raw!);
      // Match a path boundary, never a spoofed host or an article with a similar slug.
      return actual === expected || (rule.field === 'urlPrefix' && actual.startsWith(`${expected}/`));
    });
  });
}
export function isCollectionPage(item: FilterItem) { return matchingExclusions(item).length > 0; }
