import { Skeleton, SkeletonList } from '@/components/common/Loader';

export default function HotspotLoading() {
  return (
    <div data-route-loading className="mx-auto w-full max-w-[1280px] px-4 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-72 rounded-xl" />
      </div>
      <SkeletonList count={5} itemClassName="h-40" />
    </div>
  );
}
