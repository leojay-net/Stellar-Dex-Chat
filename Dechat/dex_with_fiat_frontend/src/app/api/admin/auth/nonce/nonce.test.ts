import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST, GET } from './route';
import { NextRequest } from 'next/server';
import {
  deleteAdminSession,
  requireAdminAuth,
  setAdminSession,
} from '../../_utils/requireAdminAuth';

const setCookie = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: setCookie }),
}));

// Mock the dependencies
vi.mock('@/lib/stellarContract', () => ({
  getAdmin: vi.fn(() =>
    Promise.resolve(
      'GADMIN12345678901234567890123456789012345678901234567890123',
    ),
  ),
}));

vi.mock('@/lib/stellarSignature', () => ({
  verifySignedTransaction: vi.fn(() => Promise.resolve(true)),
}));

describe('Admin Auth Nonce Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET should return a nonce', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('nonce');
    expect(data).toHaveProperty('expires');
    expect(typeof data.nonce).toBe('string');
    expect(typeof data.expires).toBe('number');
    expect(data.expires).toBeGreaterThan(Date.now());
  });

  it('POST should authenticate with valid signature and nonce', async () => {
    // First get a nonce
    const getResponse = await GET();
    const { nonce } = await getResponse.json();

    // Create a mock signed transaction
    const mockSignature = 'mock-signed-xdr';
    const mockAddress =
      'GADMIN12345678901234567890123456789012345678901234567890123';

    const request = new NextRequest('http://localhost/api/admin/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({
        nonce,
        signature: mockSignature,
        address: mockAddress,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(setCookie).toHaveBeenCalledWith(
      'admin_session',
      expect.any(String),
      {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 1800,
        path: '/',
      },
    );

    const sessionToken = setCookie.mock.calls[0][1];
    const sessionRequest = new Request('http://localhost', {
      headers: { cookie: `admin_session=${sessionToken}` },
    });
    expect(requireAdminAuth(sessionRequest)).toBeNull();
    deleteAdminSession(sessionToken);
  });

  it('POST should reject missing fields', async () => {
    const request = new NextRequest('http://localhost/api/admin/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Missing required fields');
  });

  it('POST should reject invalid nonce', async () => {
    const request = new NextRequest('http://localhost/api/admin/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({
        nonce: 'invalid-nonce',
        signature: 'mock-signature',
        address: 'GADMIN12345678901234567890123456789012345678901234567890123',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid or expired nonce');
  });

  it('POST should reject non-admin address', async () => {
    const { verifySignedTransaction } = await import('@/lib/stellarSignature');
    vi.mocked(verifySignedTransaction).mockResolvedValueOnce(true);

    // First get a nonce
    const getResponse = await GET();
    const { nonce } = await getResponse.json();

    const request = new NextRequest('http://localhost/api/admin/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({
        nonce,
        signature: 'mock-signed-xdr',
        address: 'GNOTADMIN1234567890123456789012345678901234567890123456',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('Address is not the admin');
  });

  it('POST should reject invalid signature', async () => {
    const { verifySignedTransaction } = await import('@/lib/stellarSignature');
    vi.mocked(verifySignedTransaction).mockResolvedValueOnce(false);

    // First get a nonce
    const getResponse = await GET();
    const { nonce } = await getResponse.json();

    const request = new NextRequest('http://localhost/api/admin/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({
        nonce,
        signature: 'invalid-signature',
        address: 'GADMIN12345678901234567890123456789012345678901234567890123',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toContain('Invalid signature');
  });
});

describe('Admin Session Management', () => {
  afterEach(() => vi.useRealTimers());

  it('should set and validate admin session', () => {
    const sessionToken = 'test-session-token';
    const address =
      'GADMIN12345678901234567890123456789012345678901234567890123';
    const ttlMs = 30000;

    setAdminSession(sessionToken, address, ttlMs);

    // Session should be set
    const mockRequest = new Request('http://localhost', {
      headers: { cookie: `admin_session=${sessionToken}` },
    });

    const result = requireAdminAuth(mockRequest);

    // Should return null (no error) for valid session
    expect(result).toBeNull();
  });

  it('should reject expired session', () => {
    vi.useFakeTimers();
    const sessionToken = 'expired-session-token';
    const address =
      'GADMIN12345678901234567890123456789012345678901234567890123';
    const ttlMs = 1; // 1ms - will expire immediately

    setAdminSession(sessionToken, address, ttlMs);

    vi.advanceTimersByTime(10);

    const mockRequest = new Request('http://localhost', {
      headers: { cookie: `admin_session=${sessionToken}` },
    });

    const result = requireAdminAuth(mockRequest);

    // Should return 401 error for expired session
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });

  it('should delete session', () => {
    const sessionToken = 'delete-session-token';
    const address =
      'GADMIN12345678901234567890123456789012345678901234567890123';
    const ttlMs = 30000;

    setAdminSession(sessionToken, address, ttlMs);
    deleteAdminSession(sessionToken);

    const mockRequest = new Request('http://localhost', {
      headers: { cookie: `admin_session=${sessionToken}` },
    });

    const result = requireAdminAuth(mockRequest);

    // Should return 401 error for deleted session
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });
});
