import { Skeleton, SkeletonList } from '@/components/common/Loader';

export default function DigestLoading() {
  return (
    <div data-route-loading className="flex h-full overflow-hidden">
      <div className="hidden lg:flex w-[220px] shrink-0 flex-col border-r border-[var(--border-subtle)] overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-[var(--border-subtle)] shrink-0">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="mt-1.5 h-3 w-32" />
        </div>
        <div className="flex-1 space-y-2 p-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6 space-y-4">
          <Skeleton className="h-12" />
          <SkeletonList count={3} itemClassName="h-36" />
          <Skeleton className="h-24" />
        </div>
      </div>
    </div>
  );
}
