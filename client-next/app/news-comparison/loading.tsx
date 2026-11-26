import { Skeleton } from '@/components/common/Loader';

export default function NewsComparisonLoading() {
  return <div data-route-loading className="mx-auto max-w-[96rem] px-4 py-6 sm:px-7 lg:py-8">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-11 w-56" />
    </div>
    <Skeleton className="h-48" />
  </div>;
}
