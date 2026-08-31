import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { ContractEvent } from '../../../types/events';
import { applyRateLimit, getClientIp } from '@/lib/rateLimit';
import { eventsQuerySchema } from '@/lib/apiSchemas';

const DATA_DIR = path.join(process.cwd(), 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'contract-events.json');
const RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const limited = applyRateLimit(ip, '/api/events', RATE_LIMIT);
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);

    const validationResult = eventsQuerySchema.safeParse({
      limit: searchParams.get('limit') ?? undefined,
      offset: searchParams.get('offset') ?? undefined,
    });

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          message: 'Validation failed',
          errors: validationResult.error.issues,
        },
        { status: 400 },
      );
    }

    const { limit, offset } = validationResult.data;

    if (!fs.existsSync(EVENTS_FILE)) {
      return NextResponse.json({ events: [], total: 0 });
    }

    const fileContent = fs.readFileSync(EVENTS_FILE, 'utf8');
    const events: ContractEvent[] = JSON.parse(fileContent);
    
    // Paginate and return
    const paginatedEvents = events.slice(offset, offset + limit);

    return NextResponse.json({
      events: paginatedEvents,
      total: events.length,
      limit,
      offset
    });
  } catch (error) {
    console.error('Error fetching indexed events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contract activity events' },
      { status: 500 }
    );
  }
}
