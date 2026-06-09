<<<<<<< HEAD
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { toastAddMock } = vi.hoisted(() => ({
  toastAddMock: vi.fn(),
}));

vi.mock('./toastStore', () => ({
  toastStore: {
    addToast: toastAddMock,
    dismissToast: vi.fn(),
    clearToasts: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getSnapshot: vi.fn(() => []),
  },
}));

import { AIAssistant, ASSISTANT_ANIMATION_VARIANTS, REDUCED_MOTION_VARIANTS, AnimationVariants, AIAnalysisResult } from './aiAssistant';
import type { ChatMessage } from '@/types';

// ---------- Helpers ----------

function makeMockMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    role: 'user' as const,
    content: `Message ${i + 1}`,
    timestamp: new Date(),
  }));
}

// ---------- Issue #708: Pagination ----------

describe('AIAssistant.paginateMessages', () => {
  it('should return all messages when they fit within one page', () => {
    const messages = makeMockMessages(5);
    const result = AIAssistant.paginateMessages(messages, 1, 10);

    expect(result.items).toHaveLength(5);
    expect(result.currentPage).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.totalItems).toBe(5);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
  });

  it('should paginate correctly across multiple pages', () => {
    const messages = makeMockMessages(25);

    const page1 = AIAssistant.paginateMessages(messages, 1, 10);
    expect(page1.items).toHaveLength(10);
    expect(page1.items[0].id).toBe('1');
    expect(page1.hasNextPage).toBe(true);
    expect(page1.hasPreviousPage).toBe(false);

    const page2 = AIAssistant.paginateMessages(messages, 2, 10);
    expect(page2.items).toHaveLength(10);
    expect(page2.items[0].id).toBe('11');
    expect(page2.hasNextPage).toBe(true);
    expect(page2.hasPreviousPage).toBe(true);

    const page3 = AIAssistant.paginateMessages(messages, 3, 10);
    expect(page3.items).toHaveLength(5);
    expect(page3.items[0].id).toBe('21');
    expect(page3.hasNextPage).toBe(false);
    expect(page3.hasPreviousPage).toBe(true);
    expect(page3.totalPages).toBe(3);
  });

  it('should use default page size when not specified', () => {
    const messages = makeMockMessages(50);
    const result = AIAssistant.paginateMessages(messages);

    expect(result.items).toHaveLength(AIAssistant.DEFAULT_PAGE_SIZE);
    expect(result.currentPage).toBe(1);
  });

  it('should handle empty message array', () => {
    const result = AIAssistant.paginateMessages([], 1, 10);

    expect(result.items).toHaveLength(0);
    expect(result.currentPage).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.totalItems).toBe(0);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
  });

  it('should clamp page number to valid range', () => {
    const messages = makeMockMessages(5);

    // Page beyond total pages
    const beyondResult = AIAssistant.paginateMessages(messages, 100, 10);
    expect(beyondResult.currentPage).toBe(1);
    expect(beyondResult.items).toHaveLength(5);

    // Negative page
    const negativeResult = AIAssistant.paginateMessages(messages, -1, 10);
    expect(negativeResult.currentPage).toBe(1);
    expect(negativeResult.items).toHaveLength(5);

    // Zero page
    const zeroResult = AIAssistant.paginateMessages(messages, 0, 10);
    expect(zeroResult.currentPage).toBe(1);
  });

  it('should handle fractional page numbers by flooring', () => {
    const messages = makeMockMessages(30);
    const result = AIAssistant.paginateMessages(messages, 2.7, 10);
    expect(result.currentPage).toBe(2);
    expect(result.items[0].id).toBe('11');
  });
});

// ---------- Issue #712: AbortSignal support ----------

describe('AIAssistant abort signal support', () => {
  let assistant: AIAssistant;

  beforeEach(() => {
    toastAddMock.mockClear();
    assistant = new AIAssistant();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            intent: 'query',
            confidence: 0.9,
            extractedData: {},
            requiredQuestions: [],
            suggestedResponse: 'Hello!',
          }),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should pass signal to fetch in analyzeUserMessage', async () => {
    const controller = new AbortController();
    await assistant.analyzeUserMessage('hello', undefined, controller.signal);

    expect(fetch).toHaveBeenCalledWith(
      '/api/ai/chat',
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('should re-throw AbortError from analyzeUserMessage without logging', async () => {
    const controller = new AbortController();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    );

    await expect(
      assistant.analyzeUserMessage('hello', undefined, controller.signal),
    ).rejects.toThrow('Aborted');

    // AbortError should NOT be logged
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('should pass signal to fetch in generateFollowUpQuestion', async () => {
    const controller = new AbortController();
    await assistant.generateFollowUpQuestion('query', ['amount'], controller.signal);

    expect(fetch).toHaveBeenCalledWith(
      '/api/ai/chat',
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('should re-throw AbortError from generateFollowUpQuestion without logging', async () => {
    const controller = new AbortController();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    );

    await expect(
      assistant.generateFollowUpQuestion('query', ['amount'], controller.signal),
    ).rejects.toThrow('Aborted');

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('should return fallback result for non-abort errors in analyzeUserMessage', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network failure')),
    );

    const result = await assistant.analyzeUserMessage('hello');
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(toastAddMock).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('should toast on network-style fetch failure in analyzeUserMessage', async () => {
    toastAddMock.mockClear();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    const a = new AIAssistant();
    await a.analyzeUserMessage('hello');

    expect(toastAddMock).toHaveBeenCalledWith(
      expect.stringContaining('network'),
      'warning',
    );
    consoleErrorSpy.mockRestore();
  });

  it('should toast on network failure in generateFollowUpQuestion', async () => {
    toastAddMock.mockClear();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    const a = new AIAssistant();
    await a.generateFollowUpQuestion('x', ['y']);

    expect(toastAddMock).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();


/**
 * Helper to build a minimal AIAnalysisResult for a given intent.
 */
function makeAnalysis(
  intent: AIAnalysisResult['intent'],
  overrides: Partial<AIAnalysisResult> = {},
): AIAnalysisResult {
  return {
    intent,
    confidence: 0.9,
    extractedData: {},
    requiredQuestions: [],
    suggestedResponse: 'test response',
    ...overrides,
  };
}

describe('aiAssistant framer-motion animation', () => {
  // ── ASSISTANT_ANIMATION_VARIANTS constant ────────────────────────────

  describe('ASSISTANT_ANIMATION_VARIANTS', () => {
    const ALL_INTENTS: AIAnalysisResult['intent'][] = [
      'query',
      'guardrail',
      'fiat_conversion',
      'portfolio',
      'technical_support',
      'unknown',
    ];

    it('should have a variant entry for every possible intent', () => {
      for (const intent of ALL_INTENTS) {
        expect(ASSISTANT_ANIMATION_VARIANTS).toHaveProperty(intent);
      }
    });

    it('should have a "default" fallback entry', () => {
      expect(ASSISTANT_ANIMATION_VARIANTS).toHaveProperty('default');
    });

    it('every variant should contain initial and animate states', () => {
      const keys = Object.keys(ASSISTANT_ANIMATION_VARIANTS) as Array<
        keyof typeof ASSISTANT_ANIMATION_VARIANTS
      >;

      for (const key of keys) {
        const variant = ASSISTANT_ANIMATION_VARIANTS[key];
        expect(variant).toHaveProperty('initial');
        expect(variant).toHaveProperty('animate');
      }
    });

    it('every initial state should start with opacity 0', () => {
      const keys = Object.keys(ASSISTANT_ANIMATION_VARIANTS) as Array<
        keyof typeof ASSISTANT_ANIMATION_VARIANTS
      >;

      for (const key of keys) {
        expect(ASSISTANT_ANIMATION_VARIANTS[key].initial.opacity).toBe(0);
      }
    });

    it('every animate state should end with opacity 1', () => {
      const keys = Object.keys(ASSISTANT_ANIMATION_VARIANTS) as Array<
        keyof typeof ASSISTANT_ANIMATION_VARIANTS
      >;

      for (const key of keys) {
        expect(ASSISTANT_ANIMATION_VARIANTS[key].animate.opacity).toBe(1);
      }
    });

    it('every animate state should have a transition with a positive duration', () => {
      const keys = Object.keys(ASSISTANT_ANIMATION_VARIANTS) as Array<
        keyof typeof ASSISTANT_ANIMATION_VARIANTS
      >;

      for (const key of keys) {
        const t = ASSISTANT_ANIMATION_VARIANTS[key].animate.transition;
        expect(t).toBeDefined();
        expect(t!.duration).toBeGreaterThan(0);
      }
    });

    it('guardrail variant should use horizontal x offset for attention', () => {
      const guardrail = ASSISTANT_ANIMATION_VARIANTS.guardrail;
      expect(guardrail.initial.x).toBeDefined();
      expect(guardrail.initial.x).not.toBe(0);
    });

    it('guardrail variant should use spring physics', () => {
      const transition = ASSISTANT_ANIMATION_VARIANTS.guardrail.animate.transition;
      expect(transition!.type).toBe('spring');
      expect(transition!.stiffness).toBeGreaterThan(0);
      expect(transition!.damping).toBeGreaterThan(0);
    });

    it('fiat_conversion variant should use larger scale-up for emphasis', () => {
      const fc = ASSISTANT_ANIMATION_VARIANTS.fiat_conversion;
      expect(fc.initial.scale).toBeLessThan(1);
      expect(fc.animate.scale).toBe(1);
    });
  });

  // ── REDUCED_MOTION_VARIANTS constant ─────────────────────────────────

  describe('REDUCED_MOTION_VARIANTS', () => {
    it('should only animate opacity (no positional transforms)', () => {
      const { initial, animate } = REDUCED_MOTION_VARIANTS;

      expect(initial.opacity).toBe(0);
      expect(initial.y).toBeUndefined();
      expect(initial.x).toBeUndefined();
      expect(initial.scale).toBeUndefined();

      expect(animate.opacity).toBe(1);
      expect(animate.y).toBeUndefined();
      expect(animate.x).toBeUndefined();
      expect(animate.scale).toBeUndefined();
    });

    it('should have a short transition duration', () => {
      expect(REDUCED_MOTION_VARIANTS.animate.transition!.duration).toBeLessThanOrEqual(0.3);
    });
  });

  // ── AIAssistant.getAnimationVariants() ────────────────────────────────

  describe('AIAssistant.getAnimationVariants()', () => {
    it('should return the correct variant for each intent', () => {
      const intents: AIAnalysisResult['intent'][] = [
        'query',
        'guardrail',
        'fiat_conversion',
        'portfolio',
        'technical_support',
        'unknown',
      ];

      for (const intent of intents) {
        const analysis = makeAnalysis(intent);
        const result = AIAssistant.getAnimationVariants(analysis);
        expect(result).toEqual(ASSISTANT_ANIMATION_VARIANTS[intent]);
      }
    });

    it('should return reduced-motion variants when prefersReducedMotion is true', () => {
      const analysis = makeAnalysis('fiat_conversion');
      const result = AIAssistant.getAnimationVariants(analysis, true);
      expect(result).toEqual(REDUCED_MOTION_VARIANTS);
    });

    it('should return reduced-motion variants for guardrail intent when motion is reduced', () => {
      const analysis = makeAnalysis('guardrail', {
        guardrail: {
          triggered: true,
          category: 'malicious_activity',
          reason: 'test',
        },
      });
      const result = AIAssistant.getAnimationVariants(analysis, true);
      expect(result).toEqual(REDUCED_MOTION_VARIANTS);
    });

    it('should default to false for prefersReducedMotion when omitted', () => {
      const analysis = makeAnalysis('query');
      const result = AIAssistant.getAnimationVariants(analysis);
      // Should return intent-specific variant, not reduced-motion
      expect(result).toEqual(ASSISTANT_ANIMATION_VARIANTS.query);
      expect(result).not.toEqual(REDUCED_MOTION_VARIANTS);
    });

    it('should return a valid AnimationVariants shape for every intent', () => {
      const intents: AIAnalysisResult['intent'][] = [
        'query',
        'guardrail',
        'fiat_conversion',
        'portfolio',
        'technical_support',
        'unknown',
      ];

      for (const intent of intents) {
        const analysis = makeAnalysis(intent);
        const variants: AnimationVariants = AIAssistant.getAnimationVariants(analysis);

        // Structure checks
        expect(variants.initial).toBeDefined();
        expect(variants.animate).toBeDefined();
        expect(typeof variants.initial.opacity).toBe('number');
        expect(typeof variants.animate.opacity).toBe('number');
      }
    });

    it('should produce distinct variants for guardrail vs query intents', () => {
      const guardrailVariants = AIAssistant.getAnimationVariants(makeAnalysis('guardrail'));
      const queryVariants = AIAssistant.getAnimationVariants(makeAnalysis('query'));

      expect(guardrailVariants).not.toEqual(queryVariants);
    });

    it('should produce distinct variants for fiat_conversion vs default', () => {
      const fcVariants = AIAssistant.getAnimationVariants(makeAnalysis('fiat_conversion'));
      const defaultVariants = ASSISTANT_ANIMATION_VARIANTS.default;

      expect(fcVariants).not.toEqual(defaultVariants);
    });

  });
});
