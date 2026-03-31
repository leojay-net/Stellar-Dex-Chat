import { ReconciliationRecord } from '@/types';

export interface DailyMetric {
  date: string;
  volume: number;
  count: number;
}

export function aggregateDailyVolume(
  records: ReconciliationRecord[],
  days: number = 30,
): DailyMetric[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const metricsMap = new Map<string, DailyMetric>();

  // Initialize the last `days` safely
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime());
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    metricsMap.set(dateStr, { date: dateStr, volume: 0, count: 0 });
  }

  records.forEach((record) => {
    if (!record.depositDate) return;

    try {
      const parsedDate = new Date(record.depositDate);
      if (isNaN(parsedDate.getTime())) return;

      const dateStr = parsedDate.toISOString().split('T')[0];
      const metric = metricsMap.get(dateStr);

      if (metric) {
        metric.volume += parseFloat(record.depositAmount || '0');
        metric.count += 1;
      }
    } catch {
      // Ignored invalid dates
    }
  });

  return Array.from(metricsMap.values());
}
