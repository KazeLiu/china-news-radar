import Link from 'next/link';
import { Network } from 'lucide-react';

export function NewsComparisonLink({ articleId }: { articleId: string }) {
  return <Link href={`/news-comparison?article=${encodeURIComponent(articleId)}`} prefetch={false}
    className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap text-sm text-[var(--accent-blue)] hover:underline">
    <Network size={15} aria-hidden="true" /> 查看关联
  </Link>;
}
