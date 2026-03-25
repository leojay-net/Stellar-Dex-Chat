'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricsOverview as OverviewData, formatCurrency, formatPercentage } from '@/lib/analytics';
import { TrendingUp, TrendingDown, Users, DollarSign, Activity, CreditCard } from 'lucide-react';

interface MetricsOverviewProps {
  data: OverviewData | null;
}

export function MetricsOverview({ data }: MetricsOverviewProps) {
  // Handle zero-data state
  if (!data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { title: 'Total Volume', value: 'No data', icon: DollarSign, color: 'text-blue-600' },
          { title: 'Transactions', value: 'No data', icon: Activity, color: 'text-green-600' },
          { title: 'Active Users', value: 'No data', icon: Users, color: 'text-purple-600' },
          { title: 'Revenue', value: 'No data', icon: CreditCard, color: 'text-orange-600' },
        ].map((metric, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
              <metric.icon className={`h-4 w-4 ${metric.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-muted-foreground">{metric.value}</div>
              <p className="text-xs text-muted-foreground">Waiting for data...</p>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const metrics = [
    {
      title: 'Total Volume',
      value: formatCurrency(data.totalVolume),
      change: data.growthRate,
      icon: DollarSign,
      color: 'text-blue-600',
      description: '30-day total transaction volume',
    },
    {
      title: 'Transactions',
      value: data.totalTransactions.toLocaleString(),
      change: data.growthRate,
      icon: Activity,
      color: 'text-green-600',
      description: 'Total number of transactions',
    },
    {
      title: 'Active Users',
      value: data.totalUsers.toLocaleString(),
      change: data.growthRate,
      icon: Users,
      color: 'text-purple-600',
      description: 'Unique active users',
    },
    {
      title: 'Revenue',
      value: formatCurrency(data.totalRevenue),
      change: data.growthRate,
      icon: CreditCard,
      color: 'text-orange-600',
      description: 'Platform revenue from fees',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {metrics.map((metric, index) => {
        const Icon = metric.icon;
        const isPositive = metric.change >= 0;
        const TrendIcon = isPositive ? TrendingUp : TrendingDown;
        
        return (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
              <Icon className={`h-4 w-4 ${metric.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                <TrendIcon className={`h-3 w-3 ${isPositive ? 'text-green-500' : 'text-red-500'}`} />
                <span className={isPositive ? 'text-green-500' : 'text-red-500'}>
                  {formatPercentage(metric.change)}
                </span>
                <span>from last period</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{metric.description}</p>
            </CardContent>
          </Card>
        );
      })}
      
      {/* Additional insights card */}
      {data.topDay && (
        <Card className="md:col-span-2 lg:col-span-4">
          <CardHeader>
            <CardTitle className="text-lg">Top Performing Day</CardTitle>
            <CardDescription>
              Best day in the last 30 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Date</div>
                <div className="text-lg font-semibold">
                  {new Date(data.topDay.date).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Volume</div>
                <div className="text-lg font-semibold text-blue-600">
                  {formatCurrency(data.topDay.volume)}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Transactions</div>
                <div className="text-lg font-semibold text-green-600">
                  {data.topDay.transactions}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Users</div>
                <div className="text-lg font-semibold text-purple-600">
                  {data.topDay.users}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
