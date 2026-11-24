'use client';

import { useEffect, useState } from 'react';

export interface ChartColors {
  primary: string;
  textMuted: string;
  border: string;
  surface: string;
  surfaceBorder: string;
}

const CHART_TOKENS: Record<keyof ChartColors, string> = {
  primary: '--color-chart-primary',
  textMuted: '--color-chart-text',
  border: '--color-chart-grid',
  surface: '--color-chart-background',
  surfaceBorder: '--color-chart-grid',
};

function fallbackColors(): ChartColors {
  return {
    primary: `var(${CHART_TOKENS.primary})`,
    textMuted: `var(${CHART_TOKENS.textMuted})`,
    border: `var(${CHART_TOKENS.border})`,
    surface: `var(${CHART_TOKENS.surface})`,
    surfaceBorder: `var(${CHART_TOKENS.surfaceBorder})`,
  };
}

/**
 * Theme-aware colours for Recharts, read from CSS custom properties (#452).
 * All values come exclusively from CSS variables — no raw hex values.
 *
 * Border colour fix: `getPropertyValue` returns an empty string when the
 * token is not yet applied (e.g. the stylesheet has not finished loading at
 * hydration). Previously that empty string replaced the `var(...)` fallback,
 * leaving the chart grid stroke and tooltip border on the browser default
 * colour until the next theme toggle. Empty values now keep the `var(...)`
 * reference so the border always tracks the design-system token.
 */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(fallbackColors);

  useEffect(() => {
    const updateColors = () => {
      const computedStyle = getComputedStyle(document.documentElement);
      const fallback = fallbackColors();
      const resolved = { ...fallback };
      (Object.keys(CHART_TOKENS) as (keyof ChartColors)[]).forEach((key) => {
        const value = computedStyle.getPropertyValue(CHART_TOKENS[key]).trim();
        resolved[key] = value || fallback[key];
      });
      setColors(resolved);
    };

    updateColors();

    const observer = new MutationObserver(updateColors);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  return colors;
}

export default useChartColors;
