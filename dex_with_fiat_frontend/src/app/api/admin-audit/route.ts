import { NextResponse } from 'next/server';
import { getAuditEntries } from '@/lib/auditLog';

export async function GET() {
  try {
    const data = await getAuditEntries();
    // Sort by newest first for the admin view
    const sortedData = data.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    return NextResponse.json(sortedData);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 });
  }
}