import { Skeleton } from '@/components/common/Loader';

export default function HighFrequencyLoading() {
  return (
    <div data-route-loading className="mx-auto max-w-[1440px] px-4 py-6 sm:px-7 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-56 rounded-xl" />
      </div>
      <div className="mb-5 mt-4 flex flex-wrap gap-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-[420px] rounded-2xl" />
    </div>
  );
}
