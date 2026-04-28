# Fuzz Test Boundary Guide

This guide explains the boundary assumptions used by fuzz/property-style tests in this repository.

## Why boundaries matter

Most arithmetic and state-machine fuzz tests are only meaningful when generated inputs stay in the
same domain as production calls. The goal is not "all possible i128 values", but "all realistic
values plus edge-adjacent values that can reveal overflow or state bugs."

## Contract arithmetic boundaries

For fixed-point math in `stellar-contracts/src/math.rs`:

- `FIXED_POINT = 10_000_000`
- Primary risk boundary: intermediate `a * b` before division.
- Safe operational envelope should keep `a * b` well below `i128::MAX`.
- Include targeted edge probes near:
  - `0`
  - `1`
  - `FIXED_POINT`
  - `i128::MAX / FIXED_POINT` (overflow-adjacent upper edge)

## State-machine boundaries

For chat lifecycle logic in `dex_with_fiat_frontend/src/hooks/chatStateMachine.ts`:

- message threshold edges (`2 -> 3` messages) are critical
- cancellation and error recovery transitions should be sampled from all non-terminal states
- transaction-trigger guards should be fuzzed with sparse transaction payloads
  (token only, amount only, fiat only) to verify minimum-data semantics

## Minimal checklist for new fuzz tests

- Document the accepted input range in a docstring or test comment.
- Add at least one "just below / at / just above" boundary assertion.
- Keep generated data deterministic with a seed when possible.
- Record expected failure mode (panic, explicit error, rejected transition).
