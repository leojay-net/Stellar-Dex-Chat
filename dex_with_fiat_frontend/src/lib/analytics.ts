/**
 * Analytics aggregation system for daily metrics
 * Provides 30-day window data aggregation with fallback states
 */

export interface DailyMetric {
  date: string;
  volume: number;
  transactions: number;
  users: number;
  revenue: number;
}

export interface MetricsOverview {
  totalVolume: number;
  totalTransactions: number;
  totalUsers: number;
  totalRevenue: number;
  avgDailyVolume: number;
  growthRate: number;
  topDay: DailyMetric | null;
}

export interface ActivityItem {
  id: string;
  type: 'transaction' | 'user' | 'deposit' | 'withdrawal';
  description: string;
  amount?: number;
  user?: string;
  timestamp: string;
  status: 'success' | 'pending' | 'failed';
}

/**
 * Generate sample data for demonstration (replace with real data sources)
 */
function generateSampleData(days: number): DailyMetric[] {
  const data: DailyMetric[] = [];
  const today = new Date();
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    // Generate realistic-looking sample data with some variance
    const baseVolume = 50000 + Math.random() * 100000;
    const baseTransactions = 20 + Math.random() * 80;
    const baseUsers = 5 + Math.random() * 25;
    
    data.push({
      date: date.toISOString().split('T')[0],
      volume: Math.round(baseVolume),
      transactions: Math.round(baseTransactions),
      users: Math.round(baseUsers),
      revenue: Math.round(baseVolume * 0.02), // 2% fee
    });
  }
  
  return data;
}

/**
 * Get daily metrics for the specified number of days
 */
export async function getDailyMetrics(days: number = 30): Promise<DailyMetric[]> {
  try {
    // In production, this would query your database or analytics service
    // For now, we'll generate sample data
    const data = generateSampleData(days);
    
    // Return empty array if no data available
    if (!data || data.length === 0) {
      return [];
    }
    
    return data;
  } catch (error) {
    console.error('Failed to fetch daily metrics:', error);
    return [];
  }
}

/**
 * Calculate metrics overview from daily data
 */
export async function getMetricsOverview(): Promise<MetricsOverview> {
  try {
    const dailyData = await getDailyMetrics(30);
    
    // Handle zero-data state
    if (!dailyData || dailyData.length === 0) {
      return {
        totalVolume: 0,
        totalTransactions: 0,
        totalUsers: 0,
        totalRevenue: 0,
        avgDailyVolume: 0,
        growthRate: 0,
        topDay: null,
      };
    }
    
    const totalVolume = dailyData.reduce((sum, day) => sum + day.volume, 0);
    const totalTransactions = dailyData.reduce((sum, day) => sum + day.transactions, 0);
    const totalUsers = dailyData.reduce((sum, day) => sum + day.users, 0);
    const totalRevenue = dailyData.reduce((sum, day) => sum + day.revenue, 0);
    const avgDailyVolume = totalVolume / dailyData.length;
    
    // Calculate growth rate (comparing first half vs second half of the period)
    const midpoint = Math.floor(dailyData.length / 2);
    const firstHalfVolume = dailyData.slice(0, midpoint).reduce((sum, day) => sum + day.volume, 0);
    const secondHalfVolume = dailyData.slice(midpoint).reduce((sum, day) => sum + day.volume, 0);
    const growthRate = firstHalfVolume > 0 ? ((secondHalfVolume - firstHalfVolume) / firstHalfVolume) * 100 : 0;
    
    // Find the best performing day
    const topDay = dailyData.reduce((best, current) => 
      current.volume > (best?.volume || 0) ? current : best, 
      dailyData[0]
    );
    
    return {
      totalVolume,
      totalTransactions,
      totalUsers,
      totalRevenue,
      avgDailyVolume,
      growthRate,
      topDay,
    };
  } catch (error) {
    console.error('Failed to calculate metrics overview:', error);
    return {
      totalVolume: 0,
      totalTransactions: 0,
      totalUsers: 0,
      totalRevenue: 0,
      avgDailyVolume: 0,
      growthRate: 0,
      topDay: null,
    };
  }
}

/**
 * Get recent activity feed
 */
export async function getActivityFeed(limit: number = 10): Promise<ActivityItem[]> {
  try {
    // In production, this would query your activity logs
    // For now, we'll generate sample activity data
    const activities: ActivityItem[] = [
      {
        id: '1',
        type: 'transaction',
        description: 'Transfer to bank account',
        amount: 25000,
        user: 'user_123',
        timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
        status: 'success',
      },
      {
        id: '2',
        type: 'deposit',
        description: 'XLM deposit to contract',
        amount: 50000,
        user: 'user_456',
        timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
        status: 'success',
      },
      {
        id: '3',
        type: 'user',
        description: 'New user registration',
        user: 'user_789',
        timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        status: 'success',
      },
      {
        id: '4',
        type: 'withdrawal',
        description: 'Withdrawal to external wallet',
        amount: 75000,
        user: 'user_101',
        timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
        status: 'pending',
      },
      {
        id: '5',
        type: 'transaction',
        description: 'Failed transfer - insufficient funds',
        amount: 100000,
        user: 'user_202',
        timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        status: 'failed',
      },
    ];
    
    return activities.slice(0, limit);
  } catch (error) {
    console.error('Failed to fetch activity feed:', error);
    return [];
  }
}

/**
 * Format currency values
 */
export function formatCurrency(amount: number, currency: string = 'NGN'): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format percentage values
 */
export function formatPercentage(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

/**
 * Format date for display
 */
export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format relative time
 */
export function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const time = new Date(timestamp);
  const diffMs = now.getTime() - time.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
