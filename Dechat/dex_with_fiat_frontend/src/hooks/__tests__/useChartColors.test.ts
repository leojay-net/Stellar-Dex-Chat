import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChartColors } from '../useChartColors';

const TOKENS = [
  '--color-chart-primary',
  '--color-chart-text',
  '--color-chart-grid',
  '--color-chart-background',
];

function clearTokens() {
  TOKENS.forEach((token) =>
    document.documentElement.style.removeProperty(token),
  );
  document.documentElement.removeAttribute('data-theme');
}

describe('useChartColors (admin chart border colour)', () => {
  afterEach(clearTokens);

  // Regression: when CSS tokens have not been applied yet, getPropertyValue
  // returns '' and the grid stroke / tooltip border fell back to the browser
  // default colour. The hook must keep the var(...) reference instead.
  it('keeps var() fallbacks when CSS tokens resolve to empty strings', async () => {
    const { result } = renderHook(() => useChartColors());

    await waitFor(() => {
      expect(result.current.border).toBe('var(--color-chart-grid)');
    });
    expect(result.current.surfaceBorder).toBe('var(--color-chart-grid)');
    expect(result.current.primary).toBe('var(--color-chart-primary)');
    expect(result.current.textMuted).toBe('var(--color-chart-text)');
    expect(result.current.surface).toBe('var(--color-chart-background)');
    Object.values(result.current).forEach((value) => {
      expect(value).not.toBe('');
    });
  });

  it('uses resolved token values when they are available', async () => {
    document.documentElement.style.setProperty('--color-chart-grid', '#d6deea');

    const { result } = renderHook(() => useChartColors());

    await waitFor(() => {
      expect(result.current.border).toBe('#d6deea');
    });
    expect(result.current.surfaceBorder).toBe('#d6deea');
  });

  it('re-resolves border colour when data-theme changes', async () => {
    document.documentElement.style.setProperty('--color-chart-grid', '#d6deea');
    const { result } = renderHook(() => useChartColors());
    await waitFor(() => expect(result.current.border).toBe('#d6deea'));

    await act(async () => {
      document.documentElement.style.setProperty(
        '--color-chart-grid',
        '#243244',
      );
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    await waitFor(() => expect(result.current.border).toBe('#243244'));
    expect(result.current.surfaceBorder).toBe('#243244');
  });
});
