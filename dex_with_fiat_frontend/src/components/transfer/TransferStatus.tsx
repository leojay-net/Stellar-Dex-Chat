'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  Timer,
  Ban
} from 'lucide-react';

interface TransferStatusProps {
  reference: string;
  onCancel?: () => void;
}

interface TransferData {
  reference: string;
  status: 'pending' | 'success' | 'failed' | 'cancelled';
  amount: number;
  currency: string;
  recipient: string;
  createdAt: string;
  isCancelled?: boolean;
  canCancel?: boolean;
  cancellationInfo?: {
    cancelledAt: string;
    reason: string;
  };
  cancellationWindow?: {
    expiresAt: string;
    timeRemaining: number;
  };
  timeline?: Array<{
    status: string;
    message: string;
    timestamp: string;
  }>;
}

export function TransferStatus({ reference, onCancel }: TransferStatusProps) {
  const [transferData, setTransferData] = useState<TransferData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTransferStatus();
    // Poll for updates every 10 seconds if still pending
    const interval = setInterval(() => {
      if (transferData?.status === 'pending') {
        fetchTransferStatus();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [reference]);

  const fetchTransferStatus = async () => {
    try {
      setError(null);
      const response = await fetch('/api/transfer-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference }),
      });

      const result = await response.json();
      
      if (result.success) {
        setTransferData(result.data);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('Failed to fetch transfer status');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!transferData?.canCancel) return;

    try {
      setCancelling(true);
      setError(null);

      const response = await fetch('/api/cancel-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          reference,
          reason: 'User requested cancellation'
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        await fetchTransferStatus(); // Refresh status
        onCancel?.();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('Failed to cancel transfer');
    } finally {
      setCancelling(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'cancelled':
        return <Ban className="h-4 w-4 text-orange-500" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'cancelled':
        return 'bg-orange-100 text-orange-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatTimeRemaining = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
    }).format(amount);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transfer Status</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !transferData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transfer Status</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error || 'Transfer not found'}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {getStatusIcon(transferData.status)}
              Transfer Status
            </CardTitle>
            <CardDescription>Reference: {transferData.reference}</CardDescription>
          </div>
          <Badge className={getStatusColor(transferData.status)}>
            {transferData.status.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Transfer Details */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted-foreground">Amount</div>
            <div className="text-lg font-semibold">
              {formatCurrency(transferData.amount, transferData.currency)}
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Recipient</div>
            <div className="text-lg font-semibold">{transferData.recipient}</div>
          </div>
        </div>

        {/* Cancellation Window */}
        {transferData.canCancel && transferData.cancellationWindow && (
          <Alert>
            <Timer className="h-4 w-4" />
            <AlertDescription>
              <div className="flex items-center justify-between">
                <span>You can cancel this transfer within 2 minutes of initiation.</span>
                <span className="font-mono text-sm">
                  {formatTimeRemaining(transferData.cancellationWindow.timeRemaining)}
                </span>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Cancellation Info */}
        {transferData.isCancelled && transferData.cancellationInfo && (
          <Alert className="border-orange-200 bg-orange-50">
            <Ban className="h-4 w-4 text-orange-600" />
            <AlertDescription className="text-orange-800">
              <div>
                <strong>Transfer Cancelled</strong>
                <p className="text-sm mt-1">
                  Reason: {transferData.cancellationInfo.reason}
                </p>
                <p className="text-xs mt-1">
                  Cancelled at: {new Date(transferData.cancellationInfo.cancelledAt).toLocaleString()}
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        {transferData.canCancel && (
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling...' : 'Cancel Transfer'}
            </Button>
            <Button variant="outline" onClick={fetchTransferStatus}>
              Refresh Status
            </Button>
          </div>
        )}

        {/* Timeline */}
        {transferData.timeline && transferData.timeline.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-4">Timeline</h4>
            <div className="space-y-3">
              {transferData.timeline.map((event, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className="mt-1">
                    {getStatusIcon(event.status)}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm">{event.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(event.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
