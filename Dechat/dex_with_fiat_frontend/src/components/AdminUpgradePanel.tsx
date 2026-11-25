'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  computeLedgerCountdown,
  formatDurationSeconds,
  getContractVersion,
  getLatestLedgerSequence,
  getUpgradeProposal,
  getUpgradeProposalTiming,
  LEDGER_CLOSE_TIME_SECONDS,
  UpgradeProposalInfo,
  UpgradeProposalTimingInfo,
} from '@/lib/stellarContract';
import CopyButton from '@/components/ui/CopyButton';

const REFRESH_INTERVAL_MS = 15_000;
const TICK_INTERVAL_MS = 1_000;

interface PanelState {
  loading: boolean;
  error: string | null;
  contractVersion: number | null;
  proposal: UpgradeProposalInfo | null;
  timing: UpgradeProposalTimingInfo | null;
  /** Ledger sequence at `ledgerFetchedAt`, used to extrapolate the countdown. */
  ledgerSequence: number | null;
  ledgerFetchedAt: number | null;
  now: number;
}

const INITIAL_STATE: PanelState = {
  loading: true,
  error: null,
  contractVersion: null,
  proposal: null,
  timing: null,
  ledgerSequence: null,
  ledgerFetchedAt: null,
  now: Date.now(),
};

function formatLedger(n: number | null): string {
  return n === null ? '---' : n.toLocaleString();
}

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

export default function AdminUpgradePanel() {
  const [state, setState] = useState<PanelState>(INITIAL_STATE);

  const fetchData = useCallback(async () => {
    try {
      const [contractVersion, proposal, timing, ledgerSequence] =
        await Promise.all([
          getContractVersion(),
          getUpgradeProposal(),
          getUpgradeProposalTiming(),
          getLatestLedgerSequence(),
        ]);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: null,
        contractVersion,
        proposal,
        timing,
        ledgerSequence,
        ledgerFetchedAt: Date.now(),
        now: Date.now(),
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to load upgrade proposal data',
      }));
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const refresh = setInterval(() => void fetchData(), REFRESH_INTERVAL_MS);
    const tick = setInterval(
      () => setState((prev) => ({ ...prev, now: Date.now() })),
      TICK_INTERVAL_MS,
    );
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [fetchData]);

  // Extrapolate the current ledger from the last fetched sequence so the
  // countdown ticks smoothly between RPC polls.
  const estimatedLedger =
    state.ledgerSequence !== null && state.ledgerFetchedAt !== null
      ? state.ledgerSequence +
        Math.floor(
          (state.now - state.ledgerFetchedAt) / (LEDGER_CLOSE_TIME_SECONDS * 1000),
        )
      : null;

  const executableAfter =
    state.proposal?.executableAfterLedger ??
    state.timing?.executableAfterLedger ??
    null;
  const countdown =
    executableAfter !== null && estimatedLedger !== null
      ? computeLedgerCountdown(executableAfter, estimatedLedger)
      : null;
  const wasmHash = state.proposal?.wasmHash ?? state.timing?.wasmHash ?? null;

  return (
    <section
      className="theme-surface rounded-lg shadow p-6"
      aria-labelledby="upgrade-proposal-heading"
    >
      <div className="flex items-center justify-between mb-4">
        <h2
          id="upgrade-proposal-heading"
          className="text-lg font-semibold theme-text-primary"
        >
          Contract Upgrade
        </h2>
        {state.proposal && (
          <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold theme-soft-warning">
            Proposal pending
          </span>
        )}
      </div>

      {state.loading ? (
        <p className="text-sm theme-text-muted" role="status">
          Loading upgrade status…
        </p>
      ) : state.error ? (
        <p className="text-sm theme-text-muted" role="alert">
          Upgrade status unavailable: {state.error}
        </p>
      ) : (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="theme-text-secondary">Contract version</dt>
            <dd className="theme-text-primary font-medium">
              {state.contractVersion ?? '---'}
            </dd>
          </div>

          {state.proposal ? (
            <>
              <div>
                <dt className="theme-text-secondary">
                  Executable after ledger
                </dt>
                <dd className="theme-text-primary font-medium">
                  {formatLedger(executableAfter)}
                </dd>
              </div>
              <div>
                <dt className="theme-text-secondary">New version</dt>
                <dd className="theme-text-primary font-medium">
                  {state.proposal.newVersion}
                </dd>
              </div>
              <div>
                <dt className="theme-text-secondary">Timelock countdown</dt>
                <dd
                  className="theme-text-primary font-medium"
                  aria-live="polite"
                >
                  {countdown === null
                    ? '---'
                    : countdown.executable
                      ? 'Executable now'
                      : `~${formatDurationSeconds(countdown.remainingSeconds)} (${countdown.remainingLedgers.toLocaleString()} ledgers)`}
                </dd>
              </div>
              <div>
                <dt className="theme-text-secondary">WASM hash</dt>
                <dd className="theme-text-primary font-mono">
                  <span className="inline-flex items-center gap-1.5">
                    <span title={wasmHash ?? undefined}>
                      {wasmHash ? truncateHash(wasmHash) : '---'}
                    </span>
                    {wasmHash && (
                      <CopyButton
                        value={wasmHash}
                        ariaLabel="Copy WASM hash"
                      />
                    )}
                  </span>
                </dd>
              </div>
              {state.timing && (
                <div className="sm:col-span-2">
                  <dt className="theme-text-secondary">Proposal timing</dt>
                  <dd className="theme-text-primary">
                    Proposed at ledger {formatLedger(state.timing.proposedAtLedger)}
                    {' · '}delay {formatLedger(state.timing.delayLedgers)} ledgers
                  </dd>
                </div>
              )}
            </>
          ) : (
            <div className="sm:col-span-2">
              <dt className="theme-text-secondary">Pending proposal</dt>
              <dd className="theme-text-primary">
                No upgrade proposal is currently pending.
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
