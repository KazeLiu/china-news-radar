'use client';

import { BilingualText } from '@/components/common/BilingualText';
import { AiTitleBadge } from '@/components/common/AiTitleBadge';
import { getNewsText, type NewsText } from '@/lib/newsText';
import { useReadingPreference } from '@/providers/ReadingPreference';

export function ArticleText(item: NewsText) {
  const { translationFirst } = useReadingPreference();
  const text = getNewsText(item, translationFirst);
  return <>
    <h1 className="text-3xl font-semibold leading-snug mb-6 break-words"><BilingualText text={text.title}><AiTitleBadge generated={item.titleGenerated} /></BilingualText></h1>
    {text.summary.primary && <p className="text-lg leading-relaxed mb-8 whitespace-pre-wrap break-words"><BilingualText text={text.summary} /></p>}
  </>;
}
