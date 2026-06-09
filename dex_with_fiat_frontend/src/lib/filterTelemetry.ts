'use client';

import { TELEMETRY_SCHEMA_VERSION, getTelemetryConsent, ChatEvent } from './chatTelemetry';

export type FilterEventName =
  | 'filter_toggle'
  | 'filter_clear_all'
  | 'filter_cycle'
  | 'filter_shortcut';

export interface FilterTogglePayload {
  category: string;
  value: string;
  enabled: boolean;
}

export interface FilterCyclePayload {
  category: string;
  nextValue?: string;
  isCleared: boolean;
}

export interface FilterShortcutPayload {
  key: string;
  action: string;
}

/**
 * Emit a filter-related telemetry event.
 * Reuses the 'chat:telemetry' event name for centralized collection,
 * but uses distinct names for filtering actions.
 */
function emit<P extends object>(
  name: FilterEventName,
  payload: P,
): void {
  try {
    if (!getTelemetryConsent()) return;

    const event: ChatEvent = {
        // We cast name as ChatEventName to satisfy the ChatEvent type if needed,
        // or we could define a more generic TelemetryEvent type.
        // For now, let's keep it compatible with existing listeners.
      name: name as unknown as ChatEvent['name'], 
      version: TELEMETRY_SCHEMA_VERSION,
      timestamp: Date.now(),
      payload: payload as Record<string, unknown>,
    };

    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        try {
          window.dispatchEvent(
            new CustomEvent('chat:telemetry', { detail: event }),
          );
        } catch {
          // ignore
        }
      });
    }
  } catch {
    // ignore
  }
}

export const filterTelemetry = {
  toggle(payload: FilterTogglePayload): void {
    emit('filter_toggle', payload);
  },

  clearAll(): void {
    emit('filter_clear_all', {});
  },

  cycle(payload: FilterCyclePayload): void {
    emit('filter_cycle', payload);
  },

  shortcut(payload: FilterShortcutPayload): void {
    emit('filter_shortcut', payload);
  },
};
