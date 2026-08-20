import { Skeleton } from "@/components/ui/skeleton";

interface HelpEditorSkeletonProps {
  variant?: "card" | "page";
}

function HelpEditorSkeleton({ variant = "page" }: HelpEditorSkeletonProps) {
  if (variant === "card") {
    return (
      <div className="min-h-[480px] space-y-4 rounded-xl border border-border bg-card p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-[760px] min-h-[60vh] space-y-5 py-2">
      <Skeleton className="h-10 w-3/4 max-w-md" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[92%]" />
        <Skeleton className="h-4 w-[88%]" />
        <Skeleton className="h-4 w-[70%]" />
      </div>
      <div className="space-y-3 pt-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[85%]" />
        <Skeleton className="h-4 w-[60%]" />
      </div>
    </div>
  );
}

export { HelpEditorSkeleton };
