import Skeleton from "./Skeleton";

export default function SkeletonHeader() {
  return (
    <div className="flex gap-6 p-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
    </div>
  );
}