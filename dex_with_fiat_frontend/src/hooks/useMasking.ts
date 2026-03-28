/**
 * Hook for applying text masking based on user preferences
 */

import { SensitiveTermsManager } from '@/lib/sensitiveTerms';
import { MaskingStyle, maskText } from '@/lib/textMasking';
import { useMemo } from 'react';

export interface UseMaskingOptions {
  enabled: boolean;
  style?: MaskingStyle;
  customTerms?: typeof SensitiveTermsManager;
}

/**
 * Hook to mask sensitive terms in text based on user preferences
 */
export const useMasking = (
  text: string,
  { enabled, style = 'asterisk', customTerms }: UseMaskingOptions,
) => {
  // Create or use provided manager
  const manager = useMemo(() => {
    if (customTerms instanceof SensitiveTermsManager) {
      return customTerms;
    }
    return new SensitiveTermsManager();
  }, [customTerms]);

  // Apply masking only if enabled
  const maskedText = useMemo(() => {
    if (!enabled) {
      return text;
    }
    return maskText(text, manager, style);
  }, [text, enabled, style, manager]);

  return maskedText;
};

export default useMasking;
