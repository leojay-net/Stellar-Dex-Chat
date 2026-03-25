'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ActivityItem, getActivityFeed, formatCurrency, formatRelativeTime } from '@/lib/analytics';
import { Activity, ArrowUpRight, ArrowDownRight, UserPlus, AlertCircle, Clock } from 'lucide-react';

export function ActivityFeed() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadActivities() {
      try {
        const data = await getActivityFeed(10);
        setActivities(data);
      } catch (error) {
        console.error('Failed to load activity feed:', error);
      } finally {
        setLoading(false);
      }
    }

    loadActivities();
  }, []);

  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'transaction':
        return Activity;
      case 'deposit':
        return ArrowUpRight;
      case 'withdrawal':
        return ArrowDownRight;
      case 'user':
        return UserPlus;
      default:
        return Activity;
    }
  };

  const getStatusColor = (status: ActivityItem['status']) => {
    switch (status) {
      case 'success':
        return 'text-green-500';
      case 'pending':
        return 'text-yellow-500';
      case 'failed':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusIcon = (status: ActivityItem['status']) => {
    switch (status) {
      case 'pending':
        return Clock;
      case 'failed':
        return AlertCircle;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest platform activities</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center space-x-4 animate-pulse">
                <div className="w-8 h-8 bg-muted rounded-full"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-3/4"></div>
                  <div className="h-3 bg-muted rounded w-1/2"></div>
                </div>
                <div className="h-3 bg-muted rounded w-16"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Handle zero-data state
  if (activities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>No recent activity</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No recent activity to display</p>
              <p className="text-sm">Activity will appear here as users interact with the platform</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Latest platform activities</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity) => {
            const Icon = getActivityIcon(activity.type);
            const StatusIcon = getStatusIcon(activity.status);
            
            return (
              <div key={activity.id} className="flex items-center space-x-4 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  activity.status === 'success' ? 'bg-green-100' :
                  activity.status === 'pending' ? 'bg-yellow-100' :
                  'bg-red-100'
                }`}>
                  <Icon className={`h-4 w-4 ${getStatusColor(activity.status)}`} />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <p className="text-sm font-medium truncate">{activity.description}</p>
                    {activity.amount && (
                      <span className="text-sm font-semibold text-blue-600">
                        {formatCurrency(activity.amount)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                    {activity.user && (
                      <span>User: {activity.user}</span>
                    )}
                    {StatusIcon && (
                      <StatusIcon className={`h-3 w-3 ${getStatusColor(activity.status)}`} />
                    )}
                    <span className="capitalize">{activity.status}</span>
                  </div>
                </div>
                
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatRelativeTime(activity.timestamp)}
                </div>
              </div>
            );
          })}
        </div>
        
        {activities.length > 0 && (
          <div className="mt-4 pt-4 border-t text-center">
            <button className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              View all activity →
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
