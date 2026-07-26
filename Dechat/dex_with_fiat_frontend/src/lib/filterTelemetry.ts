'use client';

/**
 * @file Consent-gated telemetry for the transaction-filter UI.
 *
 * Filter interactions (chips, keyboard cycling, "clear all") are high-frequency
 * and purely presentational, so they are kept out of {@link chatTelemetry}'s
 * `ChatEventName` union rather than widening it. They still ride the same
 * `chat:telemetry` `CustomEvent` channel, which means every existing listener —
 * analytics adapters, debug overlays, the consent banner — picks them up with
 * no extra wiring; listeners that only care about chat events filter on
 * {@link ChatEvent.name}.
 *
 * Nothing here throws and nothing here awaits: emission is fire-and-forget so a
 * broken analytics adapter can never break a filter click. See
 * {@link filterTelemetry} for the public surface.
 */

import { TELEMETRY_SCHEMA_VERSION, getTelemetryConsent, ChatEvent } from './chatTelemetry';

/**
 * Names of the filter events dispatched on the `chat:telemetry` channel.
 *
 * These deliberately do **not** overlap with `ChatEventName`, so a consumer can
 * tell filter traffic apart from chat traffic by name alone.
 *
 * - `filter_toggle` — a single filter value was switched on or off.
 * - `filter_clear_all` — every category was reset at once.
 * - `filter_cycle` — a category was advanced to its next value (or wrapped
 *   round and cleared) via {@link FilterCyclePayload}.
 * - `filter_shortcut` — a keyboard shortcut was used to drive one of the above.
 */
export type FilterEventName =
  | 'filter_toggle'
  | 'filter_clear_all'
  | 'filter_cycle'
  | 'filter_shortcut';

/** Payload for `filter_toggle`, emitted by {@link filterTelemetry.toggle}. */
export interface FilterTogglePayload {
  /** Filter category that was touched, e.g. `'status'`, `'asset'`, `'network'`. */
  category: string;
  /** The individual value within that category, e.g. `'pending'`. */
  value: string;
  /** `true` when the value was just selected, `false` when it was deselected. */
  enabled: boolean;
}

/** Payload for `filter_cycle`, emitted by {@link filterTelemetry.cycle}. */
export interface FilterCyclePayload {
  /** Filter category being cycled. */
  category: string;
  /**
   * Value the category advanced to. Omitted when the cycle wrapped past the
   * last option and cleared the category instead — i.e. whenever
   * {@link FilterCyclePayload.isCleared} is `true`.
   */
  nextValue?: string;
  /** `true` when cycling wrapped around and reset the category to "no filter". */
  isCleared: boolean;
}

/** Payload for `filter_shortcut`, emitted by {@link filterTelemetry.shortcut}. */
export interface FilterShortcutPayload {
  /** The pressed key, lower-cased, without its `Ctrl`/`Cmd`+`Shift` modifiers. */
  key: string;
  /** Logical action the shortcut ran, e.g. `'clear_all'`, `'cycle_status'`. */
  action: string;
}

/**
 * Build a {@link ChatEvent} envelope for a filter action and dispatch it on the
 * shared `chat:telemetry` window channel.
 *
 * Reuses the `'chat:telemetry'` event name for centralized collection but keeps
 * distinct {@link FilterEventName}s for filtering actions, so a single listener
 * can serve both without the two event families colliding.
 *
 * Three guards make this safe to call from any render path:
 * 1. **Consent** — returns immediately when {@link getTelemetryConsent} is
 *    `false`, so nothing leaves the page without opt-in.
 * 2. **SSR** — skips dispatch entirely when `window` is undefined, so calling
 *    this during server rendering is a no-op rather than a crash.
 * 3. **Deferred dispatch** — the actual `dispatchEvent` runs inside
 *    `requestAnimationFrame`, keeping listener work off the click handler's
 *    critical path (mirrors the same fix in `chatTelemetry`'s emitter).
 *
 * @typeParam P - Shape of the event-specific payload.
 * @param name - Which filter event to emit.
 * @param payload - Event-specific data; widened to `Record<string, unknown>`
 *   inside the envelope.
 * @returns Nothing. Emission is fire-and-forget and completes asynchronously on
 *   the next animation frame, so a caller cannot observe whether any listener
 *   ran.
 * @throws Never. Both the consent/envelope step and the deferred dispatch are
 *   wrapped in `try/catch`; a throwing listener, a blocked `localStorage`, or a
 *   `CustomEvent` constructor failure are all swallowed on purpose so telemetry
 *   can never break the filter UI. The trade-off is that delivery failures are
 *   silent — do not use this channel for anything the app depends on.
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

/**
 * Public entry point for recording transaction-filter interactions.
 *
 * Each method is a thin, named wrapper over {@link emit}: call the one that
 * matches the user's intent and pass the matching payload. Every method is
 * synchronous, returns `void`, never throws, and silently no-ops without
 * telemetry consent — so call sites need no guards of their own.
 *
 * Consumed by `useTransactionFilters`, which calls these alongside the state
 * updates they describe. Chat-side counterparts live in {@link chatTelemetry}.
 *
 * @example
 * ```ts
 * // The user selects the "pending" status chip.
 * filterTelemetry.toggle({ category: 'status', value: 'pending', enabled: true });
 *
 * // Ctrl+Shift+1 advances the status category to its next value.
 * filterTelemetry.cycle({ category: 'status', nextValue: 'completed', isCleared: false });
 * filterTelemetry.shortcut({ key: '1', action: 'cycle_status' });
 *
 * // Cycling past the last option wraps around and clears the category.
 * filterTelemetry.cycle({ category: 'status', isCleared: true });
 *
 * // Ctrl+Shift+X resets every category.
 * filterTelemetry.clearAll();
 * filterTelemetry.shortcut({ key: 'x', action: 'clear_all' });
 * ```
 */
export const filterTelemetry = {
  /**
   * Record that one filter value was switched on or off.
   *
   * @param payload - Category, value, and the resulting on/off state. Pass the
   *   state the filter is moving *to*, not the one it came from.
   */
  toggle(payload: FilterTogglePayload): void {
    emit('filter_toggle', payload);
  },

  /**
   * Record that every filter category was reset in a single action.
   *
   * Carries no payload — the event's existence is the whole signal. Emit it
   * once per bulk reset, not once per cleared category, so "clear all" stays
   * distinguishable from a burst of {@link filterTelemetry.toggle} calls.
   */
  clearAll(): void {
    emit('filter_clear_all', {});
  },

  /**
   * Record that a category was advanced to its next value, or wrapped past the
   * end and cleared.
   *
   * @param payload - The category, the value it landed on, and whether the
   *   cycle wrapped. Omit `nextValue` when `isCleared` is `true`.
   */
  cycle(payload: FilterCyclePayload): void {
    emit('filter_cycle', payload);
  },

  /**
   * Record that a keyboard shortcut drove a filter action.
   *
   * This is additive: shortcuts also emit the event for the action they
   * performed ({@link filterTelemetry.toggle}, {@link filterTelemetry.cycle},
   * or {@link filterTelemetry.clearAll}). Emitting both is what lets keyboard
   * and pointer usage of the same action be compared.
   *
   * @param payload - The key pressed and the logical action it triggered.
   */
  shortcut(payload: FilterShortcutPayload): void {
    emit('filter_shortcut', payload);
  },
};
