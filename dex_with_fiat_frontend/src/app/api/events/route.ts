import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { ContractEvent } from '../../../types/events';

const DATA_DIR = path.join(process.cwd(), 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'contract-events.json');

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

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
