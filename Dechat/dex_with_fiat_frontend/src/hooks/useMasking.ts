/**
 * Hook for applying text masking based on user preferences
 */

import { SensitiveTermsManager } from '@/lib/sensitiveTerms';
import { MaskingStyle, maskText } from '@/lib/textMasking';
import { useEffect, useMemo, useState } from 'react';

export interface UseMaskingOptions {
  enabled: boolean;
  style?: MaskingStyle;
  customTerms?: SensitiveTermsManager;
}

/**
 * Storage key another part of the app (e.g. a compliance/settings screen
 * that lets a user edit their sensitive-terms list) writes to when the
 * masking configuration changes, so every open tab/component can refresh.
 */
export const SENSITIVE_TERMS_UPDATED_KEY = 'stellar_sensitive_terms_updated';

/**
 * Hook to mask sensitive terms in text based on user preferences.
 *
 * Root cause (#1222): every mounted instance of this hook needs to know
 * when the sensitive-terms configuration changes elsewhere (another tab, a
 * settings panel) so its memoized `manager`/`maskedText` can refresh. That
 * requires listening for a `storage` event on `window`. Wiring that up
 * without an unsubscribe path leaks one `storage` listener per mount - in a
 * chat view that can render dozens of `<Message>` components, and where
 * sessions/messages re-mount frequently, the listener count grows without
 * bound and each stale listener keeps a reference to that render's closure
 * alive, preventing it (and everything it captured) from being
 * garbage-collected.
 *
 * Fixed by registering the listener inside a `useEffect` with a cleanup
 * function that calls `removeEventListener` on unmount/re-subscribe, the
 * same pattern used elsewhere in this codebase (see `addToastRef` cleanup
 * in `usePaystackWebhookStatus`).
 */
export const useMasking = (
  text: string,
  { enabled, style = 'asterisk', customTerms }: UseMaskingOptions,
) => {
  // Bumped whenever we're told (via a `storage` event) that the
  // sensitive-terms configuration changed elsewhere, forcing the memoized
  // manager below to rebuild.
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === SENSITIVE_TERMS_UPDATED_KEY) {
        setRefreshToken((prev) => prev + 1);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Cleanup: without this, every mount of a component using `useMasking`
    // (e.g. one per chat message) leaves a dangling `storage` listener
    // behind on unmount, leaking memory for the lifetime of the page.
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Create or use provided manager
  const manager = useMemo(() => {
    if (customTerms instanceof SensitiveTermsManager) {
      return customTerms;
    }
    return new SensitiveTermsManager();
    // `refreshToken` intentionally triggers a rebuild when the sensitive
    // terms configuration changes elsewhere; it does not affect the value
    // itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customTerms, refreshToken]);

  // Apply masking only if enabled
  const maskedText = useMemo(() => {
    if (!enabled) {
      return text;
    }
    try {
      return maskText(text, manager, style);
    } catch (error) {
      // Fail safe rather than silently: log so the failure is visible to
      // whoever is watching the console/error monitoring, and fall back to
      // the original text instead of throwing and breaking the chat view.
      console.error('useMasking: failed to mask sensitive text', error);
      return text;
    }
  }, [text, enabled, style, manager]);

  return maskedText;
};

export default useMasking;
