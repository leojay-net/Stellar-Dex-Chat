import Skeleton from './Skeleton';

export default function SkeletonWallet() {
  return (
    <div className="space-y-3 py-4" data-testid="skeleton-wallet">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-1">
          <Skeleton className="h-9 w-9 rounded-lg flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
