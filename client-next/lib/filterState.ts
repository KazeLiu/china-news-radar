/** Filter & sort state shared between FilterSortBar and its consumers. */

export interface FilterState {
  source: string;
  importance: string;
  keywordId: string;
  timeRange: string;
  isReal: string;
  sortBy: string;
  sortOrder: string;
}

export const defaultFilterState: FilterState = {
  source: '',
  importance: '',
  keywordId: '',
  timeRange: '',
  isReal: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
};

export function tabFilter(tab: string): { category?: string; region?: string } {
  if (tab === 'all') return {};
  if (tab === 'domestic' || tab === 'international') return { region: tab };
  return { category: tab };
}
