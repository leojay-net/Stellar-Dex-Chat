import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

// Without GEMINI_API_KEY the route short-circuits to its "not configured"
// fallback before ever reaching the (mocked) model.
vi.mock('@/lib/serverEnv', () => ({
  serverEnv: { GEMINI_API_KEY: 'test-gemini-key' },
}));

// Mock GoogleGenerativeAI so tests don't try to actually hit Gemini
vi.mock('@google/generative-ai', () => {
  return {
    // Vitest 4 only lets `new` call mocks whose implementation is a
    // `function`/class, not an arrow function.
    GoogleGenerativeAI: vi.fn().mockImplementation(function () {
      return {
        getGenerativeModel: vi.fn().mockReturnValue({
          generateContent: vi.fn().mockResolvedValue({
            response: {
              text: () =>
                JSON.stringify({
                  intent: 'fiat_conversion',
                  confidence: 0.95,
                  extractedData: { type: 'fiat_conversion' },
                }),
            },
          }),
        }),
      };
    }),
  };
});

describe('POST /api/ai/chat', () => {
  it('skips FAQ for transactional message "deposit xlm 250"', async () => {
    const req = new NextRequest('http://localhost:3000/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'deposit xlm 250' }),
    });

    const res = await POST(req);
    const data = await res.json();

    // It should have an amountIn of 250 (extracted by parser and merged with AI output)
    expect(data.extractedData.amountIn).toBe('250');
    // It should have fiat_conversion intent, not falling back to the FAQ intent
    expect(data.intent).toBe('fiat_conversion');
  });

  it('matches FAQ for non-transactional "how to deposit"', async () => {
    const req = new NextRequest('http://localhost:3000/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'how to deposit' }),
    });

    const res = await POST(req);
    const data = await res.json();

    // Since it matches FAQ, it should just return the canned response directly
    expect(data.intent).toBe('fiat_conversion'); // FAQ intent for this query
    expect(data.suggestedResponse).toContain('To deposit XLM'); // FAQ answer
    // No extracted data should be present for FAQ match
    expect(data.extractedData).toEqual({});
  });
});
