import { NextRequest, NextResponse } from 'next/server';
import { ReconciliationRecord } from '../../../../types';
import { requireAdminAuth } from '../_utils/requireAdminAuth';

export async function GET(request: NextRequest) {
  try {
    const authError = requireAdminAuth(request);
    if (authError) {
      return authError;
    }

    return NextResponse.json(mockReconciliationData);
  } catch (error) {
    console.error('Error fetching reconciliation data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reconciliation data' },
      { status: 500 },
    );
  }
}

// Mock data - in production, this would come from a database
const mockReconciliationData: ReconciliationRecord[] = [
  {
    id: '1',
    depositTxHash: '0x123abc',
    depositAmount: '100.0',
    depositUser: 'GA123...',
    depositDate: '2026-03-20T10:00:00Z',
    payoutId: 'TRF_123456',
    payoutAmount: '100.0',
    payoutRecipient: 'John Doe - 1234567890',
    payoutStatus: 'completed',
    payoutDate: '2026-03-20T11:00:00Z',
    status: 'matched',
  },
  {
    id: '2',
    depositTxHash: '0x456def',
    depositAmount: '50.0',
    depositUser: 'GA456...',
    depositDate: '2026-03-21T14:30:00Z',
    payoutId: 'TRF_789012',
    payoutAmount: '50.0',
    payoutRecipient: 'Jane Smith - 0987654321',
    payoutStatus: 'pending',
    payoutDate: '2026-03-21T15:00:00Z',
    status: 'matched',
  },
  {
    id: '3',
    depositTxHash: '0x789ghi',
    depositAmount: '25.0',
    depositUser: 'GA789...',
    depositDate: '2026-03-22T09:15:00Z',
    payoutId: '',
    payoutAmount: '',
    payoutRecipient: '',
    payoutStatus: 'pending',
    payoutDate: '',
    status: 'unmatched',
  },
  {
    id: '4',
    depositTxHash: '0xabcpqr',
    depositAmount: '75.0',
    depositUser: 'GAABC...',
    depositDate: '2026-03-23T16:45:00Z',
    payoutId: 'TRF_345678',
    payoutAmount: '70.0',
    payoutRecipient: 'Bob Wilson - 1122334455',
    payoutStatus: 'failed',
    payoutDate: '2026-03-23T17:00:00Z',
    status: 'error',
  },
];
