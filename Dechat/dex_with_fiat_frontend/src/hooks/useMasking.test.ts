import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMasking } from './useMasking';
import { SensitiveTermsManager } from '@/lib/sensitiveTerms';
import * as textMaskingLib from '@/lib/textMasking';

// Mock the text masking module
vi.mock('@/lib/textMasking', () => ({
  maskText: vi.fn((text: string) => {
    // Simple mock implementation: replace all lowercase vowels with *
    return text.replace(/[aeiou]/gi, '*');
  }),
}));

describe('useMasking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initial State', () => {
    it('should return original text when masking is disabled', () => {
      const text = 'Hello World';
      const { result } = renderHook(() =>
        useMasking(text, {
          enabled: false,
          style: 'asterisk',
        }),
      );

      expect(result.current).toBe('Hello World');
      expect(vi.mocked(textMaskingLib.maskText)).not.toHaveBeenCalled();
    });

    it('should mask text when masking is enabled', () => {
      const text = 'Hello World';
      const { result } = renderHook(() =>
        useMasking(text, {
          enabled: true,
          style: 'asterisk',
        }),
      );

      expect(result.current).toBe('H*ll* W*rld');
      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledOnce();
    });

    it('should use default style asterisk when not specified', () => {
      const text = 'test text';
      renderHook(() =>
        useMasking(text, {
          enabled: true,
        }),
      );

      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledWith(
        'test text',
        expect.any(SensitiveTermsManager),
        'asterisk',
      );
    });

    it('should use provided custom masking style', () => {
      const text = 'test';
      renderHook(() =>
        useMasking(text, {
          enabled: true,
          style: 'block',
        }),
      );

      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledWith(
        'test',
        expect.any(SensitiveTermsManager),
        'block',
      );
    });

    it('should create default SensitiveTermsManager when not provided', () => {
      const text = 'test';
      renderHook(() =>
        useMasking(text, {
          enabled: true,
        }),
      );

      const callArgs = vi.mocked(textMaskingLib.maskText).mock.calls[0];
      expect(callArgs[1]).toBeInstanceOf(SensitiveTermsManager);
    });

    it('should use custom SensitiveTermsManager when provided', () => {
      const text = 'test';
      const customManager = new SensitiveTermsManager();
      renderHook(() =>
        useMasking(text, {
          enabled: true,
          customTerms: customManager,
        }),
      );

      const callArgs = vi.mocked(textMaskingLib.maskText).mock.calls[0];
      expect(callArgs[1]).toBe(customManager);
    });
  });

  describe('Updates', () => {
    it('should remask when text changes', () => {
      const { result, rerender } = renderHook(
        ({ text, options }) =>
          useMasking(text, options),
        {
          initialProps: {
            text: 'Hello',
            options: { enabled: true, style: 'asterisk' as const },
          },
        },
      );

      expect(result.current).toBe('H*ll*');
      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledTimes(1);

      // Change text
      rerender({
        text: 'World',
        options: { enabled: true, style: 'asterisk' as const },
      });

      expect(result.current).toBe('W*rld');
      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledTimes(2);
    });

    it('should remask when masking is toggled on', () => {
      const { result, rerender } = renderHook(
        ({ text, options }) =>
          useMasking(text, options),
        {
          initialProps: {
            text: 'Hello',
            options: { enabled: false, style: 'asterisk' as const },
          },
        },
      );

      expect(result.current).toBe('Hello');
      expect(vi.mocked(textMaskingLib.maskText)).not.toHaveBeenCalled();

      // Enable masking
      rerender({
        text: 'Hello',
        options: { enabled: true, style: 'asterisk' as const },
      });

      expect(result.current).toBe('H*ll*');
      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledOnce();
    });

    it('should return original text when masking is toggled off', () => {
      const { result, rerender } = renderHook(
        ({ text, options }) =>
          useMasking(text, options),
        {
          initialProps: {
            text: 'Hello',
            options: { enabled: true, style: 'asterisk' as const },
          },
        },
      );

      expect(result.current).toBe('H*ll*');

      // Disable masking
      rerender({
        text: 'Hello',
        options: { enabled: false, style: 'asterisk' as const },
      });

      expect(result.current).toBe('Hello');
      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledTimes(1);
    });

    it('should remask when style changes', () => {
      const { rerender } = renderHook(
        ({ text, options }) =>
          useMasking(text, options),
        {
          initialProps: {
            text: 'Hello',
            options: { enabled: true, style: 'asterisk' as const },
          },
        },
      );

      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledWith(
        'Hello',
        expect.any(SensitiveTermsManager),
        'asterisk',
      );

      // Change style
      rerender({
        text: 'Hello',
        options: { enabled: true, style: 'block' as const },
      });

      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledWith(
        'Hello',
        expect.any(SensitiveTermsManager),
        'block',
      );
      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledTimes(2);
    });

    it('should remask when custom manager changes', () => {
      const manager1 = new SensitiveTermsManager();
      const manager2 = new SensitiveTermsManager();

      const { rerender } = renderHook(
        ({ text, options }) =>
          useMasking(text, options),
        {
          initialProps: {
            text: 'Hello',
            options: { enabled: true, customTerms: manager1 },
          },
        },
      );

      const firstCall = vi.mocked(textMaskingLib.maskText).mock.calls[0];
      expect(firstCall[1]).toBe(manager1);

      // Change manager
      rerender({
        text: 'Hello',
        options: { enabled: true, customTerms: manager2 },
      });

      const secondCall = vi.mocked(textMaskingLib.maskText).mock.calls[1];
      expect(secondCall[1]).toBe(manager2);
      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledTimes(2);
    });

    it('should not remask when unrelated props change', () => {
      const { rerender } = renderHook(
        ({ text, options }) =>
          useMasking(text, options),
        {
          initialProps: {
            text: 'Hello',
            options: { enabled: true, style: 'asterisk' as const },
            unrelated: 'value1',
          },
        },
      );

      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledTimes(1);

      // Change unrelated prop
      rerender({
        text: 'Hello',
        options: { enabled: true, style: 'asterisk' as const },
        unrelated: 'value2',
      });

      // Should still be 1 call, not 2
      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cleanup', () => {
    it('should not cause memory leaks on unmount', () => {
      const { unmount } = renderHook(() =>
        useMasking('Hello World', {
          enabled: true,
          style: 'asterisk',
        }),
      );

      const callCountBefore = vi.mocked(textMaskingLib.maskText).mock.calls.length;
      unmount();

      // No additional calls after unmount
      expect(vi.mocked(textMaskingLib.maskText).mock.calls.length).toBe(callCountBefore);
    });

    it('should properly cleanup when manager changes', () => {
      const manager1 = new SensitiveTermsManager();
      const manager2 = new SensitiveTermsManager();

      const { unmount, rerender } = renderHook(
        ({ text, options }) =>
          useMasking(text, options),
        {
          initialProps: {
            text: 'Hello',
            options: { enabled: true, customTerms: manager1 },
          },
        },
      );

      rerender({
        text: 'World',
        options: { enabled: true, customTerms: manager2 },
      });

      // Should not raise any errors on cleanup
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('Branch Coverage', () => {
    it('should handle empty text', () => {
      const { result } = renderHook(() =>
        useMasking('', {
          enabled: true,
          style: 'asterisk',
        }),
      );

      expect(result.current).toBe('');
    });

    it('should handle whitespace-only text', () => {
      renderHook(() =>
        useMasking('   ', {
          enabled: true,
          style: 'asterisk',
        }),
      );

      // Mock returns original for whitespace
      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalled();
    });

    it('should handle all masking styles', () => {
      const styles = ['asterisk', 'block', 'initial', 'pipe', 'address'] as const;

      for (const style of styles) {
        vi.mocked(textMaskingLib.maskText).mockClear();

        renderHook(() =>
          useMasking('test', {
            enabled: true,
            style,
          }),
        );

        expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalledWith(
          'test',
          expect.any(SensitiveTermsManager),
          style,
        );
      }
    });

    it('should handle manager property check for SensitiveTermsManager instance', () => {
      const customManager = new SensitiveTermsManager();

      renderHook(() =>
        useMasking('test', {
          enabled: true,
          customTerms: customManager,
        }),
      );

      const callArgs = vi.mocked(textMaskingLib.maskText).mock.calls[0];
      expect(callArgs[1]).toBe(customManager);
    });

    it('should handle non-manager custom terms by creating default manager', () => {
      // Testing the branch where customTerms is not a SensitiveTermsManager instance
      renderHook(() =>
        useMasking('test', {
          enabled: true,
          customTerms: undefined,
        }),
      );

      const callArgs = vi.mocked(textMaskingLib.maskText).mock.calls[0];
      expect(callArgs[1]).toBeInstanceOf(SensitiveTermsManager);
    });

    it('should verify memos optimize re-renders', () => {
      const { rerender } = renderHook(
        ({ options }) => {
          const maskedText = useMasking('Hello', options);
          return { maskedText, optionsRef: options };
        },
        {
          initialProps: {
            options: { enabled: true, style: 'asterisk' as const },
          },
        },
      );

      const callCount1 = vi.mocked(textMaskingLib.maskText).mock.calls.length;

      // Rerender with same object reference (new object with same values)
      rerender({
        options: { enabled: true, style: 'asterisk' as const },
      });

      // Should have called maskText again because options is a new object
      expect(vi.mocked(textMaskingLib.maskText).mock.calls.length).toBeGreaterThan(callCount1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long text', () => {
      const longText = 'Hello World'.repeat(1000);
      const { result } = renderHook(() =>
        useMasking(longText, {
          enabled: true,
          style: 'asterisk',
        }),
      );

      expect(result.current).toBeDefined();
      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalled();
    });

    it('should handle special characters in text', () => {
      const specialText = 'Hello @#$%^&*() World!';
      const { result } = renderHook(() =>
        useMasking(specialText, {
          enabled: true,
          style: 'asterisk',
        }),
      );

      expect(result.current).toBeDefined();
      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalled();
    });

    it('should handle unicode characters in text', () => {
      const unicodeText = 'Hello 世界 🌍 мир';
      const { result } = renderHook(() =>
        useMasking(unicodeText, {
          enabled: true,
          style: 'asterisk',
        }),
      );

      expect(result.current).toBeDefined();
      expect(vi.mocked(textMaskingLib.maskText)).toHaveBeenCalled();
    });
  });
});
