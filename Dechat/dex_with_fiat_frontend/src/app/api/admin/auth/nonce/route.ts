import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAdmin } from '@/lib/stellarContract';
import { verifySignedTransaction } from '@/lib/stellarSignature';
import { setAdminSession } from '../../_utils/requireAdminAuth';

export const dynamic = 'force-dynamic';

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ADMIN_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// In-memory store for nonces (in production, use Redis or similar)
const nonces = new Map<string, { expires: number }>();

// Clean up expired nonces periodically
if (typeof global.nonceCleanupInterval === 'undefined') {
  global.nonceCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [nonce, data] of nonces.entries()) {
      if (data.expires < now) {
        nonces.delete(nonce);
      }
    }
  }, 60 * 1000);
}

export async function GET() {
  // Generate a random nonce (32 bytes for memo hash)
  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(nonceBytes);
  const nonce = Buffer.from(nonceBytes).toString('base64');
  const expires = Date.now() + NONCE_TTL_MS;
  nonces.set(nonce, { expires });

  return NextResponse.json({ nonce, expires });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { nonce, signature, address } = body;

    if (!nonce || !signature || !address) {
      return NextResponse.json(
        { error: 'Missing required fields: nonce, signature, address' },
        { status: 400 },
      );
    }

    // Check if nonce exists and is not expired
    const nonceData = nonces.get(nonce);
    if (!nonceData) {
      return NextResponse.json(
        { error: 'Invalid or expired nonce' },
        { status: 400 },
      );
    }

    if (nonceData.expires < Date.now()) {
      nonces.delete(nonce);
      return NextResponse.json({ error: 'Nonce expired' }, { status: 400 });
    }

    // Verify the signed transaction
    const isValid = await verifySignedTransaction(signature, nonce, address);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid signature or nonce mismatch' },
        { status: 401 },
      );
    }

    // Verify the address matches the on-chain admin
    const adminAddress = await getAdmin();
    if (address !== adminAddress) {
      return NextResponse.json(
        { error: 'Address is not the admin' },
        { status: 403 },
      );
    }

    // Create session cookie
    const cookieStore = await cookies();
    const sessionToken = crypto.randomUUID();

    // Store session data using shared session store
    setAdminSession(sessionToken, address, ADMIN_SESSION_TTL_MS);

    // Set httpOnly cookie
    cookieStore.set('admin_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: ADMIN_SESSION_TTL_MS / 1000,
      path: '/',
    });

    // Clean up the used nonce
    nonces.delete(nonce);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin auth error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 },
    );
  }
}
