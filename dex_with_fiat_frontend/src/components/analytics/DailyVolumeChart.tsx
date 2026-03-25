'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DailyMetric, formatCurrency, formatDate } from '@/lib/analytics';

interface DailyVolumeChartProps {
  data: DailyMetric[] | null;
}

export function DailyVolumeChart({ data }: DailyVolumeChartProps) {
  // Handle zero-data state
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Daily Volume (30 Days)</CardTitle>
          <CardDescription>No transaction data available</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="text-4xl mb-2">📊</div>
              <p>No data available for the selected period</p>
              <p className="text-sm">Transactions will appear here once users start trading</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate chart dimensions and scales
  const maxValue = Math.max(...data.map(d => d.volume));
  const minValue = Math.min(...data.map(d => d.volume));
  const range = maxValue - minValue || 1;
  
  const chartHeight = 200;
  const chartWidth = 600;
  const padding = 40;
  const barWidth = (chartWidth - padding * 2) / data.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Volume (30 Days)</CardTitle>
        <CardDescription>
          Total volume: {formatCurrency(data.reduce((sum, d) => sum + d.volume, 0))}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Simple SVG chart */}
          <div className="overflow-x-auto">
            <svg width={chartWidth} height={chartHeight + 40} className="w-full">
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                <line
                  key={fraction}
                  x1={padding}
                  y1={chartHeight - fraction * chartHeight + 20}
                  x2={chartWidth - padding}
                  y2={chartHeight - fraction * chartHeight + 20}
                  stroke="#e5e7eb"
                  strokeWidth="1"
                />
              ))}
              
              {/* Bars */}
              {data.map((day, index) => {
                const barHeight = ((day.volume - minValue) / range) * chartHeight * 0.8 || 10;
                const x = padding + index * barWidth;
                const y = chartHeight - barHeight + 20;
                
                return (
                  <g key={day.date}>
                    <rect
                      x={x + barWidth * 0.1}
                      y={y}
                      width={barWidth * 0.8}
                      height={barHeight}
                      fill="#3b82f6"
                      rx="2"
                    />
                    {/* Show date labels for every 5th day */}
                    {index % 5 === 0 && (
                      <text
                        x={x + barWidth / 2}
                        y={chartHeight + 35}
                        textAnchor="middle"
                        fontSize="10"
                        fill="#6b7280"
                      >
                        {formatDate(day.date)}
                      </text>
                    )}
                  </g>
                );
              })}
              
              {/* Y-axis labels */}
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
                const value = minValue + (range * fraction);
                return (
                  <text
                    key={fraction}
                    x={padding - 5}
                    y={chartHeight - fraction * chartHeight + 25}
                    textAnchor="end"
                    fontSize="10"
                    fill="#6b7280"
                  >
                    {formatCurrency(value).replace(/[₦,]/g, '')}
                  </text>
                );
              })}
            </svg>
          </div>
          
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-4 pt-4 border-t">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {formatCurrency(Math.round(data.reduce((sum, d) => sum + d.volume, 0) / data.length))}
              </div>
              <div className="text-sm text-muted-foreground">Avg Daily Volume</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {formatCurrency(Math.max(...data.map(d => d.volume)))}
              </div>
              <div className="text-sm text-muted-foreground">Peak Day</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {data.reduce((sum, d) => sum + d.transactions, 0)}
              </div>
              <div className="text-sm text-muted-foreground">Total Transactions</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
