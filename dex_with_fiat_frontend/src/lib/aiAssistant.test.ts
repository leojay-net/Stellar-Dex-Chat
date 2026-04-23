import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIAssistant } from './aiAssistant';
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
    consoleErrorSpy.mockRestore();
  });
});
