import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
  try {
    return NextResponse.json(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        message: error instanceof Error ? error.message : 'Health check failed',
      },
      { status: 503 },
    );
  }
}