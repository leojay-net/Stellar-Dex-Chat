import { NextResponse } from 'next/server';
import axios from 'axios';
import { telemetry } from '@/lib/telemetry';
import { env } from '@/lib/env';

const PAYSTACK_SECRET_KEY = env.PAYSTACK_SECRET_KEY;

export async function GET(request: Request) {
  const traceContext = telemetry.extractTraceFromHeaders(
    request.headers as Headers,
  );
  const span = telemetry.createSpan(
    'get-banks',
    traceContext.spanId,
    traceContext.traceId,
  );

  try {
    telemetry.addLog(span.spanId, 'info', 'Starting banks fetch', {
      endpoint: '/api/banks',
    });

    if (!PAYSTACK_SECRET_KEY) {
      telemetry.addLog(
        span.spanId,
        'warn',
        'Using fallback banks (no API key)',
        { endpoint: '/api/banks' },
      );

      // Fallback to a minimal set of Nigerian banks if API key is missing
      const fallbackBanks = [
        {
          id: 1,
          name: 'Access Bank',
          code: '044',
          active: true,
          country: 'Nigeria',
          currency: 'NGN',
          type: 'nuban',
        },
        {
          id: 2,
          name: 'GTBank',
          code: '058',
          active: true,
          country: 'Nigeria',
          currency: 'NGN',
          type: 'nuban',
        },
        {
          id: 3,
          name: 'First Bank',
          code: '011',
          active: true,
          country: 'Nigeria',
          currency: 'NGN',
          type: 'nuban',
        },
        {
          id: 4,
          name: 'Zenith Bank',
          code: '057',
          active: true,
          country: 'Nigeria',
          currency: 'NGN',
          type: 'nuban',
        },
        {
          id: 5,
          name: 'UBA',
          code: '033',
          active: true,
          country: 'Nigeria',
          currency: 'NGN',
          type: 'nuban',
        },
        {
          id: 6,
          name: 'Fidelity Bank',
          code: '070',
          active: true,
          country: 'Nigeria',
          currency: 'NGN',
          type: 'nuban',
        },
      ];

      telemetry.addLog(span.spanId, 'info', 'Fallback banks returned', {
        bankCount: fallbackBanks.length,
        source: 'fallback',
      });
      telemetry.finishSpan(span.spanId, { success: true, fallback: true });

      const response = NextResponse.json({
        success: true,
        data: fallbackBanks,
      });

      telemetry.setTraceHeaders(response.headers as Headers, traceContext);
      return response;
    }

    // Call real Paystack API to get Nigerian banks
    telemetry.addLog(span.spanId, 'info', 'Calling Paystack API', {
      endpoint: 'https://api.paystack.co/bank',
      country: 'nigeria',
    });

    const response = await axios.get(
      'https://api.paystack.co/bank?country=nigeria',
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.data.status) {
      telemetry.addLog(span.spanId, 'info', 'Paystack banks fetch successful', {
        bankCount: response.data.data.length,
        source: 'paystack_api',
      });
      telemetry.finishSpan(span.spanId, { success: true });

      const apiResponse = NextResponse.json({
        success: true,
        data: response.data.data,
      });

      telemetry.setTraceHeaders(apiResponse.headers as Headers, traceContext);
      return apiResponse;
    } else {
      throw new Error('Paystack API returned error status');
    }
  } catch (error) {
    telemetry.addLog(
      span.spanId,
      'error',
      'Error fetching banks from Paystack',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    );

    console.error('Error fetching banks from Paystack:', error);

    // Fallback to predefined banks if Paystack API fails
    const fallbackBanks = [
      {
        id: 1,
        name: 'Access Bank',
        code: '044',
        active: true,
        country: 'Nigeria',
        currency: 'NGN',
        type: 'nuban',
      },
      {
        id: 2,
        name: 'GTBank',
        code: '058',
        active: true,
        country: 'Nigeria',
        currency: 'NGN',
        type: 'nuban',
      },
      {
        id: 3,
        name: 'First Bank',
        code: '011',
        active: true,
        country: 'Nigeria',
        currency: 'NGN',
        type: 'nuban',
      },
      {
        id: 4,
        name: 'Zenith Bank',
        code: '057',
        active: true,
        country: 'Nigeria',
        currency: 'NGN',
        type: 'nuban',
      },
      {
        id: 5,
        name: 'UBA',
        code: '033',
        active: true,
        country: 'Nigeria',
        currency: 'NGN',
        type: 'nuban',
      },
      {
        id: 6,
        name: 'Fidelity Bank',
        code: '070',
        active: true,
        country: 'Nigeria',
        currency: 'NGN',
        type: 'nuban',
      },
      {
        id: 7,
        name: 'Union Bank',
        code: '032',
        active: true,
        country: 'Nigeria',
        currency: 'NGN',
        type: 'nuban',
      },
      {
        id: 8,
        name: 'Sterling Bank',
        code: '232',
        active: true,
        country: 'Nigeria',
        currency: 'NGN',
        type: 'nuban',
      },
      {
        id: 9,
        name: 'Stanbic IBTC Bank',
        code: '221',
        active: true,
        country: 'Nigeria',
        currency: 'NGN',
        type: 'nuban',
      },
      {
        id: 10,
        name: 'Wema Bank',
        code: '035',
        active: true,
        country: 'Nigeria',
        currency: 'NGN',
        type: 'nuban',
      },
    ];

    telemetry.addLog(
      span.spanId,
      'info',
      'Fallback banks returned after error',
      {
        bankCount: fallbackBanks.length,
        source: 'fallback_after_error',
        originalError: error instanceof Error ? error.message : 'Unknown error',
      },
    );
    telemetry.finishSpan(span.spanId, {
      success: true,
      fallback: true,
      hadError: true,
    });

    const response = NextResponse.json({
      success: true,
      data: fallbackBanks,
    });

    telemetry.setTraceHeaders(response.headers as Headers, traceContext);
    return response;
  }
}
