import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateCTA {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  cta?: EmptyStateCTA;
  className?: string;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  cta,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 p-6 text-center',
        className,
      )}
    >
      <Icon className="theme-text-muted w-9 h-9 opacity-50" />
      <p className="theme-text-primary text-sm font-medium">{title}</p>
      {description && (
        <p className="theme-text-muted text-xs opacity-70">{description}</p>
      )}
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          className="theme-primary-button mt-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-[1.03]"
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}
