'use client';

interface WalletConnectionTimelineProps {
  isConnected: boolean;
  isNetworkMismatch: boolean;
  isConnecting: boolean;
  contextMode?: 'simple' | 'advanced';
  onRetry?: () => void;
}

type TimelineStep = {
  id: string;
  label: string;
  status: 'done' | 'active' | 'pending' | 'error';
};

export default function WalletConnectionTimeline({
  isConnected,
  isNetworkMismatch,
  isConnecting,
  contextMode = 'simple',
  onRetry,
}: WalletConnectionTimelineProps) {
  const steps: TimelineStep[] = [
    {
      id: 'connect',
      label: 'Connect wallet',
      status: isConnected ? 'done' : isConnecting ? 'active' : 'pending',
    },
    {
      id: 'sign',
      label: 'Sign session',
      status: isConnected ? 'done' : isConnecting ? 'active' : 'pending',
    },
    {
      id: 'verify',
      label: 'Verify network',
      status: isConnected && isNetworkMismatch ? 'error' : isConnected ? 'done' : 'pending',
    },
    {
      id: 'ready',
      label: 'Ready',
      status: isConnected && !isNetworkMismatch ? 'done' : 'pending',
    },
  ];

  const visibleSteps = contextMode === 'advanced' ? steps : steps.slice(0, 3);

  return (
    <div className="theme-surface-muted theme-border mt-2 rounded-xl border px-3 py-2">
      <div className="theme-text-muted mb-2 text-[10px] font-bold uppercase tracking-widest">
        Wallet connection timeline
      </div>
      <ol className="space-y-2" aria-label="Wallet connection timeline">
        {visibleSteps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-xs">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                step.status === 'done'
                  ? 'bg-green-500'
                  : step.status === 'active'
                    ? 'bg-blue-500 animate-pulse'
                    : step.status === 'error'
                      ? 'bg-red-500'
                      : 'bg-gray-500'
              }`}
            />
            <span className="theme-text-secondary">{step.label}</span>
          </li>
        ))}
      </ol>
      {isNetworkMismatch && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 w-full rounded-lg border border-red-500/40 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40"
        >
          Retry wallet connection
        </button>
      )}
    </div>
  );
}
