export interface NewsText {
  title: string;
  summary?: string | null;
  originalTitle?: string;
  titleGenerated?: boolean;
  originalSummary?: string;
  displaySummary?: string | null;
}

export interface TextPair { primary: string; secondary: string }

function comparable(text: string) {
  return text.normalize('NFKC').replace(/[\p{P}\p{S}\s]/gu, '').toLowerCase();
}

function sameText(left: string, right: string) {
  return comparable(left) === comparable(right);
}

function pair(translated: string, original: string, translationFirst: boolean): TextPair {
  const [first, second] = (translationFirst ? [translated, original] : [original, translated]).map(text => text.trim());
  return { primary: first || second, secondary: first && second && !sameText(first, second) ? second : '' };
}

export function getNewsText(item: NewsText, translationFirst: boolean) {
  const originalTitle = item.originalTitle ?? item.title;
  const rawSummary = item.originalSummary ?? item.summary ?? '';
  const originalSummary = sameText(originalTitle, rawSummary) ? '' : rawSummary;
  const translatedSummary = sameText(item.title, item.summary ?? '') ? '' : item.summary ?? '';
  // A title-only RSS description is not a summary. Explicit editorial text still takes precedence.
  const showSummary = item.displaySummary != null ? !!translatedSummary.trim() : !!originalSummary.trim();
  return {
    title: pair(item.title, originalTitle, translationFirst),
    summary: showSummary ? pair(translatedSummary, originalSummary, translationFirst) : { primary: '', secondary: '' },
  };
}
