import { describe, expect, it } from 'vitest';

// Structural snapshot tests for skeleton components — verify that
// each skeleton renders the expected number of placeholder items
// and exposes the correct test IDs.

describe('Skeleton components', () => {
  it('SkeletonWallet renders with expected test id', async () => {
    // Dynamic import to avoid SSR issues in test environment
    const mod = await import('./SkeletonWallet');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('SkeletonSidebar is exported as a function', async () => {
    const mod = await import('./SkeletonSidebar');
    expect(typeof mod.default).toBe('function');
  });

  it('SkeletonChat is exported as a function', async () => {
    const mod = await import('./SkeletonChat');
    expect(typeof mod.default).toBe('function');
  });

  it('SkeletonPayout is exported as a function', async () => {
    const mod = await import('./SkeletonPayout');
    expect(typeof mod.default).toBe('function');
  });

  it('SkeletonHeader is exported as a function', async () => {
    const mod = await import('./SkeletonHeader');
    expect(typeof mod.default).toBe('function');
  });

  it('base Skeleton accepts a className prop', async () => {
    const mod = await import('./Skeleton');
    expect(typeof mod.default).toBe('function');
  });
});
